# Employee Clock — Punch Failure Surfacing (BUG-003)

**Date:** 2026-07-04
**Branch:** `fix/employee-clock-punch-error-surfacing`
**Severity:** MEDIUM (silent data-affecting failure on the employee time-clock path)

## Problem

BUG-003: an employee clicked "Clock Out" on `/employee/clock`, the first attempt
silently failed with no error shown, and they had to open a new tab and redo the
flow to succeed.

### Evidence (PostHog session replays, 2026-07-03/04)

Session `019f2628-821e-78d4-95ba-1bdeac11e78e` (2026-07-03 04:06–04:08 UTC)
reproduces the report exactly:

1. 04:06:59 — clicks **Clock Out**; camera dialog opens.
2. 04:07:20 — Clock Out again; photo taken and confirmed.
3. 04:07:34 — console error: `Photo upload error: StorageUnknownError: Failed to fetch`
   (network to Supabase failing).
4. 04:08:23 — console error: `TypeError: Failed to fetch` from supabase-js auth
   `_getUser` — confirms general connectivity loss to the Supabase backend.
5. 04:08:28 — retries Take Photo → Confirm & Clock Out → **hard page reload** 3s later.
6. 04:08:42 — after reload: Take Photo → Confirm & Clock Out → success (no further errors).

Two additional sessions (`019f2ad0…`, `019f2dc8…`) show the sibling path: camera
permission denied (`NotAllowedError`) → **Skip Photo** → no visible feedback.

### Root cause

The punch mutation failed because of a network failure, and the UI surfaced that
in three broken ways (all in `src/hooks/useTimePunches.tsx` +
`src/pages/EmployeeClock.tsx`):

1. **False-success toast ordering.** When the photo upload fails,
   `useCreateTimePunch` toasts *"Photo upload failed — Punch recorded without
   photo"* **before** the `time_punches` INSERT has run. If the INSERT then
   fails, the employee has already been told the punch was recorded.
2. **No timeout ⇒ silent infinite pending.** The Supabase INSERT (and the
   storage upload) has no timeout. On a black-holed connection the mutation
   stays `isPending` forever: the Clock In/Out button is disabled with no
   spinner, no error ever fires, and the page looks dead. This is precisely why
   the employee opened a new tab.
3. **Failure is a single transient toast.** `handleConfirmPunch` closes the
   dialog optimistically; the only failure surface is one toast
   (`TOAST_LIMIT = 1`, so the photo-upload toast and error toast displace each
   other). The status badge still reads "Clocked In", there is no persistent
   error state and no retry affordance.

Note: the **Skip Photo path is functionally correct** — photo is already
optional and the punch INSERT does not require a photo. The bug title's
"validation error when photo is skipped" hypothesis is not what happened; the
failure was network-level and generic to both the photo and skip paths.

## Approaches considered

- **A. Harden error surfacing in the existing flow (chosen).** Fix toast
  ordering, add request timeouts so hangs become visible failures, add a
  persistent inline failure alert with one-tap Retry (reusing the exact punch
  payload), and show a pending indicator while the punch is in flight.
  Smallest change that eliminates every observed silent path.
- **B. Offline queue (like KioskMode).** `KioskMode` already queues punches
  offline and flushes later. Porting that to `/employee/clock` would auto-heal
  network failures but is a much larger change (queue storage, flush lifecycle,
  dedupe against multi-tab retries) and the employee page — unlike a shared
  kiosk — has a human who can simply retry. **Deferred**; the retry alert covers
  the UX gap. If telemetry later shows frequent failures, revisit.
- **C. Toast-only tweaks.** Reword/re-order toasts without a persistent error
  surface or timeouts. Rejected: toasts are transient, capped at one, and do
  nothing for the hang case.

## Design (Approach A)

### 1. `useCreateTimePunch` (`src/hooks/useTimePunches.tsx`)

- **Photo upload**: wrap the storage upload in a timeout race
  (`PHOTO_UPLOAD_TIMEOUT_MS = 10_000`). On failure **or timeout**: do NOT toast
  inside `mutationFn`; record `photoUploadFailed = true` and continue without a
  photo (existing non-fatal semantics preserved).
- **INSERT timeout**: chain `.abortSignal(AbortSignal.timeout(15_000))` onto the
  `time_punches` INSERT so a black-holed fetch rejects instead of hanging
  (supabase-js ≥ 2.x supports `abortSignal` on PostgREST builders).
- **`onSuccess`**: keep invalidations. When not `silent`: if
  `photoUploadFailed`, toast *"Punch recorded — photo could not be uploaded"*;
  otherwise the existing success toast. (Kiosk passes `silent: true` and keeps
  its own UI; it no longer gets a stray photo-upload toast, which matches the
  kiosk pattern of surfacing its own feedback.)
- **`onError`**: keep the destructive toast; map abort/timeout errors
  (`error.name === 'AbortError' || 'TimeoutError'`) to a human message:
  *"Request timed out. Check your connection and try again."*
- The mutation **result** carries `photoUploadFailed` so callers can render
  their own messaging if needed.

### 2. `EmployeeClock` (`src/pages/EmployeeClock.tsx`)

- Track the last attempted payload and failure:
  `const [failedPunch, setFailedPunch] = useState<CreateTimePunchInput | null>(null)`.
  Set it via `createPunch.mutate(payload, { onError })` per-call callbacks;
  clear on success and when a new attempt starts.
- **Persistent failure alert** (rendered above Quick Actions when
  `failedPunch` is set): `role="alert"`, destructive variant —
  *"Your clock-in/out didn't go through. Check your connection and try
  again."* — with a **Try Again** button that re-fires
  `createPunch.mutate(failedPunch)` (same payload, including the photo blob and
  original `punch_time`, so the punch reflects when the employee actually
  punched, not when the retry succeeded).
- **Pending indicator**: while `createPunch.isPending`, show a small inline
  "Recording punch…" status (with spinner) near the action button so the
  closed-dialog window isn't a dead zone. Buttons already disable on
  `isPending`.
- Three-state rendering, semantic tokens, and a11y (`role="alert"`, button
  labels) per CLAUDE.md.

### Out of scope

- Offline queueing for `/employee/clock` (Approach B, deferred).
- KioskMode changes beyond the shared-hook behavior described above.
- Geofence UX and camera-permission flows (already have explicit dialogs/toasts).

## Test plan

`tests/unit/useTimePunches.test.tsx` (extend existing suite):

1. Photo upload fails → INSERT still runs; **no toast fires before the INSERT
   resolves**; success toast mentions the photo wasn't uploaded.
2. Photo upload hangs → punch proceeds without photo after the upload timeout.
3. INSERT rejects → destructive "Error recording punch" toast.
4. INSERT aborts (simulated `AbortError`/`TimeoutError`) → destructive toast
   with the connection/timeout message.
5. INSERT is invoked with an abort signal (pin the timeout wiring).
6. `silent: true` (kiosk) still suppresses success toasts including the
   photo-failure variant.

`tests/unit/EmployeeClock.test.tsx` (extend existing suite):

7. Punch failure → `role="alert"` failure alert visible with Try Again.
8. Try Again → `mutate` re-invoked with the identical payload; alert clears on
   success.
9. New punch attempt clears a stale failure alert.

## Decided trade-offs

- The INSERT timeout (15s) can theoretically abort a request the server later
  completes, so a retry could double-punch. Accepted: `time_punches` has no
  uniqueness constraint on (employee, punch_time) today, the same risk already
  exists with the user's manual new-tab retry (the observed workaround), and a
  duplicate punch is visible/fixable in the manager UI, whereas a silent
  missing clock-out corrupts payroll invisibly.
