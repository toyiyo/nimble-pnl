# Kiosk offline queue: late camera reset — design

## Problem

`handlePunch` shows the result at once (optimistic UI). It calls
`releaseLock()` before the background `createPunch.mutate` finishes
(`src/pages/KioskMode.tsx:405`).

When the mutate fails and the device is offline, `onError` calls
`handleOfflineQueue` (`src/pages/KioskMode.tsx:472`). That function calls
`queuePunchOffline` (call site `src/pages/KioskMode.tsx:301`, definition
`src/pages/KioskMode.tsx:592`). Before this change, `queuePunchOffline` called `resetCameraState()` at its end.

`resetCameraState()` stops the camera, closes the camera dialog, and clears
`capturedPhotoBlob`, `pendingAction` and `cameraError`
(`src/pages/KioskMode.tsx:581-590`). On the `onError` path this runs after
`releaseLock()`. The next employee can already have the camera dialog open.
The late reset closes the dialog of that employee.

## Facts about the current code

- Both callers of `handlePunch` call `resetCameraState()` before they call
  `handlePunch`: Skip photo (`src/pages/KioskMode.tsx:195`) and Confirm punch
  (`src/pages/KioskMode.tsx:977`).
- The Clock In and Clock Out buttons are disabled while `processing` is true
  (`src/pages/KioskMode.tsx:784,793`). Thus a new camera dialog cannot open while
  `handlePunch` holds the lock.
- The synchronous `catch` in `handlePunch` runs before `releaseLock()`
  (`src/pages/KioskMode.tsx:357-373`).

## Approaches

1. **Reset only on the synchronous `catch` path (chosen).** Delete the
   `resetCameraState()` call from `queuePunchOffline`. Call it in the
   `catch` in `handlePunch` when the punch goes to the offline queue. At that
   point the lock is held, so no newer punch owns the camera.
2. **Compare `opIdRef`.** Reset only when `opIdRef.current === myOpId`. This
   is not sufficient. A new employee can open the dialog without a new
   `handlePunch`, so `opIdRef` does not change.
3. **Delete the reset completely.** Both callers already reset the camera.
   This is also correct, but approach 1 keeps the synchronous path the same
   as before.

## Decision

Use approach 1. The `onError` path never touches the camera state.

## Tests

`tests/unit/KioskMode.test.tsx`: punch A mutate stays pending. Employee B
opens the camera dialog. Punch A `onError` fires with `isLikelyOffline()`
true. Expect `addQueuedPunch` to run once, B's dialog to stay open, and the
camera `stopCamera` mock to not run.

## Out of scope

`queuePunchOffline` also sets the status message "Saved offline — will sync
when online." on the late `onError` path. This can replace the status of a
newer punch. This change does not fix that.
