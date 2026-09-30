# Plan: punch location unavailable on GPS failure

Design: `docs/superpowers/specs/2026-09-30-punch-location-unavailable-capture-design.md`
Branch: `claude/beautiful-tesla-cqgzji`
PR: toyiyo/nimble-pnl#831

Run unit tests with `TZ=UTC npx vitest run <file>`. Tasks 1–4 are on the
branch in commit `ca072ff` (first cut, written with TDD before this plan).
Task 5 changes that first cut to match the design. Task 5 depends on
tasks 1–4.

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

## Task 5 — TODO: no coordinates in the payload means unavailable

Files: `src/utils/punchContext.ts`, `tests/unit/punchContext.test.ts`.

1. RED: in `punchContextLocation` tests, change the case "does not set
   location_unavailable when the geofence check got a position". The new
   expectation: `{ distance_meters: 50, within_geofence: true,
   location_unavailable: true }`. Delete the `mergePunchLocation` test
   "keeps the geofence data when base location is undefined". Run the file.
   The changed case must fail.
2. GREEN: in `punchContextLocation`, set the flag when
   `context?.location == null` or `geofenceUnavailable`. Delete the
   geofence-distance exception. Change the return type to `PunchLocation`.
   Revert the `mergePunchLocation` guard to
   `if (!baseLocation && !locationUnavailable) return undefined;`.
3. Change the JSDoc: the server deletes a client distance
   (`supabase/migrations/20260928120000_time_punch_geofence_trigger.sql:27`),
   so a distance alone is not a position.
4. Run `punchContext`, `KioskMode`, `EmployeeClock`, and `punchLocationFlag`
   tests. All must pass.
5. Commit `fix(time-tracking): count only coordinates as a punch position`.

## After the build

Phases 5–9 as the development-workflow skill states. Phase 5 is skipped: no
UI file changes its rendered output. E2E is a justified exception (design
doc, Tests section).
