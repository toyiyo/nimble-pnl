# Design: kiosk punch perf — fast clock-in/out + skip-photo fix

**Date:** 2026-05-17
**Branch:** `fix/kiosk-perf`
**Files of record:**
- `src/pages/KioskMode.tsx`
- `src/hooks/useTimePunches.tsx`
- `src/hooks/useKioskPins.tsx`
- `src/utils/punchContext.ts`
- `src/components/ImageCapture.tsx`

## Problem

Production kiosk mode takes "seconds" to record a punch under restaurant-WiFi conditions, and the "Skip photo" button does not visually skip the photo capture. The user is configuring multi-employee shift changes where everyone clocks in within ~30 seconds; current latency causes queuing and frustration.

### Reproducing the slow path (static analysis)

`handlePunch` in `src/pages/KioskMode.tsx:229` runs entirely **serially**:

| # | Step | File | Cost |
|---|------|------|------|
| 1 | SHA-256 PIN hash | `src/utils/kiosk.ts:34` | ~1 ms |
| 2 | `verifyPinForRestaurant` — `employee_pins` JOIN `employees` | `src/hooks/useKioskPins.tsx:217` | 50–150 ms |
| 3 | `fetchPunchStatus` — direct RPC, bypasses React Query cache | `src/pages/KioskMode.tsx:170` | 100–300 ms |
| 4 | `collectPunchContext(3000)` — `getCurrentPosition` blocks up to **3000 ms** | `src/utils/punchContext.ts:33` | 0–3 000 ms |
| 5 | `supabase.auth.getUser()` — live JWT round-trip every time | `src/hooks/useTimePunches.tsx:96` | 50–150 ms |
| 6 | Photo upload — 1920×1080 @ q0.8 JPEG (≈ 0.8–1.5 MB) + CORS preflight | `src/hooks/useTimePunches.tsx:106` | 200–2 000+ ms |
| 7 | `time_punches` INSERT | `src/hooks/useTimePunches.tsx:133` | 50–150 ms |
| 8 | `employee_pins` UPDATE `last_used_at` (awaited!) | `src/pages/KioskMode.tsx:283` | 50–100 ms |
| 9 | React Query invalidations → refetch | `src/hooks/useTimePunches.tsx:147` | background |

**Total budget:** ~500 ms (best case, cached geo, no photo, fast WiFi) → ~5 850 ms (worst case).

**Production API logs** (last 24h) confirm the request shape: `OPTIONS` preflight + `POST` to `storage/v1/object/time-clock-photos/...` then `POST` to `time_punches` then `PATCH` to `employee_pins` then `POST` to `rpc/get_employee_punch_status` — all sequential.

### Skip-photo UX bug

`handleSkipPhoto` at `src/pages/KioskMode.tsx:139-145` calls `handlePunch(pendingAction, null)` but does NOT close the camera dialog. The dialog stays open with the live camera preview running for the full 1–5 s punch duration; `resetCameraState()` is only called from `handlePunch` after success. Users perceive "skip didn't skip the image" because the camera feed is still on the screen.

Compare `src/pages/EmployeeClock.tsx:170-217` which calls `setShowCameraDialog(false)` **before** running the punch — same pattern is missing here.

## Decision

Apply **Option B (quick wins + optimistic UI)** with the EmployeeClock photo strategy (480×360 @ q0.6, parallel upload).

### Critical-path target

After the fix:

```text
Tap Confirm / Skip
  ↓ close camera dialog immediately      (~16 ms render)
  ↓ verify PIN                            (~100 ms — single DB hit)
  ↓ show success UI                       ← user-perceived done
  ↓ INSERT time_punches                   (background, ~100 ms)
  ↓ photo upload (if any, downscaled)     (background, ~50–150 ms)
  ↓ employee_pins.last_used_at UPDATE     (fire-and-forget, ~50 ms)
```

Perceived latency: **~150–300 ms.** Worst-case backend latency (background): ~400–600 ms. Geo runs concurrently; never blocks.

### Specific changes

1. **`src/utils/punchContext.ts`** — add `startPunchContext(timeoutMs)` that returns a `Promise` started eagerly. KioskMode calls it as soon as the user opens the camera dialog so the OS has a head start on the location fix; the punch flow then awaits the in-flight promise rather than starting a fresh `getCurrentPosition`.

2. **`src/pages/KioskMode.tsx`**
   - Add a `processing` boolean state. Set `true` when the camera dialog opens for capture or when Skip is tapped; cleared in both `useCreateTimePunch.onSuccess` and `onError`. All keypad / Confirm / Skip buttons get `disabled={processing}`. `handlePunch` early-returns on `processing` as a re-entry guard.
   - `handleSkipPhoto` and the "Confirm punch" handler both call `resetCameraState()` BEFORE entering the punch flow. `resetCameraState` first invokes `imageCaptureRef.current?.stopCamera()` (the imperative handle exposed by `ImageCapture`, see #4), then flips `cameraDialogOpen = false`.
   - `handlePunch` becomes "verify PIN, show success, fire backend ops in background." Concretely:
     - Verify PIN (await — needed to know success/failure).
     - On match: `setLastResult(...)`, `setStatusMessage(...)`, `resetAttempts()`, `setPinInput('')` immediately.
     - Then `createPunch.mutate({...}, { onSuccess, onError })` (NOT `mutateAsync`). Pass `silent: true` so the global success toast in `useCreateTimePunch` is suppressed (kiosk surfaces its own success Alert).
     - The `force_reset` PIN-change dialog and the tip submission dialog open from the **per-call `onSuccess`** (after INSERT confirms), NOT synchronously. The verify-result needed to drive them is captured in the `mutate` closure.
     - `onError` rolls back `lastResult`/`statusMessage`, closes both dialogs explicitly (`setPinChangeDialogOpen(false)`, `setTipDialogOpen(false)`), and clears `processing`.
   - Replace `await supabase.from('employee_pins').update({last_used_at})` with a fire-and-forget `.then().catch()` chain (no `await`).
   - Read punch status from React Query cache first; fall back to RPC if missing/stale (>5 s) **or** if `useOfflineQueue.hasQueuedPunches()` returns true.
   - The success Alert at the bottom of the page gets `role="status"` and `aria-live="polite"` so screen-reader users hear the punch outcome.
   - Camera dialog `ImageCapture` is given `maxWidth={480}`, `quality={0.6}`, and a `ref` (new — see #4).

3. **`src/hooks/useTimePunches.tsx`**
   - Replace `await supabase.auth.getUser()` with `await supabase.auth.getSession()` and read `session.user.id`. `getSession()` is local cache; no network round-trip.
   - Photo upload path unchanged structurally; the size win is at capture time.
   - `mutationFn` accepts an optional `silent?: boolean` on the payload. When `true`, the global `onSuccess` toast is skipped (kiosk path uses its own success Alert).
   - `onError` toast already handles failures from optimistic flow — no change.

4. **`src/components/ImageCapture.tsx`**
   - Convert to `React.forwardRef` with an imperative handle exposing `{ stopCamera(): void }` so the parent can tear down the stream synchronously before unmounting.
   - Add optional `maxWidth?: number` (default unset) and `quality?: number` (default 0.8) props.
   - When `maxWidth` is set and ≤ 480, request `getUserMedia` with `{ width: { ideal: 640 }, height: { ideal: 480 } }` instead of 1920×1080 — saves CPU at capture/encode time on low-end Android.
   - In `capturePhoto()`: when `maxWidth` is set, downscale on the canvas (scale = `min(1, maxWidth / videoWidth)`) before `canvas.toBlob`.
   - Pass `quality` through to `toBlob('image/jpeg', quality)`.

5. **`src/utils/offlineQueue.ts`** — no change needed; queue already accepts the same payload shape.

### Out of scope (explicit)

- Server-side `kiosk_punch` RPC (Option C). The optimistic UI gives us perceptual parity at much lower change cost. We can revisit if a single restaurant ever exceeds ~50 concurrent punches/minute.
- Per-restaurant "require selfie" setting. The user did not ask for it; keep selfie behaviour as-is.
- Geofence enforcement in kiosk mode. KioskMode currently does NOT run `useGeofenceCheck` (only EmployeeClock does). The "warning" the user has configured is restaurant-setting metadata; it surfaces only on the personal `/clock` page, not kiosk. Out of scope here.
- Bulk-punch endpoints. The bulk import path uses `useBulkCreateTimePunches` and is unrelated.

### Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Optimistic UI lies if `time_punches` INSERT fails | `useCreateTimePunch.onError` shows a destructive toast. We add: roll back `lastResult` / `statusMessage` when INSERT errors. Tests cover this. |
| Photo upload fails after success was shown | Already handled: `onError` in `useCreateTimePunch` toasts; the punch row is still inserted because `photo_path` is optional. No data loss. |
| `getSession()` returns stale `user_id` | `getSession()` refreshes opaquely when expiring; in practice the kiosk service account session never expires in a single shift. The RLS INSERT policy validates `user_id` server-side regardless. |
| Downscaled photo too small to identify face | 480×360 matches the existing EmployeeClock behaviour, already in production for the personal-clock path. Face fills the frame; identity-verification quality preserved. |
| Eager `startPunchContext` triggers permission prompt before user is ready | Only invoke once user opens the camera dialog (already an explicit user action). No additional prompt surface. |
| React Query cache hit returns stale clock state | We only short-circuit the RPC when the cached row is < 5 s old. Same `staleTime` as `useEmployeePunchStatus`. |

### Design review — folded in (frontend-design-reviewer, 2026-05-17)

The frontend-design-reviewer ran against this design and raised 2 critical and 4 major concerns. The design above is amended as follows.

**Critical #1 — Double-tap / re-entry during the optimistic window.**
Optimistic success leaves a ~400–600 ms gap where the PIN keypad is still mounted and the user (or an impatient next employee) can tap **Confirm** again. Without a guard, the same PIN runs through `verifyPin` twice and we issue two INSERTs.

*Resolution (in design):* Introduce `processing` state on `KioskMode`. Set `setProcessing(true)` the moment the camera dialog opens for capture (or the moment Skip is tapped), and clear it in both `useCreateTimePunch.onSuccess` and `onError`. While `processing` is true:
- All number-pad buttons and Confirm/Skip buttons have `disabled={processing}`.
- `handlePunch` short-circuits at the very top with `if (processing) return;` as a belt-and-braces guard against React batching surprises.

**Critical #2 — Optimistic rollback misses the force_reset and tip dialogs.**
`setPinChangeDialogOpen(true)` and `setTipDialogOpen(true)` are decided from `verifyPin`'s response, so they currently fire before INSERT. If INSERT then fails we'd roll back `lastResult` but leave the PIN-change or tip modal open, which is worse than the original problem.

*Resolution (in design):* Move both dialog openings into `useCreateTimePunch.onSuccess` (use the `mutate({…}, { onSuccess })` per-call hook, not the global one in `useCreateTimePunch`, so KioskMode keeps control of which dialog to open based on the verify result it already has). On `onError`, both dialogs are explicitly closed alongside the `lastResult`/`statusMessage` rollback.

**Major #1 — `resetCameraState` doesn't tear down the MediaStream.**
`ImageCapture` owns the stream via `useRef` and only stops it in its own `stopCamera`/unmount. If we close the parent dialog while the child is mid-frame, the stream may linger for one render tick. On low-end Android kiosks this shows as a green LED that stays on briefly.

*Resolution (in design):* Add an imperative handle to `ImageCapture` via `React.forwardRef` exposing `{ stopCamera(): void }`. `KioskMode`'s `resetCameraState` calls `imageCaptureRef.current?.stopCamera()` before flipping `cameraDialogOpen = false`. Existing autoStart effect is unaffected.

**Major #2 — Cache short-circuit is unsafe when offline queue has pending punches.**
If a punch is queued (network was offline a moment ago) the cached `punch_status` reflects pre-queue reality. Skipping the RPC then would show "you're clocked out" while a queued clock-in is about to flush. Result: duplicate clock-in.

*Resolution (in design):* The cache short-circuit (`< 5 s old`) is gated on `!hasQueuedPunches()` from `useOfflineQueue`. If anything is queued we always re-fetch via the RPC.

**Major #3 — Success banner has no live-region announcement.**
The "Clocked In/Out" Alert at `KioskMode.tsx:513-528` is a `<div>` with no `role`. Screen-reader users hear nothing when the punch resolves.

*Resolution (in design):* Add `role="status"` and `aria-live="polite"` to the success Alert. The error toast already has the alert role from shadcn's Sonner integration; no change needed there.

**Major #4 — `user-scalable=no` viewport.**
WCAG 1.4.4 violation. We accept it.

*Resolution (rationale, no code change in this PR):* Kiosk mode is a fixed-zoom device-mounted UI; accidental pinch-zoom during a punch is a worse UX failure than the WCAG miss for this surface. We will add a one-line comment in `index.html` (or wherever the meta tag lives — `src/main.tsx` if it's set programmatically) documenting the trade-off, and call this out in the PR description so reviewers can challenge it. The personal `/clock` page (which is reachable on user phones) is NOT changed here.

**Minor advisories — adopted:**
- `getUserMedia` requests `{ width: { ideal: 640 }, height: { ideal: 480 } }` when the parent passes `maxWidth ≤ 480`. Saves CPU at the encode step on low-end Android tablets.
- Added optional `silent?: boolean` to `useCreateTimePunch.mutate` (per-call override) so the kiosk path can rely on its own success Alert and avoid stacking a toast on top.
- No semantic-token changes (no new `text-white` etc.); we keep existing kiosk-specific styling as-is.

### Tests

| Test | File | What it covers |
|------|------|----------------|
| `handleSkipPhoto closes camera dialog before running punch` | `tests/unit/KioskMode.test.tsx` (or component test) | Skip-photo bug fix |
| `handlePunch shows success after verifyPin, not after INSERT` | as above | Optimistic UI critical path |
| `handlePunch rolls back lastResult when INSERT errors` | as above | Failure path |
| `double-tap during background window is ignored` | as above | Critical-#1 re-entry guard |
| `force_reset PIN-change dialog only opens after INSERT resolves` | as above | Critical-#2 deferred dialog |
| `tip dialog only opens after INSERT resolves` | as above | Critical-#2 deferred dialog |
| `resetCameraState stops the active MediaStream tracks` | `tests/unit/ImageCapture.test.tsx` | Major-#1 camera teardown |
| `useCreateTimePunch uses cached session (no auth.getUser net call)` | `tests/unit/useTimePunches.test.tsx` | Auth cache |
| `last_used_at update is fire-and-forget (not awaited)` | as above | Bookkeeping non-blocking |
| `useCreateTimePunch.mutate accepts silent: true to suppress success toast` | as above | Toast de-duplication |
| `cache short-circuit is skipped when hasQueuedPunches() is true` | `tests/unit/punchStatus.test.ts` (or hook test) | Major-#2 offline-queue safety |
| `capturePhoto respects maxWidth + quality props` | `tests/unit/ImageCapture.test.tsx` | Photo downscale |
| `getUserMedia constraint is lowered when maxWidth ≤ 480` | as above | Capture-time bandwidth/CPU win |
| `startPunchContext starts geolocation eagerly and awaits in handlePunch` | `tests/unit/punchContext.test.ts` | Parallel geo |

E2E (Playwright) is out of scope for this PR — the existing `tests/e2e/kiosk-*` suites continue to cover the success path. We rely on unit tests for the new optimistic semantics.

### Migration / rollout

- No DB migration.
- No new edge function.
- Feature-flagged rollout NOT used: the changes are local-only behavioural and we want everyone on the fast path. CodeRabbit + multi-model review + manual sanity check in local kiosk are the gate.

## Acceptance criteria

1. Tapping **Skip photo** closes the camera dialog within 1 animation frame and proceeds to the punch flow.
2. Tapping **Confirm punch** closes the camera dialog within 1 animation frame, shows the captured selfie size ≤ 100 KB at upload, and shows success UI ≤ 300 ms after the tap on a healthy local connection.
3. `supabase.auth.getUser()` is no longer called in the punch hot path (verified by code search + unit test).
4. `employee_pins.last_used_at` update never blocks the success UI (verified by unit test asserting the `setLastResult` happens before the `last_used_at` PATCH resolves).
5. If `time_punches` INSERT fails, the user sees a clear error toast and the success UI is rolled back (no false "Clocked in" left on screen). The force_reset PIN-change dialog and tip-prompt dialog never appear when the underlying punch failed.
6. While a punch is in-flight (camera dialog open through INSERT settlement) the keypad, Confirm, and Skip buttons are disabled. A second tap is a no-op.
7. The success Alert is announced to assistive tech (`role="status"` + `aria-live="polite"`).
8. Closing the camera dialog stops the active MediaStream within the same animation frame (no lingering camera-on indicator).
9. When `hasQueuedPunches()` is true, kiosk re-fetches punch status from the RPC (never uses the cached value).
10. Existing kiosk Playwright E2E tests pass unchanged.
