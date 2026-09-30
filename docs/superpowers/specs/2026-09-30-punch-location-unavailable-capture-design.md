# Punch location unavailable on GPS failure — design

Date: 2026-09-30
Branch: `claude/beautiful-tesla-cqgzji`
PR: toyiyo/nimble-pnl#831
Source: deferred Codex P2 finding on toyiyo/nimble-pnl#830
(`src/utils/punchLocationFlag.ts:16`)
Status: proposed (retroactive — the first cut is on the PR; this design
corrects it)

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

Paths that do not read GPS:

- `MobileTimeEntry` sends no `location`
  (`src/components/time-tracking/MobileTimeEntry.tsx:108-122`).
- `ManualTimelineEditor` creates punches with no `location`
  (`src/components/time-tracking/ManualTimelineEditor.tsx:312-340`).
- The bulk import inserts rows from the import mapper
  (`src/hooks/useTimePunches.tsx:426`). It does not call `punchContext`.

## Approaches

**A. One helper, "no coordinates in the payload" means unavailable
(recommended).** Add `punchContextLocation(context, geofenceResult?,
geofenceUnavailable?)` to `src/utils/punchContext.ts`. It returns
`mergePunchLocation(...)` with `location_unavailable: true` when the context
has no coordinates, or when the geofence check failed. Only GPS capture paths
call it. Manual and import paths do not change.

**B. A + carry the geofence coordinates.** Also keep `userLat` and `userLng`
from the geofence check in `EmployeeClock`, and send them when the quick
read has none. More state for a rare case: `getQuickLocation` uses
`maximumAge: 60000` (`src/utils/punchContext.ts:60`), so after a good
geofence read the quick read almost always returns the cached fix.

**C. Add a `location_unavailable` field to `PunchContextResult`.** Every
caller then reads two fields. The helper in A gives the same result with one
call and no change to the context type.

Decision: **A**.

## Design

### `punchContextLocation` (`src/utils/punchContext.ts`)

```ts
export function punchContextLocation(
  context: { location?: { latitude: number; longitude: number } } | null | undefined,
  geofenceResult?: { distanceMeters?: number; within?: boolean },
  geofenceUnavailable = false
): PunchLocation {
  return mergePunchLocation(
    context?.location,
    geofenceResult,
    geofenceUnavailable || context?.location == null
  )!;
}
```

- No coordinates → `location_unavailable: true`. This matches what the
  server stores: without coordinates the trigger cannot flag the punch
  off-site, so "no location" is the true state.
- The first cut on the PR counted a geofence distance as a position. That is
  wrong: the trigger deletes the distance (`:27`), so the stored location is
  `{}` and the punch gets no flag. This design deletes that exception and
  reverts the matching `mergePunchLocation` change.
- The return value is never `undefined`, so the type is `PunchLocation`.

### Capture sites

| Site | Change |
|---|---|
| `KioskMode` online punch (`:424`) | `location: punchContextLocation(punchContextSnapshot)` |
| `KioskMode` `queuePunchOffline` (`:603`) | `context ?? await collectPunchContext(3000)`, then `punchContextLocation(...)`. The GPS read started at `:180`, so the call reuses the in-flight promise. |
| `EmployeeClock` (`:248`) | `punchContextLocation(context, geofenceResult, locationUnavailable)` |
| `offlineQueue.ts` type (`:13-16`) | `location?: PunchLocation` |

No change to `MobileTimeEntry`, `ManualTimelineEditor`, or the import.

No server change. The trigger keeps `location_unavailable` when there are no
coordinates (`:33-37`).

## Tests

Unit (`tests/unit/`):

- `punchContext.test.ts`: helper with coordinates, with no coordinates, with
  a `null` or `undefined` context, with a geofence distance and no
  coordinates (flag set), with a failed geofence check. A real
  `collectPunchContext` GPS error resolves to a flagged location.
- `KioskMode.test.tsx`: online punch after a failed GPS read; offline queue
  after a failed mutate; offline queue after a failed status check
  (`context = null`); success path with coordinates.
- `EmployeeClock.test.tsx`: GPS failure with the geofence off; the 3-second
  timeout; success path.

E2E: justified exception. A Playwright test cannot make the browser GPS read
fail and then read the stored `location` without a new geolocation-denial
harness. The unit tests cover every capture site. The pgTAP test from #830
already covers the server side of `location_unavailable`
(`supabase/tests/time_punch_geofence_trigger.sql`).

TLA+: no trigger matches. The change adds no writer, cursor, retry, or lock.
The offline queue retry logic does not change.

## Risks

- A browser with no geolocation API now sends `location_unavailable: true`
  from the Kiosk. That is correct: the punch tried to read GPS and got no
  position.
- `queuePunchOffline` can now wait up to 3 seconds when `context` is `null`.
  This path runs only offline, after a failed status check. The GPS read is
  usually already done, so the wait is short.
