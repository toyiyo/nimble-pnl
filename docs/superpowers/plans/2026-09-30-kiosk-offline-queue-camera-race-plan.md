# Kiosk offline queue: late camera reset — plan

Design: `docs/superpowers/specs/2026-09-30-kiosk-offline-queue-camera-race-design.md`

## Task 1: Failing test (RED)

- Add a test to `tests/unit/KioskMode.test.tsx`.
- Punch A: capture the mutate `onError`. Do not resolve it.
- Employee B: enter a PIN and tap Clock In. Check that `image-capture-mock` shows.
- Set `isLikelyOffline()` to true. Fire punch A `onError`.
- Expect `image-capture-mock` to stay. Expect `stopCamera` to not run.
- Run the test. Check that it fails.

## Task 2: Fix (GREEN)

- Delete `resetCameraState()` from `queuePunchOffline` in `src/pages/KioskMode.tsx`.
- In the synchronous `catch` of `handlePunch`, call `resetCameraState()` when
  `handleOfflineQueue` returns true.
- Run `tests/unit/KioskMode.test.tsx` and `tests/unit/offlineQueue.test.ts`.

## Task 3: Verify

- Run `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`.
- Run `npm run test:db` and `npm run test:e2e` against local Supabase.

## E2E coverage gate

Covered by `tests/e2e/kiosk-offline-queue-camera-race.spec.ts`. The spec
seeds two employees with PINs. It holds the INSERT of punch A with
`page.route`. Employee B opens the camera dialog. Then the spec sets the
device offline and fails the INSERT of punch A. It expects the offline status
message and expects the camera dialog of B to stay open. The spec fails on
the old `src/pages/KioskMode.tsx` at the dialog assertion, and passes with
the fix.
