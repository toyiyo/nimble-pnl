# Broadcast open shifts — pace Resend sends and surface failures

**Date:** 2026-08-03
**Branch:** `fix/broadcast-open-shifts-email-pacing`

## Problem

`broadcast-open-shifts` sends one email per loop iteration with no pacing
between iterations
([`supabase/functions/broadcast-open-shifts/index.ts:200-270`](../../../supabase/functions/broadcast-open-shifts/index.ts),
the send itself at line 260). Each Resend request takes roughly 100ms, so a
sequential loop issues about 10 requests/second. Resend's default limit is
2 requests/second.

The call goes through `sendEmail`
([`_shared/notificationHelpers.ts:168-181`](../../../supabase/functions/_shared/notificationHelpers.ts)),
which returns a bare `boolean`. It is now a thin wrapper over `sendEmailResult`
and does preserve the status internally, but it discards it before returning —
so at this call site a 429 remains indistinguishable from a bad address.

### Confirmed against production

```sql
select count(*) filter (where status = 'active' and email is not null)
       as active_with_email
from employees group by restaurant_id order by active_with_email desc;
```

Largest result: **25** recipients. At ~10 requests/second that restaurant
exceeds the 2/s limit by 5×, so 429s on broadcast are expected today, not
hypothetical.

### What is already partly right

The function does count failures and return them: `emailFailCount` is
incremented both on a `false` result (line 264) and on a thrown error
(line 267), and returned as `email_failed` (line 297). Two things defeat it:

1. The count carries no reason, because `sendEmail` drops the status.
2. The client discards it. `useBroadcastOpenShifts`'s success toast reads
   `Notified ${data.total_employees} team members about ${data.open_shifts}
   open shifts.`
   ([`src/hooks/useBroadcastOpenShifts.ts:33-37`](../../../src/hooks/useBroadcastOpenShifts.ts))
   — `email_failed` is declared in the return type (line 26) and never read.

So the manager sees an unqualified success message even when every email 429'd.

## Prior work — now merged

An earlier draft of this design was written against a stale view of the repo
and claimed the shared sender was uncommitted. That was wrong.
**PR #685 merged at 2026-08-03T14:00:10Z** (merge commit `0ba92099`, branch
`fix/schedule-publish-notifications`), landing:

- `supabase/functions/_shared/emailQueue.ts` — `sendEmailResult` + `sendPaced`
- `tests/unit/emailQueue.test.ts` — 14 cases
- `notificationHelpers.ts` re-exports both (lines 10-11) and reduces `sendEmail`
  to a wrapper (lines 168-181)

This branch is rebased onto that. Nothing is copied; the module is imported.

Two call sites already consume it —
[`notify-schedule-published/index.ts:249-276`](../../../supabase/functions/notify-schedule-published/index.ts)
and
[`notify-schedule-unpublished/index.ts:269-296`](../../../supabase/functions/notify-schedule-unpublished/index.ts)
— establishing the pattern this change follows: `sendPaced` with a `label`, a
per-failure log keyed by **employee id rather than email address** (function
logs are readable outside the tenant, so a bounce log must not spill a roster's
addresses), then a success/failure tally.

## Design

### Components

| File | Change |
|---|---|
| `supabase/functions/_shared/emailQueue.ts` | Add an overall `budgetMs` wall-clock guard to `sendPaced` (see below). |
| `supabase/functions/_shared/emailSendSummary.ts` | **New**, pure. `summarizeSends(results, label)` → privacy-safe failure logs + `{ sent, failed, rateLimited, firstError? }`. |
| `supabase/functions/broadcast-open-shifts/index.ts` | Per-employee loop → one `sendPaced` call; counts from `summarizeSends`; response gains failure detail. |
| `src/hooks/useBroadcastOpenShifts.ts` | Extract exported pure `buildBroadcastToast(data)`; success toast reports partial delivery. |
| `tests/unit/emailQueue.test.ts` | Extend for the budget guard. |
| `tests/unit/emailSendSummary.test.ts` | **New**. |
| `tests/unit/useBroadcastOpenShifts.test.tsx` | **New** — no test covers this hook today. |

### The wall-clock guard (design review finding)

`sendPaced` has no overall deadline. Two realistic failure modes blow past the
platform's request ceiling on today's 25-recipient roster:

| Scenario | Per recipient | × 25 |
|---|---|---|
| All-429 storm | 4 attempts, backoff 1s+2s+4s = **7s** | **~175s** |
| Resend accepts then hangs | one `REQUEST_TIMEOUT_MS` abort = **15s** ([`emailQueue.ts:40`](../../../supabase/functions/_shared/emailQueue.ts)) | **~375s** |

Both exceed the ~150s edge wall-clock ceiling. That figure is an internal
estimate from prior analysis (`memory/lessons.md`, PR #506 entry), not a
documented Supabase constant — the guard is sized conservatively because of
that uncertainty, not calibrated to it. Note the all-429 case is precisely the
condition this fix targets, so it is not a remote edge case.

**Fix:** add `budgetMs?: number` to `PacedOptions`, defaulting to `90_000`.
Once the elapsed budget is exhausted, `sendPaced` stops sending and records each
remaining recipient as `{ ok: false, status: 0, error: 'send budget exhausted',
attempts: 0 }`. Every recipient still yields exactly one result in input order,
so the contract is unchanged.

At a healthy 2/s, 90s covers 180 recipients — 7× today's largest roster — so
this truncates nothing that is currently working. The default applies to the two
already-merged callers as well; that is intended, since both await the fan-out
behind a dialog spinner and share the same exposure.

### `emailSendSummary.ts`

Consolidates the failure-log-plus-tally block currently duplicated at
`notify-schedule-published/index.ts:264-276` and
`notify-schedule-unpublished/index.ts:282-295`, and adds the two fields this
change needs:

```ts
summarizeSends(results, label) → { sent, failed, rateLimited, firstError? }
```

`rateLimited` counts results whose final status was 429. `firstError` is the
first failure's message, truncated. Failure logging keeps the existing
id-not-address convention.

**Why a separate module rather than inlining in `index.ts`:** that file is a
Deno entry Vitest cannot import — it pulls
`https://deno.land/std@0.168.0/http/server.ts` (line 2) and reads `Deno.env`
(line 9). Anything inlined there is unreachable by unit tests, and SonarCloud
gates new code at ≥80% coverage.

This change uses the helper at the new call site only. Migrating the two
existing callers onto it is a follow-up, kept out of this PR so a just-merged
function's tested behaviour is not disturbed.

### Response shape

Additive; no existing field changes meaning.

```jsonc
{
  "email_recipients": 25,      // new: employees with an email — the real denominator
  "email_sent": 22,
  "email_failed": 3,
  "email_rate_limited": 3,     // new: subset of email_failed whose final status was 429
  "email_failed_reason": "..." // new: first failure's message, truncated
}
```

`email_recipients` exists because `total_employees` is `allEmployees.length` —
*every* active employee (lines 164, 298) — while the email counts range only
over `allEmployees.filter(emp => emp.email)` (line 197). Without it the toast
would invite reading "3 failed" against the wrong denominator.

### Toast copy

Extracted as an exported pure `buildBroadcastToast(data)` returning
`{ title, description, variant }`, so the cases below are cheap to test
directly rather than through a full mutation cycle.

| Case | Title | Description | Variant |
|---|---|---|---|
| `email_failed === 0` | `Broadcast sent` | `Notified {total_employees} team members about {open_shifts} open shifts.` | default |
| `0 < email_failed < email_recipients` | `Broadcast sent` | …same, plus ` {email_failed} of {email_recipients} emails failed to send.` | default |
| `email_failed === email_recipients > 0` | `Broadcast sent, but no emails went out` | `Push notifications were sent. All {email_recipients} emails failed to send.` | destructive |

`{n} of {m} emails failed to send` is grammatical at n=1 ("1 of 12 emails
failed to send"), so the failure clause needs no pluralization branch. The base
sentence's existing unpluralized `team members` is pre-existing and untouched.

Making the total-failure case `destructive` answers the design-review finding
that a plain success toast is the wrong affordance when nothing was delivered.
It is a toast-level change only and does not touch the HTTP contract.

### Data flow

```
emailEmployees
  → sendPaced(employees, emp => sendEmailResult(...), { label, budgetMs })
  → PacedResult[]
  → summarizeSends  → per-failure logs + { sent, failed, rateLimited, firstError }
  → response fields → buildBroadcastToast → toast
```

### Wall clock, healthy path

Pacing is awaited idle time, not compute, so it does not press the edge
runtime's ~10s CPU budget (CLAUDE.md). It does consume wall clock: 25 recipients
means 24 gaps × 500ms ≈ **12.5s**, versus ~2.5s today. `sendPaced` logs count
and elapsed time, so the ceiling stays observable.

### Testing

- `emailQueue.test.ts` (extend): budget exhaustion stops sending; unsent
  recipients still yield one result each, in order, with `attempts: 0`; a run
  inside budget is unaffected.
- `emailSendSummary.test.ts`: sent/failed tally; 429 counted as both failed and
  rate-limited; `firstError` from the first failure, truncated; failure logs
  carry employee id and never the address; empty input.
- `useBroadcastOpenShifts.test.tsx`: `buildBroadcastToast` for all three rows of
  the table above, plus `email_recipients === 0` (no email channel).

E2E is not applicable: the change is confined to outbound Resend calls and a
toast string, and driving it end to end would need a live Resend key and real
delivery. The largest runnable slice — pacing, retry, budget, summary mapping,
toast construction — is covered by unit tests.

## Decided trade-offs

**HTTP status stays 200 on partial failure.** A non-2xx on total email failure
would fire the hook's `onError` path. Declined to avoid changing the contract:
push may have succeeded and the publication is still stamped. The destructive
toast variant carries the signal instead.

**`budgetMs` defaults on rather than being opt-in.** It changes behaviour for
two just-merged callers. Accepted: the guard is strictly protective, and 90s is
7× the healthy ceiling for the largest roster in production.

**Existing callers are not migrated onto `summarizeSends`.** Leaves duplication
in place for one more PR, in exchange for not perturbing code merged hours ago.

## Known gap, not fixed here

**Broadcast is not idempotent, and this change widens the window.** The
publication stamp is written only after the send loop completes
([`index.ts:273-284`](../../../supabase/functions/broadcast-open-shifts/index.ts)),
and there is no server-side lock or dedupe on `publication_id` — only the
client's `disabled={isPending}`
([`BroadcastOpenShiftsDialog.tsx:92-98`](../../../src/components/scheduling/BroadcastOpenShiftsDialog.tsx)).
Today's ~2.5s window makes a double-fire narrow; this design's happy path grows
it 5×. If the invocation dies mid-loop, employees are mailed but nothing is
stamped, so a manager retry re-mails them.

Pre-existing, and out of scope by scoping decision. The `budgetMs` guard bounds
the exposure at ~90s instead of the unbounded minutes it is today. A real fix
means stamping under a lock, or making the stamp the claim rather than the
receipt.

## Out of scope — findings, not fixes

**`send-weekly-brief-email` does not have this bug.** It uses Resend's *batch*
endpoint, up to 100 recipients per HTTP request
([`send-weekly-brief-email/index.ts:141-167`](../../../supabase/functions/send-weekly-brief-email/index.ts)),
so a realistic recipient list is a single request and pacing is moot.

It has a sibling defect, left alone by scoping decision: `sentCount +=
batch.length` (line 158) counts an entire batch as delivered whenever the HTTP
call returns `ok`, without reading Resend's per-message results, and the
function returns `success: true` regardless of how many batches failed
(line 180).

**Two further fan-out senders are worse than the loop being fixed here.** Both
dispatch every recipient concurrently rather than sequentially:

- [`_shared/availabilityReminderHandler.ts:133-134`](../../../supabase/functions/_shared/availabilityReminderHandler.ts)
  — `Promise.allSettled(employees.map(async …))`
- [`_shared/bankReauthNoticesHandler.ts:163`](../../../supabase/functions/_shared/bankReauthNoticesHandler.ts)
  — `Promise.all(emailTargets.map(…))`

Both are candidates for `sendPaced` in a follow-up.

## Risks

**Broadcast latency becomes user-visible.** 12.5s at today's largest roster
versus ~2.5s now. Accepted: the current speed is what triggers the 429s. The
button already shows a pending state — `disabled={isPending}` with the label
changing to "Broadcasting…"
([`BroadcastOpenShiftsDialog.tsx:92-98`](../../../src/components/scheduling/BroadcastOpenShiftsDialog.tsx)).

**Changing `emailQueue.ts` touches a shared module with two live callers.**
Mitigated by making the addition purely additive (a new optional field with a
default far above healthy usage) and by extending its existing test file.

**`get_open_shifts` must keep using the caller's client.** Adjacent to the edit
but not part of it: the RPC call at
[`index.ts:98-113`](../../../supabase/functions/broadcast-open-shifts/index.ts)
deliberately uses `supabase`, not `serviceClient`, because the RPC's
`auth.uid()` guard returns zero rows for a service-role caller. Do not
"simplify" it while editing nearby lines.
