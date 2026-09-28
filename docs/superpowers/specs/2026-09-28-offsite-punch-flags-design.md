# Off-site punch flags — design

Date: 2026-09-28
Branch: `feature/offsite-punch-flags`
Status: approved direction (in-app alerts only, server-side flag)

## Problem

A manager can set geofence enforcement to `warn`. Then an employee can
clock in outside the radius. The manager wants to know when this occurs:

1. in real time, while the Time Clock page is open, and
2. later, when the manager reviews punches.

## Current behavior (cited)

- The geofence columns are on `restaurants`: `latitude`, `longitude`,
  `geofence_radius_meters` (default 200), and `geofence_enforcement`
  (`off` / `warn` / `block`)
  (`supabase/migrations/20260328202518_add_restaurant_geofence.sql:1-6`).
- `time_punches.location` is a `JSONB` column
  (`supabase/migrations/20251114100100_create_time_tracking_tables.sql:13`).
- The browser calculates the geofence result. `evaluateGeofence` returns
  `within` and `distanceMeters` (`src/hooks/useGeofenceCheck.ts:20-42`).
- `useGeofenceCheck` does no check when enforcement is `off` or the
  restaurant has no coordinates (`src/hooks/useGeofenceCheck.ts:59-61`).
- The employee app runs the check only for `clock_in`
  (`src/pages/EmployeeClock.tsx:134`).
- The client writes `within_geofence` and `distance_meters` into the
  location object (`src/utils/punchContext.ts:9-23`), and sends it on insert
  (`src/pages/EmployeeClock.tsx:248`).
- The insert is a direct PostgREST insert from the client
  (`src/hooks/useTimePunches.tsx:254-262`). Thus a client can send any
  `within_geofence` value.
- Kiosk punches send a location, but no geofence result
  (`src/pages/KioskMode.tsx:424`, `src/pages/KioskMode.tsx:603`).
- The only manager surfaces for the flag are:
  - an amber pin badge in the collapsed Punch List
    (`src/pages/TimePunchesManager.tsx:896-907`). A blue pin shows for every
    on-site punch (`src/pages/TimePunchesManager.tsx:908-912`), so the amber
    pin has low contrast against the list.
  - a distance line in the punch detail dialog
    (`src/pages/TimePunchesManager.tsx:1201-1205`).
- `StatusSummary` shows open sessions and anomalies, but no location data
  (`src/components/time-clock/StatusSummary.tsx:4-12`).
- Session views (Cards, Barcode, Receipt) receive `WorkSession[]`. A
  `WorkSession` has no punch or location fields
  (`src/utils/timePunchProcessing.ts:14-27`). `PunchStreamView` has
  `original_punch` (`src/components/time-tracking/PunchStreamView.tsx:92`).
- The only trigger on `time_punches` is `update_time_punches_updated_at`
  (checked on production `pg_trigger`, 2026-09-28).

### Production facts (read-only query, 2026-09-28)

- The `supabase_realtime` publication has **no tables**. `time_punches` is
  not in it.
- 1 of 38 restaurants has coordinates. That restaurant uses `warn`. The
  other 37 use `off`.
- Last 30 days: 545 punches, 408 with GPS, 2 flagged off-site.

## Decisions

| # | Decision | Reason |
|---|----------|--------|
| D1 | The server calculates the flag in a `BEFORE INSERT OR UPDATE OF location` trigger. | The client flag can be false. The user chose the trigger. |
| D2 | The trigger calculates the flag for **every** punch type and every source (employee app, kiosk). | Clock-out off-site is also useful. No client change is necessary for this. |
| D3 | The trigger calculates when the restaurant has coordinates, also when enforcement is `off`. | The user wants to know. The data has no effect on who can punch. |
| D4 | The live alert uses a 15 s React Query poll, not Supabase Realtime. | The Realtime publication is empty on production. A poll needs no publication change and no RLS audit for Realtime. |
| D5 | Alerts are in-app only. No push, no email. | The user chose this. |
| D6 | On-site punches show **no** location chip. | Less noise makes the off-site chip easy to see. |

## Design

### 1. Database: `set_punch_geofence` trigger

New migration `YYYYMMDDHHMMSS_time_punch_geofence_trigger.sql`.

Function `public.set_punch_geofence()`:

- `SECURITY DEFINER`, `SET search_path = public`. It reads only
  `latitude`, `longitude`, `geofence_radius_meters` of `NEW.restaurant_id`.
  Definer rights are necessary because a kiosk or staff user may not have
  `SELECT` on those columns through RLS.
- If `NEW.location IS NULL`, return `NEW`.
- Always delete the client keys `within_geofence`, `distance_meters`,
  `geofence_radius_meters` from `NEW.location`. The server owns them.
- If `NEW.location` has numeric `latitude` and `longitude`, and the
  restaurant has coordinates, set:
  - `distance_meters` — haversine distance, rounded to an integer,
    earth radius 6371000 m (same constant as `src/lib/haversine.ts:1`).
  - `within_geofence` — `distance_meters <= geofence_radius_meters`.
  - `geofence_radius_meters` — the radius at punch time, for the review UI.
- Keep `location_unavailable` as the client sent it.
- Trigger: `BEFORE INSERT OR UPDATE OF location ON public.time_punches
  FOR EACH ROW`. A manager edit of `punch_time` does not fire it.

Backfill in the same migration: recalculate rows where
`location ? 'latitude'` and the restaurant has coordinates. This is a
small set (1 restaurant).

Limit: the trigger stops a false **flag**. It does not stop a false **GPS
position**. We state this in the help text.

pgTAP test `supabase/tests/time_punch_geofence_trigger.sql`:
inside, outside, no coordinates on restaurant, no location, client sends
`within_geofence: true` from outside (server overrides), `location_unavailable`
kept, update of `punch_time` does not change flags.

### 2. Shared helper and chip

- `src/utils/punchLocationFlag.ts`:
  - `getPunchLocationFlag(location) → 'offsite' | 'unavailable' | null`.
  - `formatDistance(meters)` → `"450 m"` below 1000, `"1.2 km"` from 1000.
  - `sessionLocationFlags(session, punches)` → the flags of the punches of
    that employee between `clock_in` and `clock_out` (or now).
- `src/components/time-clock/PunchLocationFlag.tsx`: one chip.
  - Off-site: amber tint, `MapPin` icon, text "1.2 km away".
  - Unavailable: muted, `MapPinOff` icon, text "No location".
  - `null`: no output.
  - Visible text, so no tooltip is necessary. `aria-label` on the icon
    wrapper: "Punched 1.2 km from the restaurant".

### 3. Status bar

`StatusSummary` gets two optional props: `offsiteCount`,
`locationUnavailableCount`. Each shows a pill button when the count is
above 0. A click sets the Punch List filter and opens the list. Counts come
from `windowPunches` (the viewed day / week / month).

### 4. Review surfaces

- Punch List: replace the three location badges with `PunchLocationFlag`.
  Add a segmented filter: "All" / "Off-site (N)". CSV export adds columns
  `Distance (m)` and `Off-site`.
- Punch Stream: add the chip to each punch row.
- Cards, Barcode, Receipt: add the chip to each session, from
  `sessionLocationFlags`.
- Manual timeline editor: no change. It is an edit surface. The status bar
  pill links to the list.
- Detail dialog: show "1.2 km from the restaurant (limit 200 m)". Keep the
  Maps link.

### 5. Live toast

New hook `src/hooks/useOffsitePunchAlerts.ts`:

- Query key `['offsitePunchAlerts', restaurantId, dayStart]`.
- Select `id, punch_type, punch_time, location, employee:employees(name)`
  where `restaurant_id = X`, `punch_time >= today start` (restaurant time
  zone, from `useRestaurantClock`), and
  `location->>within_geofence = 'false'`.
- `staleTime: 10000`, `refetchInterval: 15000`,
  `refetchIntervalInBackground: false`, `refetchOnWindowFocus: true`.
- First result seeds a `Set` of seen IDs in a ref. No toast on first load.
- Each later new ID shows one toast: title "Maria Lopez clocked in
  off-site", description "1.2 km from the restaurant · 3:58 PM", action
  "View punch" (opens the detail dialog).
- On a restaurant change, clear the set.

Index: add a partial index
`ON time_punches (restaurant_id, punch_time) WHERE (location->>'within_geofence') = 'false'`.
The set is small, so the poll is cheap.

### 6. Help content

Update `src/content/help/scheduling-and-time/time-punches-manager.md` and
`src/content/help/settings-and-integrations/restaurant-profile-general-settings.md`:
off-site flags, clock-out flags, and the GPS limit.

## Out of scope

- Push or email alerts (D5).
- A "mark as reviewed" state for flags.
- Supabase Realtime (D4).
- A map view.

## Tests

- pgTAP: trigger cases in section 1.
- Vitest: `punchLocationFlag` helpers; `useOffsitePunchAlerts` (no toast
  on first load, one toast per new ID, reset on restaurant change);
  `StatusSummary` pills and click.
- E2E: one test. Insert an off-site punch as the employee. The manager page
  shows the pill and the chip.

## Decided trade-offs

- The poll can show an alert up to 15 s late. This is acceptable for an
  in-app alert.
