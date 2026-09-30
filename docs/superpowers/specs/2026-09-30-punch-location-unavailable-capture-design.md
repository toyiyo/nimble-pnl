# Punch location unavailable on GPS failure — design

Date: 2026-09-30
Branch: `claude/beautiful-tesla-cqgzji`
PR: toyiyo/nimble-pnl#831
Source: deferred Codex P2 finding on toyiyo/nimble-pnl#830
(`src/utils/punchLocationFlag.ts:16`)
Status: approach B and Kiosk E2E chosen by the user after Phase 2.5 review

## Problem

A punch that tries to read GPS and gets no position must carry
`location_unavailable: true`. Then the "no location" count, filter, and chip
from PR #830 show the punch. Some capture paths send no location object at
all. `getPunchLocationFlag` returns `null` for such a punch, so the manager
never sees it.

A punch that never tries to read GPS (manual entry, import) must stay without
a flag.

## Current behavior on `origin/main` (cited)

Flag logic:

- `getPunchLocationFlag` returns `null` when `location` is missing
  (`src/utils/punchLocationFlag.ts:15-17`). It returns `'unavailable'` when
  `location.location_unavailable` is true
  (`src/utils/punchLocationFlag.ts:19-21`).

Server trigger (`supabase/migrations/20260928120000_time_punch_geofence_trigger.sql`):

- If `NEW.location IS NULL`, the trigger returns at once (`:22-24`).
- It always deletes the client keys `within_geofence`, `distance_meters`,
  `geofence_radius_meters` (`:27`).
- It deletes `location_unavailable` when both coordinates are numeric
  (`:33-37`). In all other cases the client value stays.
- It calculates the geofence keys only from numeric `latitude` and
  `longitude` (`:73-111`).
- Result: the server flags a punch from the coordinates in the payload and
  from `location_unavailable`. A client distance without coordinates is lost.

GPS capture:

- `getQuickLocation` resolves `undefined` when `navigator.geolocation` is
  missing (`src/utils/punchContext.ts:39-41`), on timeout
  (`src/utils/punchContext.ts:44`), and on error
  (`src/utils/punchContext.ts:53-56`). It never sets a failure flag.
- `collectPunchContext` returns the in-flight promise when one exists
  (`src/utils/punchContext.ts:108-110`).
- `mergePunchLocation` returns `undefined` when there are no coordinates and
  no `locationUnavailable` flag (`src/utils/punchContext.ts:14`).

Kiosk (`src/pages/KioskMode.tsx`):

- The camera dialog starts the GPS read with `startPunchContext(3000)`
  (`:180`).
- `handlePunch` reads the context with `collectPunchContext(3000)` (`:356`),
  after the PIN check (`:339`) and the status check (`:346`).
- The online punch sends `location: punchContextSnapshot.location` (`:424`).
  A failed GPS read sends `undefined`. **This is the Codex finding.**
- A failure before `:356` goes to `handleOfflineQueue` with
  `context = null` (`:358`). `handleOfflineQueue` returns `false` when there
  is no `employeeId` (`:300`), so only a status-check failure queues.
- A failed mutate also goes to `handleOfflineQueue` (`:468-469`).
- `queuePunchOffline` sends `location: context?.location` (`:603`). A failed
  GPS read, or a `null` context, sends `undefined`.

Employee app (`src/pages/EmployeeClock.tsx`):

- The geofence check sets `pendingLocationUnavailable` to `true` only when
  the check itself fails (`:155-159`). The check fails with
  `locationUnavailable: true` (`src/hooks/useGeofenceCheck.ts:73-74`).
- The check does not run when enforcement is `off` or the restaurant has no
  coordinates (`src/hooks/useGeofenceCheck.ts:59-61`).
- The punch waits for the context for at most 3 seconds (`:239-241`). On
  timeout, `context` is `undefined`.
- The punch sends
  `mergePunchLocation(context?.location, geofenceResult, locationUnavailable)`
  (`:248`). With the geofence off, a GPS failure or the 3-second timeout
  sends `undefined`. **This is a second instance of the Codex finding.**

Offline queue (`src/utils/offlineQueue.ts`):

- The queued `location` type allows only `latitude` and `longitude` (`:13-16`).
- The flush sends `location` unchanged (`:142`).

Paths that create punches but do not read GPS:

- `MobileTimeEntry` sends no `location`
  (`src/components/time-tracking/MobileTimeEntry.tsx:108-122`).
- `ManualTimelineEditor` creates punches with no `location`
  (`src/components/time-tracking/ManualTimelineEditor.tsx:312-340`).
- The manager Force Clock Out calls `createPunch.mutate`
  (`src/pages/TimePunchesManager.tsx:1193`).
- `RecordShiftClockDialog` and `TimePunchUploadSheet` use
  `useBulkCreateTimePunches`
  (`src/components/payroll/RecordShiftClockDialog.tsx:69`,
  `src/components/time-tracking/TimePunchUploadSheet.tsx:158`). The bulk
  insert is at `src/hooks/useTimePunches.tsx:426`.
- The Sling sync inserts punches in SQL
  (`supabase/migrations/20260223100100_sling_sync_rpc.sql:79`).

None of these paths calls `punchContext`. None gets the flag.

Geofence read and quick read:

- On a native platform the geofence check reads GPS through the Capacitor
  `Geolocation` plugin (`src/hooks/useGeofenceCheck.ts:66-67`). The quick
  read uses `navigator.geolocation` (`src/utils/punchContext.ts:39-45`).
  The two reads do not share a cache.
- The native app is `com.easyshifthq.employee` (`capacitor.config.ts:4`).
  It runs `EmployeeClock`.
- A checked geofence result has the position as `userLat` and `userLng`
  (`src/hooks/useGeofenceCheck.ts:40-41`). `EmployeeClock` keeps only
  `distanceMeters` and `within` (`src/pages/EmployeeClock.tsx:149`, `:164`).
- The in-flight quick read stays reusable for `PUNCH_CONTEXT_REUSE_MS`
  (10 s) after it resolves (`src/utils/punchContext.ts:31`, `:93-99`).
  After that, `collectPunchContext` starts a new read.

## Approaches

**A. One helper; no quick-read coordinates means unavailable.** Simple. But
in `warn` mode an employee outside the radius accepts the warning, and then
the quick read fails. The punch shows "No location", not "off-site". On the
native app, an on-site punch can also get a false "No location" chip.

**B. A + use the geofence position as a fallback (chosen).** `EmployeeClock`
keeps `userLat` and `userLng` from the checked geofence result. When the
quick read has no coordinates, the helper sends the geofence coordinates.
The server then calculates the flag from them.

**C. Add a `location_unavailable` field to `PunchContextResult`.** Every
caller then reads two fields. The helper gives the same result with one
call and no change to the context type.

Decision: **B** (user decision after the Phase 2.5 review).

## Design

### `punchContextLocation` (`src/utils/punchContext.ts`)

```ts
export interface PunchGeofenceResult {
  distanceMeters?: number;
  within?: boolean;
  latitude?: number;
  longitude?: number;
}

export function punchContextLocation(
  context: { location?: { latitude: number; longitude: number } } | null | undefined,
  geofenceResult?: PunchGeofenceResult,
  geofenceUnavailable = false
): PunchLocation {
  const base = context?.location ?? geofenceCoordinates(geofenceResult);
  return (
    mergePunchLocation(base, geofenceResult, geofenceUnavailable || base == null) ?? {
      location_unavailable: true,
    }
  );
}
```

- `geofenceCoordinates` returns `{ latitude, longitude }` only when both
  values are finite numbers. Otherwise it returns `undefined`.
- The quick-read coordinates win, because the quick read is the later read.
- No coordinates at all → `location_unavailable: true`. Without coordinates
  the trigger cannot flag the punch off-site (`:73-111`), so "no location" is
  the true state.
- The first cut counted a geofence distance as a position. That is wrong:
  the trigger deletes the distance (`:27`), so the stored location is `{}`
  and the punch gets no flag. This design deletes that exception and
  reverts the matching `mergePunchLocation` change.
- The `?? { location_unavailable: true }` fallback replaces a non-null
  assertion. A later change to `mergePunchLocation` cannot make the helper
  return `undefined`.

### Payload and stored row

The trigger decides the stored row
(`supabase/migrations/20260928120000_time_punch_geofence_trigger.sql`).

| Client payload | Stored `location` | Flag |
|---|---|---|
| `{latitude, longitude}` | coordinates + server geofence keys (`:73-111`) | `null` or `offsite` |
| `{location_unavailable: true}` | kept (`:33-37`, pgTAP case 9) | `unavailable` |
| `{latitude, longitude, location_unavailable: true}` (geofence check failed, quick read good) | flag deleted (`:36`, pgTAP case 9b), geofence calculated | `null` or `offsite` |
| `{distance_meters, within_geofence, location_unavailable: true}` | `{location_unavailable: true}` (`:27`) | `unavailable` |
| `undefined` (manual, import, Sling) | `NULL` (`:22-24`) | `null` |

After this change, no GPS capture path sends `undefined`.

### Capture sites

| Site | Change |
|---|---|
| `KioskMode` online punch (`:424`) | `location: punchContextLocation(punchContextSnapshot)` |
| `KioskMode` `queuePunchOffline` (`:603`) | `context ?? await collectPunchContext(3000)`, then `punchContextLocation(...)`. |
| `EmployeeClock` geofence state (`:149`, `:164`) | Keep `latitude: userLat` and `longitude: userLng` in `pendingGeofenceResult`. |
| `EmployeeClock` punch (`:248`) | `punchContextLocation(context, geofenceResult, locationUnavailable)` |
| `offlineQueue.ts` type (`:13-16`) | `location?: PunchLocation` |

In `queuePunchOffline`, `collectPunchContext` reuses the read that started
at `KioskMode.tsx:180` when that read resolved less than 10 s before
(`punchContext.ts:93-99`). Otherwise it starts a new read of at most 3 s.

No server change. No change to the paths that do not read GPS.

## Tests

Unit (`tests/unit/`):

- `punchContext.test.ts`:
  - The helper with quick-read coordinates; with no coordinates; with a
    `null` or `undefined` context.
  - Quick read failed, geofence coordinates present → geofence coordinates,
    no flag.
  - Quick read failed, geofence distance but no coordinates → flag set.
  - Geofence check failed, quick read good → coordinates and flag (the
    server deletes the flag, pgTAP case 9b).
  - Quick-read coordinates win over geofence coordinates.
  - A real `collectPunchContext` GPS error resolves to a flagged location.
  - Delete the first-cut test "keeps the geofence data when base location
    is undefined". Add a regression test:
    `mergePunchLocation(undefined, geo)` returns `undefined`.
- `KioskMode.test.tsx`: online punch after a failed GPS read; offline queue
  after a failed mutate; offline queue after a failed status check
  (`context = null`); success path with coordinates.
- `EmployeeClock.test.tsx`:
  - GPS failure with the geofence off; the 3-second timeout; success path.
  - Geofence `warn` with coordinates, then the quick read fails → the
    payload has the geofence coordinates and no flag.
  - Geofence check fails, the user proceeds after the warning
    (`EmployeeClock.tsx:178-183`), and the quick read fails → the payload
    has `location_unavailable: true`. Try Again sends the same payload.

E2E (`tests/e2e/kiosk-location-unavailable.spec.ts`):

- The owner seeds one employee and one `employee_pins` row (SHA-256 of the
  PIN, as `src/utils/kiosk.ts:34-41` does).
- An init script replaces `navigator.geolocation.getCurrentPosition` with a
  function that calls the error callback.
- The owner launches the kiosk, enters the PIN, taps Clock In, then Skip
  photo.
- The test reads the punch with the owner session. It expects `location` to
  equal `{"location_unavailable": true}`.
- This container has no local Supabase. Only the CI E2E shards run the spec.

TLA+: no trigger matches. The change adds no writer, cursor, retry, or lock.
The offline queue retry logic does not change.

## Risks

- A browser with no geolocation API now sends `location_unavailable: true`
  from the Kiosk. That is correct: the punch tried to read GPS and got no
  position.
- `queuePunchOffline` can wait up to 3 s more when `context` is `null` and
  the first read is older than 10 s. This path runs only offline, after a
  failed status check. The processing lock stays on during the wait
  (`KioskMode.tsx:368` runs after `handleOfflineQueue`), so the next
  employee waits too.
- Entries that the old code queued in `localStorage` have no `location`.
  They flush as `NULL` and get no flag. A kiosk tab that runs the old bundle
  sends `undefined` until it reloads. The server cannot tell these rows
  from manual punches, so we accept the gap.
- Numeric coordinates out of range get no client flag and no server flag
  (`:73-86`). Real GPS output does not produce them. Out of scope.

## Out of scope

- `queuePunchOffline` calls `resetCameraState()`. On the `onError` path this
  runs after `releaseLock()`, so it can close the next employee's camera
  dialog. This hazard exists on `origin/main`. It gets a separate task.
