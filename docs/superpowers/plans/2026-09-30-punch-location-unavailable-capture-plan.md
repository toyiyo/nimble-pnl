# Plan: punch location unavailable on GPS failure

Design: `docs/superpowers/specs/2026-09-30-punch-location-unavailable-capture-design.md`
Branch: `claude/beautiful-tesla-cqgzji`
PR: toyiyo/nimble-pnl#831

Run unit tests with `TZ=UTC npx vitest run <file>`. Tasks 1–4 are on the
branch in commit `ca072ff` (first cut, written with TDD before this plan).
Tasks 5–7 change that first cut to match the design. Each task depends
on the tasks before it.

## Task 1 — DONE (`ca072ff`): helper `punchContextLocation`

File: `src/utils/punchContext.ts`, test `tests/unit/punchContext.test.ts`.

## Task 2 — DONE (`ca072ff`): Kiosk online punch and offline queue

Files: `src/pages/KioskMode.tsx`, `src/utils/offlineQueue.ts`,
test `tests/unit/KioskMode.test.tsx`.

- Online punch: `location: punchContextLocation(punchContextSnapshot)`.
- `queuePunchOffline`: `context ?? await collectPunchContext(3000)`, then
  `punchContextLocation(...)`.
- Queue type: `location?: PunchLocation`.
- Tests: failed GPS read on the online punch; on the offline queue after a
  failed mutate; on the offline queue after a failed status RPC
  (`context = null`); success with coordinates.

## Task 3 — DONE (`ca072ff`): EmployeeClock

File: `src/pages/EmployeeClock.tsx`, test `tests/unit/EmployeeClock.test.tsx`.

- `location: punchContextLocation(context, geofenceResult, locationUnavailable)`.
- Tests: GPS failure with the geofence off; the 3-second timeout; success.

## Task 4 — DONE (`ca072ff`): keep the pure helpers real in page tests

The `@/utils/punchContext` mocks in `KioskMode.test.tsx` and
`EmployeeClock.test.tsx` spread `importOriginal()` and replace only
`collectPunchContext` and `startPunchContext`.

## Task 5 — TODO: the helper counts only coordinates as a position

Files: `src/utils/punchContext.ts`, `tests/unit/punchContext.test.ts`.

1. RED:
   - Change the case "does not set location_unavailable when the geofence
     check got a position". Input: no quick-read coordinates, geofence
     distance, no geofence coordinates. Expect
     `{ distance_meters: 50, within_geofence: true, location_unavailable: true }`.
   - Add: quick read failed, geofence `latitude`/`longitude` present →
     geofence coordinates plus distance, no flag.
   - Add: quick-read coordinates win over geofence coordinates.
   - Add: geofence coordinates that are not finite numbers are ignored.
   - Delete "keeps the geofence data when base location is undefined". Add:
     `mergePunchLocation(undefined, { distanceMeters: 500, within: false })`
     returns `undefined`.
   - Run the file. The new and changed cases must fail.
2. GREEN:
   - Export `PunchGeofenceResult` with optional `latitude` and `longitude`.
   - Add a private `geofenceCoordinates()` helper.
   - `punchContextLocation`: `base = context?.location ?? geofenceCoordinates(geo)`.
     Flag when `geofenceUnavailable || base == null`. Return type
     `PunchLocation`, with the `?? { location_unavailable: true }` fallback.
   - Revert the `mergePunchLocation` guard to
     `if (!baseLocation && !locationUnavailable) return undefined;`.
   - Change the JSDoc: the server deletes a client distance
     (`supabase/migrations/20260928120000_time_punch_geofence_trigger.sql:27`).
3. Run the file. All cases must pass.
4. Commit `fix(time-tracking): count only coordinates as a punch position`.

## Task 6 — TODO: EmployeeClock keeps the geofence coordinates

Files: `src/pages/EmployeeClock.tsx`, `tests/unit/EmployeeClock.test.tsx`.

1. RED:
   - Geofence `warn` result with `checked: true`, `userLat`, `userLng`,
     `distanceMeters: 1500`, `within: false`. The user proceeds. The quick
     read returns `{ location: undefined }`. Expect the payload `location`
     to hold the geofence coordinates and the distance, and no flag.
   - Geofence check returns `locationUnavailable: true`. The user proceeds
     through the "unavailable" dialog. The quick read fails. Expect
     `{ location_unavailable: true }`. Fail the mutate, click Try Again, and
     expect the same payload object.
   - Run the file. The first case must fail.
2. GREEN: type `pendingGeofenceResult` as `PunchGeofenceResult`. At `:149`
   and `:164`, also set `latitude: geofenceResult.userLat` and
   `longitude: geofenceResult.userLng`.
3. Run the `punchContext`, `KioskMode`, `EmployeeClock` and
   `punchLocationFlag` tests. All must pass.
4. Commit `fix(time-tracking): send the geofence position when the quick read fails`.

## Task 7 — TODO: Kiosk E2E with a failed GPS read

File: `tests/e2e/kiosk-location-unavailable.spec.ts`.

1. Follow `tests/e2e/offsite-punch-flag.spec.ts` for setup
   (`signUpAndCreateRestaurant`, `__getRestaurantId`, `__insertEmployees`).
2. Insert one `employee_pins` row with the owner session. `pin_hash` is the
   SHA-256 hex of the PIN (`src/utils/kiosk.ts:34-41`). Use a PIN that is
   not a simple sequence, for example `4829`.
3. Add an init script: `navigator.geolocation.getCurrentPosition` calls the
   error callback with code 1.
4. Launch the kiosk as `tests/e2e/kiosk-basic-punch.spec.ts` does. Enter the
   PIN, tap Clock In, then Skip photo. Wait for the status "Clocked in".
5. Poll `time_punches` for the employee with the owner session. Expect one
   row with `location` equal to `{ location_unavailable: true }`.
6. Run `npx eslint` and `npx tsc --noEmit -p tsconfig.json` on the file.
   Local Supabase is not available here, so CI runs the spec.
7. Commit `test(e2e): kiosk punch with a failed GPS read stores location_unavailable`.

## After the build

Phases 5–9 as the development-workflow skill states. Phase 5 is skipped: no
UI file changes its rendered output. Local Verify runs unit, typecheck, lint
(changed files) and build. CI runs pgTAP and E2E.
