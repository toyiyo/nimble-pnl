# Plan: Employee Clock — Punch Failure Surfacing (BUG-003)

Design: docs/superpowers/specs/2026-07-04-employee-clock-punch-error-surfacing-design.md
Branch: fix/employee-clock-punch-error-surfacing

Each task is TDD: RED (failing test) → GREEN (minimal code) → REFACTOR → COMMIT.
Tasks 1–3 touch `src/hooks/useTimePunches.tsx` + `tests/unit/useTimePunches.test.tsx`.
Task 4 touches `src/pages/EmployeeClock.tsx` + `tests/unit/EmployeeClock.test.tsx`.
Tasks are sequential (2–4 build on 1's hook changes).

## Task 1 — Hook: photo-upload hardening, no premature toast

**RED** (extend `tests/unit/useTimePunches.test.tsx`, existing mock scaffolding):
- a. Upload rejects → INSERT still runs; **no toast fires before `insertSingleMock` resolves** (assert `toastMock` not called at the moment insert is invoked — use a deferred insert promise); after success, toast is the *"Punch recorded — photo could not be uploaded"* variant.
- b. Upload hangs (never-resolving promise) → after the 10s photo timeout (fake timers + `afterEach(vi.useRealTimers)` per lessons.md), punch proceeds without `photo_path`.
- c. Upload succeeds → normal success toast, `photo_path` set (regression pin).

**GREEN** (`useCreateTimePunch.mutationFn`):
- `PHOTO_UPLOAD_TIMEOUT_MS = 10_000`; `AbortController` + `setTimeout` (cleared on settle); pass `signal` to storage `.upload()` if the pinned storage-js supports it, else `Promise.race`; no-op `.catch()` on the abandoned promise.
- Remove the in-`mutationFn` toast; set `photoUploadFailed` local flag; return it alongside the row (shape: `{ ...data, photoUploadFailed }` or a second field — keep the returned row spread compatible with existing `onSuccess` usage).
- `onSuccess`: when not `silent`, choose toast copy by `photoUploadFailed`.

**Commit**: `fix(time-clock): photo upload failure no longer fakes punch success`

## Task 2 — Hook: INSERT abort timeout, error mapping, onSettled invalidation

**RED**:
- d. INSERT builder chain receives an `AbortSignal` (`.insert().select().abortSignal(sig).single()` order — extend the `from()` mock to record `abortSignal` calls).
- e. INSERT rejects with a genuine abort reason (create via `const c = new AbortController(); c.abort(); reject(c.signal.reason)`) → destructive toast whose description matches the timeout copy. Also a fallback case: plain `Error('The operation timed out')` → same mapping.
- f. INSERT rejects with an ordinary error → existing "Error recording punch" destructive toast (regression pin).
- g. Invalidations (`timePunches`, `punchStatus`) fire even when the INSERT fails (onSettled, ids derived from `variables`).

**GREEN**:
- `PUNCH_INSERT_TIMEOUT_MS = 15_000`; `AbortController` + `setTimeout` cleared on settle; chain `.abortSignal()` between `.select()` and `.single()`.
- `isTimeoutError(error)` helper: `error instanceof DOMException`, name `AbortError`/`TimeoutError`, or `/abort|timed?\s?out/i` on message.
- Move invalidations from `onSuccess` to `onSettled` (derive ids from `variables`; keep `data`-based ids when present).

**Commit**: `fix(time-clock): punch INSERT times out instead of hanging silently`

## Task 3 — Hook: kiosk silent contract pin

**RED**:
- h. `silent: true` + upload failure → no success toast of either variant; error toast on INSERT failure still fires.

**GREEN**: should already pass from Tasks 1–2 wiring; fix if not.

**Commit**: `test(time-clock): pin kiosk silent contract for photo-failure toasts` (tests-only commit if GREEN immediately)

## Task 4 — EmployeeClock: persistent failure alert + retry + pending indicator

**RED** (extend `tests/unit/EmployeeClock.test.tsx`; mock `useCreateTimePunch` to expose controllable `mutate` that invokes per-call callbacks):
- i. Punch failure (per-call `onError` fired) → `role="alert"` visible with a Try Again button.
- j. Try Again → `mutate` re-invoked with the **identical payload**; alert clears on per-call `onSuccess`.
- k. Try Again `disabled` while `isPending` is true.
- l. Payload older than `RETRY_MAX_AGE_MS` (5 min; inject clock or set `failedAt` directly) → Try Again discards it and restarts the punch flow (camera dialog opens; no stale-timestamp mutate).
- m. Opening then cancelling the camera dialog does NOT clear the alert; a newly confirmed punch (mutate firing) does.

**GREEN** (`EmployeeClock.tsx`):
- `failedPunch: { payload, failedAt } | null` state; set in per-call `onError`, cleared when any `mutate` fires and on per-call `onSuccess`.
- shadcn `Alert variant="destructive"` + `AlertTitle` + `AlertDescription` above Quick Actions; Try Again button (`h-9 px-4 rounded-lg text-[13px] font-medium`, `disabled={createPunch.isPending}`).
- Focus: on alert unmount after successful retry, move focus to the main action button if focus was inside the alert.
- Pending indicator: `Loader2` spinner + "Recording punch…" (`text-[13px] text-muted-foreground`) while `isPending`.

**Commit**: `fix(time-clock): persistent failure alert with retry on employee clock (BUG-003)`

## Task 5 — Full local verify

- `npm run test`, `npm run typecheck`, `npm run lint` (changed files clean), `npm run build`.
- No DB/E2E surface changed; run `npm run test:db` only if CI parity demands (no SQL touched).

## Dependencies

Task 1 → Task 2 → Task 3 (same file, sequential). Task 4 depends on Task 1–2 hook semantics. Task 5 last.
