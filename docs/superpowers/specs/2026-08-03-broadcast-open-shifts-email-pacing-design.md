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

The failure is invisible. `sendEmail`
([`_shared/notificationHelpers.ts:159-192`](../../../supabase/functions/_shared/notificationHelpers.ts))
returns a bare `boolean`: on a non-`ok` response it logs the body and returns
`false` (lines 181-185), discarding `response.status`. A 429 is therefore
indistinguishable from a bad recipient address.

### Confirmed against production

The largest active roster with email addresses is **25 recipients** (query
over `employees` grouped by `restaurant_id`, `status = 'active'`,
`email is not null`). At ~10 requests/second that restaurant exceeds the 2/s
limit by 5×, so 429s on broadcast are expected today, not hypothetical.

### What is already partly right

The function does count failures and return them: `emailFailCount` is
incremented on both a `false` result and a thrown error (lines 167-168,
261-269) and is returned as `email_failed` (line 296). Two things defeat it:

1. The count carries no reason, because the status was dropped upstream.
2. The client discards it. `useBroadcastOpenShifts`'s success toast reads
   `Notified ${data.total_employees} team members about ${data.open_shifts}
   open shifts.`
   ([`src/hooks/useBroadcastOpenShifts.ts:33-37`](../../../src/hooks/useBroadcastOpenShifts.ts))
   — `email_failed` is destructured into the return type (line 26) and never
   read again.

So the manager sees an unqualified success message even when every email 429'd.

## Prior work — corrected premise

The task described this work as depending on `sendEmailResult()` in
`_shared/notificationHelpers.ts` and a paced sender in
`_shared/rateLimitedSend.ts`, both "introduced on branch
`fix/schedule-publish-notifications`, landing soon".

**Neither exists in any commit.** That branch holds four commits
(`676f5a93`, `69abbc68`, `a49debfd`, `a44189c5`), all design docs and a plan,
and has no PR. The implementation exists only as **uncommitted** files in that
worktree, and was renamed during implementation:

| Design doc says | Actually written as |
|---|---|
| `_shared/rateLimitedSend.ts` | `_shared/emailQueue.ts` (untracked) |
| `sendEmailResult` in `notificationHelpers.ts` | `sendEmailResult` in `emailQueue.ts` |
| `tests/unit/rateLimitedSend.test.ts` | `tests/unit/emailQueue.test.ts` (untracked) |

**Decision:** copy `_shared/emailQueue.ts` and `tests/unit/emailQueue.test.ts`
into this branch byte-identical. Whichever branch merges first, the other sees
an identical file and merges without conflict. The alternative — writing a
second paced sender here — would guarantee two divergent implementations that
must later be reconciled.

## Design

### Components

| File | Change |
|---|---|
| `supabase/functions/_shared/emailQueue.ts` | **New**, copied verbatim. Exports `sendEmailResult` and `sendPaced`. |
| `supabase/functions/_shared/emailSendSummary.ts` | **New**, small and pure. `summarizeSends(results)` → `{ sent, failed, rateLimited, firstError? }`. |
| `supabase/functions/broadcast-open-shifts/index.ts` | Per-employee loop → one `sendPaced` call; counts from `summarizeSends`; response gains failure detail. |
| `src/hooks/useBroadcastOpenShifts.ts` | Success toast reports partial delivery. |
| `tests/unit/emailQueue.test.ts` | **New**, copied verbatim (14 cases). |
| `tests/unit/emailSendSummary.test.ts` | **New**. |
| `tests/unit/useBroadcastOpenShifts.test.tsx` | **New** — no test covers this hook today. |

### `emailQueue.ts` contract

- `sendEmailResult(apiKey, from, to, subject, html) → { ok, status, error? }`.
  Preserves the HTTP status. A thrown fetch reports `status: 0` — "never
  reached Resend" — so a transport failure is distinguishable from an API
  rejection.
- `sendPaced(recipients, send, options) → PacedResult<T>[]`. Sequential, at
  least `intervalMs` (default 500ms = 2/s) between send *starts*. A 429 retries
  up to 3 times with 1s/2s/4s backoff; any other failure does not retry. Every
  recipient yields exactly one result, in input order, so one failure never
  aborts the fan-out.

The module has no imports, so it loads unchanged in both the Deno edge runtime
and Vitest.

### Why a separate `emailSendSummary.ts`

`index.ts` is a Deno entry file Vitest cannot import — it pulls
`https://deno.land/std@0.168.0/http/server.ts` (line 2) and reads `Deno.env`
(line 9). Anything inlined there is unreachable by unit tests, and SonarCloud
gates new code at ≥80% coverage. Folding the summarizer into `emailQueue.ts` is
ruled out by the byte-identical constraint above. A separate pure module is the
smallest unit that keeps the 429-vs-hard-bounce distinction — the actual point
of this change — under test.

### Data flow

```
emailEmployees
  → sendPaced(employees, emp => sendEmailResult(...), { label })
  → PacedResult[]
  → summarizeSends
  → { sent, failed, rateLimited, firstError }
  → response fields + one summary log line
```

### Response shape

Additive; no existing field changes meaning.

```jsonc
{
  "email_sent": 22,
  "email_failed": 3,
  "email_rate_limited": 3,        // new: subset of email_failed that ended on 429
  "email_failed_reason": "..."    // new: first failure's message, truncated
}
```

### Error handling

A 429 surviving all retries counts as both `failed` and `rateLimited`, so an
over-limit condition is separable in logs and in the JSON from a bad address.
The function still returns HTTP 200 on partial failure — the hook keeps its
success path, and the toast appends the failure count rather than replacing a
success with an error.

### Wall clock

Pacing is awaited idle time, not compute, so it does not press the edge
runtime's ~10s CPU budget. It does consume wall clock: 25 recipients means 24
gaps × 500ms ≈ 12.5s, well inside the ~150s request budget. `sendPaced` logs
count and elapsed time, so the ceiling is observable long before a roster grows
large enough to threaten the timeout. Past a few hundred recipients the answer
is a queue/cron drain, not a faster loop.

### Testing

- `emailQueue.test.ts` (copied): pacing interval, no sleep before the first
  send, no sleep when the caller already burned the interval, 429 retry then
  success, give up after `maxRetries`, no retry on 422, per-recipient ordering,
  one failure not aborting the rest, empty list.
- `emailSendSummary.test.ts`: sent/failed tally, 429 counted as both failed and
  rate-limited, `firstError` taken from the first failure and truncated, empty
  input.
- `useBroadcastOpenShifts.test.tsx`: toast omits the failure clause when
  `email_failed === 0`, includes it otherwise.

E2E is not applicable: the change is confined to outbound Resend calls and a
toast string. Driving it end to end would require a live Resend key and real
delivery. The largest runnable slice — the pacing/retry logic and the summary
mapping — is covered by unit tests.

## Decided trade-offs

**HTTP status stays 200 on partial failure.** A non-2xx on total email failure
would fire the hook's error path and show a red toast, a stronger signal. It
was declined to avoid changing the contract: push may have succeeded, the
publication is still stamped, and the broadcast did happen. Partial delivery is
reported in the success toast instead.

**`emailQueue.ts` is copied, not imported or refactored.** Byte-identical
duplication across two in-flight branches is deliberate. Keeping the file
untouched is what makes the eventual merge trivial.

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

**Merge conflict with `fix/schedule-publish-notifications`.** Mitigated by
byte-identical copies. If that branch edits `emailQueue.ts` before merging, the
conflict is confined to one 161-line file with no other dependents.

**Broadcast latency becomes user-visible.** 12.5s at today's largest roster,
versus ~2.5s now. Accepted: the current speed is precisely what triggers the
429s. The button already shows a pending state via the mutation.

**`get_open_shifts` must keep using the caller's client.** Unrelated to this
change but adjacent to it: the RPC call at
[`index.ts:98-113`](../../../supabase/functions/broadcast-open-shifts/index.ts)
deliberately uses `supabase`, not `serviceClient`, because the RPC's
`auth.uid()` guard returns zero rows for a service-role caller. The comment
there records this. Do not "simplify" it while editing nearby lines.
