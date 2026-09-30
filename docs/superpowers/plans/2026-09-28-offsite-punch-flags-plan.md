# Plan: off-site punch flags

Design: `docs/superpowers/specs/2026-09-28-offsite-punch-flags-design.md`
Branch: `feature/offsite-punch-flags`

Tasks 1–10 are in order. Each task depends on the tasks before it.
Run unit tests with `npx vitest run <file>`. Run pgTAP with `npm run test:db`.
Use semantic color tokens. The only allowed tint is the amber warning pattern
from CLAUDE.md (`bg-amber-500/10 border-amber-500/20`).

## Task 1 — RED: pgTAP tests for `set_punch_geofence`

File: `supabase/tests/time_punch_geofence_trigger.sql`

1. Seed one restaurant with `latitude`, `longitude`, and
   `geofence_radius_meters = 200`. Seed one restaurant with no coordinates.
   Seed one employee for each.
2. Add these cases (one `is()` or `ok()` each):
   - A punch 50 m away: `within_geofence = true`, `distance_meters` near 50,
     `geofence_radius_meters = 200`.
   - A punch about 1 km away: `within_geofence = false`.
   - The client sends `within_geofence: true` and `distance_meters: 0` from
     1 km away. The server writes `false` and the real distance.
   - A restaurant with no coordinates: the three server keys are absent.
   - `location IS NULL`: the row keeps `location IS NULL`.
   - A Sling-style insert with no `location` column: `lives_ok`, no change.
   - `latitude` as a JSON string: `lives_ok`, no server keys.
   - `latitude = 999`: `lives_ok`, no server keys.
   - `location_unavailable: true` is kept.
   - `UPDATE ... SET punch_time`: the flags do not change.
   - The restaurant radius changes to 2000, then `UPDATE ... SET location`
     with the same coordinates: `geofence_radius_meters` stays 200.
   - The partial index `idx_time_punches_offsite` exists (`has_index`).
3. Run `npm run test:db`. The new file must fail.

## Task 2 — GREEN: migration with trigger, index, and backfill

File: `supabase/migrations/20260928120000_time_punch_geofence_trigger.sql`

1. Create `public.set_punch_geofence()` as the design section 1 states:
   `SECURITY DEFINER`, `SET search_path = public`, `jsonb_typeof` checks,
   range checks, haversine with R = 6371000, `round()` to an integer.
2. Put a short comment at the top of the function. It states that the
   function changes only `NEW`.
3. Create the trigger `trg_set_punch_geofence`,
   `BEFORE INSERT OR UPDATE OF location ON public.time_punches FOR EACH ROW`.
4. Create `idx_time_punches_offsite ON public.time_punches (restaurant_id,
   punch_time) WHERE (location->>'within_geofence') = 'false'`.
5. Backfill after the trigger: `UPDATE time_punches tp SET location =
   tp.location FROM restaurants r WHERE r.id = tp.restaurant_id AND
   r.latitude IS NOT NULL AND r.longitude IS NOT NULL AND tp.location ?
   'latitude'`. For the backfill only, the UPDATE rule must recalculate.
   Use a session flag (`set_config('app.geofence_backfill','on',true)`) that
   the function reads, or compute the keys in the UPDATE directly. Pick one
   and comment it.
6. `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` on the function.
7. Run `npm run db:reset`, then `npm run test:db`. All tests must pass.
8. Run `EXPLAIN` on the Task 6 poll query on local. Record the plan line in
   the commit message.

## Task 3 — RED then GREEN: `punchLocationFlag` helpers

Test file: `tests/unit/punchLocationFlag.test.ts`
Source file: `src/utils/punchLocationFlag.ts`

1. RED: add cases:
   - `getPunchLocationFlag(undefined)` → `null`.
   - `{ within_geofence: false, distance_meters: 1200 }` → `'offsite'`.
   - `{ within_geofence: true }` → `null`.
   - `{ location_unavailable: true }` → `'unavailable'`.
   - `{ latitude: 1, longitude: 2 }` with no flag → `null`.
   - `formatDistance(450)` → `"450 m"`; `formatDistance(999)` → `"999 m"`;
     `formatDistance(1000)` → `"1.0 km"`; `formatDistance(1234)` → `"1.2 km"`.
   - `buildLocationFlagIndex` keeps only flagged punches, grouped by
     `employee_id`, sorted by `punch_time`.
   - `sessionLocationFlags(session, index)` returns flags for punches from
     `clock_in` to `clock_out`. An open session uses now. A punch of another
     employee is not in the result.
2. Run the file. It must fail.
3. GREEN: write the four functions. Add `geofence_radius_meters?: number` to
   `TimePunch.location` in `src/types/timeTracking.ts`.
4. Run the file. It must pass.

## Task 4 — `PunchLocationFlag` chip

File: `src/components/time-clock/PunchLocationFlag.tsx`
Test file: `tests/unit/PunchLocationFlag.test.tsx`

1. RED: render with an off-site location. Expect the text "1.2 km away".
   Expect the icon to have `aria-hidden="true"`. Render with
   `location_unavailable`. Expect "No location". Render with `null` flag.
   Expect an empty container.
2. GREEN: write the chip. Off-site: `MapPin`, amber tint pattern,
   `text-[11px] px-1.5 py-0.5 rounded-md`. Unavailable: `MapPinOff`,
   `bg-muted text-muted-foreground`. Wrap in `React.memo`. No hooks.
3. Run the test. It must pass.

## Task 5 — `StatusSummary` pills

Files: `src/components/time-clock/StatusSummary.tsx`,
`tests/unit/StatusSummary.test.tsx` (create or extend)

1. RED: with `offsiteCount={2}` and `onShowOffsite`, expect a button named
   "2 off-site punches. Show them in the punch list." A click calls
   `onShowOffsite`. With `offsiteCount={0}`, expect no button. Same pattern
   for `locationUnavailableCount` and `onShowLocationUnavailable`.
2. GREEN: add the optional props and the two `<button type="button">`
   pills. Use `min-h-6 min-w-6`, `whitespace-nowrap`,
   `focus-visible:ring-1 focus-visible:ring-border`. Short visible labels
   "2 off-site" and "1 no location". Keep the current `flex flex-wrap` row.
3. Run the test. It must pass.

## Task 6 — `useOffsitePunchAlerts` hook

Files: `src/hooks/useOffsitePunchAlerts.ts`,
`tests/unit/useOffsitePunchAlerts.test.ts`

1. RED: mock Supabase and `useToast`. Cases:
   - The first result has 2 rows. No toast.
   - The next result adds 1 row. One toast. Its title is
     "Maria Lopez clocked in off-site".
   - The same rows again. No new toast.
   - `restaurantId` changes. The first result for the new restaurant gives
     no toast.
   - `punch_type = 'clock_out'` gives the title "... clocked out off-site".
2. GREEN: write the hook as design section 5 states. Parameters:
   `restaurantId`, `onViewPunch(punchId)`. Use `useRestaurantClock()` for
   `today` and `tz`. Convert the day start to UTC with `parseWallClock`.
   Use `ToastAction` with `altText`. Format the time with
   `formatInstant(punch_time, 'h:mm a')`.
3. Run the test. It must pass.

## Task 7 — Manager page: status bar, filter, toast, CSV

File: `src/pages/TimePunchesManager.tsx`

1. Compute `offsiteCount` and `locationUnavailableCount` from
   `windowPunches` with `useMemo` and `getPunchLocationFlag`.
2. Add state `locationFilter: 'all' | 'offsite' | 'unavailable'`. The list
   shows `windowPunches` filtered by it.
3. Pass the counts and the two callbacks to `StatusSummary` (line ~618).
   Each callback sets the filter and calls `setTableOpen(true)`, then scrolls
   the Punch List into view.
4. In the Punch List header, add the segmented filter "All" / "Off-site (N)".
   Show "No location (N)" only when N > 0. Use `role="radiogroup"` or
   buttons with `aria-pressed`.
5. Replace the amber and blue badges (lines ~896–912) with
   `<PunchLocationFlag location={punch.location} />`.
6. In the detail dialog (lines ~1201–1205), show
   "1.2 km from the restaurant (limit 200 m)". Keep the Maps link. When
   `geofence_radius_meters` is absent, omit "(limit …)".
7. Call `useOffsitePunchAlerts(restaurantId, openPunchDetail)`. Find the
   current detail-dialog state setter and use it.
8. CSV (`handleExportCSV`, line ~556): add columns `Distance (m)` and
   `Off-site` (`Yes` / `No` / empty).
9. Run `npm run typecheck` and the page tests in `tests/unit` that import
   `TimePunchesManager`, if any.

## Task 8 — Chip in Stream, Cards, Barcode, Receipt

Files: `src/components/time-tracking/PunchStreamView.tsx`,
`EmployeeCardView.tsx`, `BarcodeStripeView.tsx`, `ReceiptStyleView.tsx`,
`src/pages/TimePunchesManager.tsx`

1. Stream: add `<PunchLocationFlag>` to each punch row, from
   `original_punch.location`.
2. Cards, Barcode, Receipt: add the prop `punches: TimePunch[]`. Build the
   index one time with `useMemo(() => buildLocationFlagIndex(punches),
   [punches])`. For each session, show one chip for the worst flag
   (off-site over unavailable) with the largest distance.
3. Pass `windowPunches` from `TimePunchesManager` to each view.
4. Update the unit tests of these views, if any, for the new prop.
5. Run `npm run typecheck` and `npx vitest run tests/unit`.

## Task 9 — Help content

Files: `src/content/help/scheduling-and-time/time-punches-manager.md`,
`src/content/help/settings-and-integrations/restaurant-profile-general-settings.md`

1. Add a section "Off-site punches". Explain the chip, the status bar pill,
   the filter, and the live alert while the page is open.
2. State that the server checks the distance for clock-in, clock-out, and
   breaks, also when enforcement is `off`, if the restaurant has an address
   position.
3. State the limits: a false GPS position, and a punch with no location.
4. Write in STE-aligned English. Run any help-content test in `tests/unit`.

## Task 10 — E2E: off-site punch shows to the manager

File: `tests/e2e/offsite-punch-flag.spec.ts`

1. Use the helpers in `../helpers/e2e-supabase` and `generateTestUser()`.
2. Seed a restaurant with coordinates and a manager. Insert one employee
   punch through the Supabase client with a location 1 km away and
   `within_geofence: true`.
3. Open the Time Clock manager page for today.
4. Expect the button "1 off-site punch. Show them in the punch list."
   Click it. Expect the Punch List to open, filtered, with the text
   "1.0 km away".
5. Run `npx playwright test tests/e2e/offsite-punch-flag.spec.ts
   --reporter=line` in the foreground.
