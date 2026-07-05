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

- **Photo upload**: wrap the storage upload in a timeout
  (`PHOTO_UPLOAD_TIMEOUT_MS = 10_000`) driven by an `AbortController` +
  `setTimeout` (not `AbortSignal.timeout`, for older-WebKit tablet compat).
  Pass the signal to the storage upload if the pinned storage-js version
  supports it (verify at implementation time); otherwise `Promise.race` with a
  documented fire-and-forget on the loser. Either way the losing/abandoned
  upload promise gets a no-op `.catch()` so late rejections don't surface as
  unhandled-rejection noise. On failure **or timeout**: do NOT toast inside
  `mutationFn`; record `photoUploadFailed = true` and continue without a photo
  (existing non-fatal semantics preserved). An upload that completes after the
  timeout leaves an orphaned storage object — accepted (photos are advisory).
- **INSERT timeout**: abort the `time_punches` INSERT after
  `PUNCH_INSERT_TIMEOUT_MS = 15_000` so a black-holed fetch rejects instead of
  hanging. Exact chain order (abortSignal lives on the transform builder):
  `supabase.from('time_punches').insert(...).select().abortSignal(controller.signal).single()`.
  Use `AbortController` + `setTimeout` (cleared on settle), not
  `AbortSignal.timeout`.
- **Invalidations move to `onSettled`** (not `onSuccess`): if the client aborts
  at 15s but the INSERT actually landed server-side, invalidating
  `['punchStatus', …]` and `['timePunches', …]` on error reconciles the badge
  on the next fetch instead of waiting out the 30s poll. `onSettled` derives
  ids from `variables` since `data` is undefined on error.
- **`onSuccess`**: when not `silent`: if `photoUploadFailed`, toast
  *"Punch recorded — photo could not be uploaded"*; otherwise the existing
  success toast. (Kiosk passes `silent: true` and keeps its own UI; it no
  longer gets a stray photo-upload toast — kiosk surfaces punch failures
  through its own inline UI, per the comment contract in `KioskMode.tsx`, so
  this is not a silent kiosk regression.)
- **`onError`**: keep the destructive toast; classify abort/timeout errors
  defensively — `error instanceof DOMException`, `error.name` of
  `'AbortError'`/`'TimeoutError'`, or message matching `/abort|timed?\s?out/i`
  — and map to *"Request timed out. Check your connection and try again."*
  supabase-js may not preserve the DOMException shape across its fetch
  wrapper, so tests must exercise a genuinely-aborted rejection (an
  `AbortController.abort()` reason), not only a hand-built `Error` with
  `.name` set.
- The mutation **result** carries `photoUploadFailed` so callers can render
  their own messaging if needed.

### 2. `EmployeeClock` (`src/pages/EmployeeClock.tsx`)

- Track the last attempted payload and failure:
  `const [failedPunch, setFailedPunch] = useState<{ payload: CreateTimePunchInput; failedAt: number } | null>(null)`.
  Set it via `createPunch.mutate(payload, { onError })` per-call callbacks.
  It clears **only when a subsequent `mutate()` actually fires** (retry or a
  new confirmed punch) or on success — NOT merely when a new attempt is
  initiated, so a user who opens and cancels the camera dialog keeps the Try
  Again affordance.
- **Persistent failure alert** (rendered above Quick Actions when
  `failedPunch` is set): shadcn `Alert` with `variant="destructive"` (implies
  `role="alert"` live-region announcement without stealing focus), composed of
  `AlertTitle` + `AlertDescription` — *"Your clock-in/out didn't go through.
  Check your connection and try again."* — with a **Try Again** button
  (`h-9 px-4 rounded-lg text-[13px] font-medium`, tab-reachable,
  `disabled={createPunch.isPending}` to prevent concurrent duplicate
  mutations) that re-fires `createPunch.mutate(failedPunch.payload)`.
- **Retry timestamp policy**: retries reuse the original `punch_time` — the
  original tap is when the employee actually punched, which is the truthful
  payroll time (re-stamping would inflate the shift by the retry delay).
  To bound staleness, Try Again enforces a freshness window
  (`RETRY_MAX_AGE_MS = 5 min`): past it, the click discards the stale payload
  and restarts the normal punch flow (`handleInitiatePunch(punchType)`) with a
  fresh timestamp.
- **Focus management**: the alert does not steal focus on appear (live region
  announces it). When the alert unmounts after a successful retry and focus
  was inside it, move focus to the main Clock In/Out button so it isn't
  dropped to `<body>`.
- **Failure source of truth**: `EmployeeClock` does NOT pass `silent: true`;
  the hook's toasts still fire, but with `TOAST_LIMIT = 1` they are
  best-effort. The persistent alert — not the toast — is the authoritative
  failure surface.
- **Pending indicator**: while `createPunch.isPending`, show a small inline
  "Recording punch…" status (`text-[13px] text-muted-foreground` with a
  `Loader2` spinner, `text-muted-foreground`) near the action button so the
  closed-dialog window isn't a dead zone. Buttons already disable on
  `isPending`.
- Three-state rendering, semantic tokens, and a11y per CLAUDE.md.

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
4. INSERT aborts → destructive toast with the connection/timeout message.
   The abort must be produced by a real `AbortController.abort()` rejection
   reason (plus a fallback case for a plain error whose message matches the
   timeout regex), not only a hand-built `Error` with `.name` set.
5. INSERT is invoked with an abort signal (pin the timeout wiring and the
   `.insert().select().abortSignal().single()` chain order).
6. `silent: true` (kiosk) still suppresses success toasts including the
   photo-failure variant.
6b. Query invalidations fire on error too (onSettled) so an
   aborted-but-server-completed INSERT reconciles the status badge.

`tests/unit/EmployeeClock.test.tsx` (extend existing suite):

7. Punch failure → `role="alert"` failure alert visible with Try Again.
8. Try Again → `mutate` re-invoked with the identical payload; alert clears on
   success; Try Again is disabled while the retry is pending.
9. A newly confirmed punch (mutate firing) clears a stale failure alert;
   merely opening/cancelling the camera dialog does not.
10. Try Again on a payload older than `RETRY_MAX_AGE_MS` discards it and
    restarts the punch flow instead of inserting a stale-timestamped punch.

## Decided trade-offs

- The INSERT timeout (15s) can abort a request the server later completes, so
  a retry could double-punch. Note this is a **new, more frequent window** —
  it fires on every slow-but-alive request (~15–20s restaurant Wi-Fi), not
  only when a human gives up and retries in a new tab. Accepted because:
  `time_punches` has no uniqueness constraint on manual punches (verified —
  the only unique index, `idx_time_punches_source_dedup`, is partial on
  `source_type/source_id IS NOT NULL` and doesn't cover the employee-clock
  path); Try Again is disabled while pending (no concurrent duplicates);
  `onSettled` invalidation reconciles the badge quickly; and a duplicate punch
  is visible/fixable in the manager UI, whereas a silent missing clock-out
  corrupts payroll invisibly. A server-side idempotency key is noted as future
  work if duplicates show up in practice.
- Retries reuse the original `punch_time` within a 5-minute freshness window
  (see Retry timestamp policy above): the original tap time is the accurate
  payroll fact; the window bounds the abandoned-tab case.
- An aborted photo upload that completes server-side after timeout leaves an
  orphaned object in `time-clock-photos` with no DB reference. Accepted:
  advisory data, negligible volume; cancellation via storage-js signal support
  is attempted first.
