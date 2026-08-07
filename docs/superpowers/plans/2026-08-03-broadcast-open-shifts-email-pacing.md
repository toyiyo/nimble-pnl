# Broadcast Open Shifts — Email Pacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route `broadcast-open-shifts`'s Resend sends through the shared paced sender so they stay inside Resend's 2 req/s limit, and report the failures that result instead of swallowing them.

**Architecture:** The paced sender (`_shared/emailQueue.ts`) already exists on `main` and has two callers. This adds an overall wall-clock guard to it, adds a shared result summarizer that also captures the 429 count, converts the broadcast function's per-employee send loop into a single `sendPaced` call, and surfaces the resulting counts through the edge response into the toast.

**Tech Stack:** Deno edge functions (Supabase), TypeScript, React Query, Vitest, shadcn toast.

**Design doc:** [`docs/superpowers/specs/2026-08-03-broadcast-open-shifts-email-pacing-design.md`](../specs/2026-08-03-broadcast-open-shifts-email-pacing-design.md)

## Global Constraints

- **Log employee `id`, never an email address.** Function logs are readable well outside the tenant. Both existing `sendPaced` callers carry this convention with an explanatory comment; preserve it verbatim in the shared summarizer.
- **`_shared/` modules must import cleanly under Vitest.** No `Deno.env`, no `https://deno.land/...` imports. That is why logic goes there rather than into `index.ts` — Vitest cannot import a Deno entry file.
- **Edge function entry files have no automated test coverage.** Anything worth testing must live in `_shared/`. SonarCloud gates new code at **≥80% coverage**.
- **Do not touch the `get_open_shifts` RPC call** at `supabase/functions/broadcast-open-shifts/index.ts:98-113`. It deliberately uses the caller's authenticated `supabase` client rather than `serviceClient`, because the RPC's `auth.uid()` guard returns zero rows for a service-role caller. It sits above the code being changed; leave it alone.
- **Exact toast copy** (no paraphrasing, no added pluralization branches):
  - no failures → `Notified {total_employees} team members about {open_shifts} open shifts.`
  - some failures → the above, then a space, then `{email_failed} of {email_recipients} emails failed to send.`
  - all failed → title `Broadcast sent, but no emails went out`, description `Push notifications were sent. All {email_recipients} emails failed to send.`, `variant: 'destructive'`
- **Additive response fields only.** `email_sent`, `email_failed`, `total_employees`, `open_shifts`, `push_sent`, `push_failed` keep their current meaning. HTTP status stays 200 on partial email failure.
- **No direct colors, no manual caching** (CLAUDE.md). Neither applies to the files here, but the toast change must not introduce a hardcoded color — use the existing `variant: 'destructive'`.

---

### Task 1: Wall-clock budget guard in `sendPaced`

Without an overall deadline, the all-429 storm this whole change targets costs ~7s of backoff per recipient — about 175s across today's largest roster (25) — and a hung connection costs 15s each, about 375s. Both exceed the edge request ceiling, so the fix for rate limiting would itself become a new failure mode.

**Files:**
- Modify: `supabase/functions/_shared/emailQueue.ts` (constants block ~line 28-40; `PacedOptions` ~line 56-67; `sendPaced` loop ~line 133-191)
- Test: `tests/unit/emailQueue.test.ts` (append to the existing `describe('sendPaced', ...)` block, which ends at the `returns an empty result set...` case)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `PacedOptions.budgetMs?: number` (default 90000) and the exported constant `BUDGET_EXHAUSTED_ERROR: string`. Task 2's tests and Task 3's call site both rely on `sendPaced` still returning exactly one `PacedResult<T>` per recipient, in input order, whether or not the budget ran out.

- [ ] **Step 1: Write the failing tests**

Append these three cases inside the existing `describe('sendPaced', () => { ... })` block in `tests/unit/emailQueue.test.ts`, just before its closing `});`. The file already defines `makeFakeTimer()` at the top — reuse it, do not redefine it.

```ts
  it('stops sending once the wall-clock budget is exhausted', async () => {
    const timer = makeFakeTimer();
    const send = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    // 500ms pacing inside a 1000ms budget: sends start at t=0, 500 and 1000,
    // so the fourth recipient finds the budget already spent.
    const results = await sendPaced(['a', 'b', 'c', 'd'], send, {
      intervalMs: 500,
      budgetMs: 1000,
      sleep: timer.sleep,
      now: timer.now,
    });

    expect(send).toHaveBeenCalledTimes(3);
    expect(results).toHaveLength(4);
    expect(results[3]).toEqual({
      recipient: 'd',
      ok: false,
      status: 0,
      error: BUDGET_EXHAUSTED_ERROR,
      attempts: 0,
    });
  });

  it('reports every unsent recipient, in order, when the budget runs out', async () => {
    const timer = makeFakeTimer();
    const send = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    // Budget 0 means nothing may be sent at all — the caller still needs a
    // result per recipient or it cannot tell who was skipped.
    const results = await sendPaced(['a', 'b', 'c'], send, {
      budgetMs: 0,
      sleep: timer.sleep,
      now: timer.now,
    });

    expect(send).not.toHaveBeenCalled();
    expect(results.map((r) => r.recipient)).toEqual(['a', 'b', 'c']);
    expect(results.every((r) => !r.ok && r.error === BUDGET_EXHAUSTED_ERROR)).toBe(true);
  });

  it('does not truncate a run that fits inside the budget', async () => {
    const timer = makeFakeTimer();
    const send = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const results = await sendPaced(['a', 'b', 'c'], send, {
      intervalMs: 500,
      budgetMs: 90_000,
      sleep: timer.sleep,
      now: timer.now,
    });

    expect(send).toHaveBeenCalledTimes(3);
    expect(results.every((r) => r.ok)).toBe(true);
  });
```

Then extend the import at the top of the file so `BUDGET_EXHAUSTED_ERROR` resolves. Change:

```ts
import {
  sendEmailResult,
  sendPaced,
  RESEND_DEFAULT_INTERVAL_MS,
} from '../../supabase/functions/_shared/emailQueue';
```

to:

```ts
import {
  sendEmailResult,
  sendPaced,
  RESEND_DEFAULT_INTERVAL_MS,
  BUDGET_EXHAUSTED_ERROR,
} from '../../supabase/functions/_shared/emailQueue';
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run tests/unit/emailQueue.test.ts
```

Expected: FAIL. `BUDGET_EXHAUSTED_ERROR` is not exported, so the suite fails to resolve the import — every case in the file errors, not just the three new ones. That is the expected shape of this failure.

- [ ] **Step 3: Add the budget guard**

In `supabase/functions/_shared/emailQueue.ts`, add below the existing `const BASE_BACKOFF_MS = 1000;` line:

```ts
/**
 * Overall wall-clock ceiling for one fan-out.
 *
 * Per-request timeouts alone do not bound the whole loop. An all-429 storm
 * costs ~7s of backoff per recipient, and a roster of 25 then runs ~175s —
 * past the edge request ceiling, and in exactly the conditions the pacing is
 * meant to survive. At a healthy 2/s this budget covers 180 recipients, which
 * is several times the largest roster in production, so it truncates nothing
 * that is currently working.
 */
const DEFAULT_BUDGET_MS = 90_000;

/** Recorded as the error for recipients the budget never reached. */
export const BUDGET_EXHAUSTED_ERROR = 'send budget exhausted';
```

Add to the `PacedOptions` interface, after the `maxRetries` field:

```ts
  /** Wall-clock ceiling for the whole fan-out. Defaults to 90s. */
  budgetMs?: number;
```

In `sendPaced`, add below `const now = options.now ?? (() => Date.now());`:

```ts
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
```

Then add the guard as the first statement inside `for (const recipient of recipients) {`, above `let attempts = 0;`:

```ts
    // Checked between recipients rather than mid-flight: aborting a send
    // already in progress would lose the distinction between a 429 worth
    // retrying and a request that never happened. One recipient can therefore
    // overshoot the budget by its own retry chain; the bound is on the fan-out,
    // not on any single send.
    if (now() - startedAt >= budgetMs) {
      results.push({
        recipient,
        attempts: 0,
        ok: false,
        status: 0,
        error: BUDGET_EXHAUSTED_ERROR,
      });
      continue;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/unit/emailQueue.test.ts
```

Expected: PASS, 17 tests (14 existing + 3 new). The pre-existing cases must all still pass — they pass no `budgetMs`, so they exercise the 90s default.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/emailQueue.ts tests/unit/emailQueue.test.ts
git commit -m "fix(email): bound sendPaced with an overall wall-clock budget"
```

---

### Task 2: Shared send summarizer

`notify-schedule-published` and `notify-schedule-unpublished` each hand-roll the same failure-log-plus-tally loop. Broadcast needs two things they don't — how many failures were specifically 429s, and a sample message to put in front of the manager — so this becomes a shared module rather than a third copy.

**Files:**
- Create: `supabase/functions/_shared/emailSendSummary.ts`
- Test: `tests/unit/emailSendSummary.test.ts`

**Interfaces:**
- Consumes: `PacedResult<T>` from `./emailQueue.ts` (Task 1 leaves its shape unchanged).
- Produces: `summarizeSends<T extends { id: string }>(results: PacedResult<T>[], label: string): EmailSendSummary` where `EmailSendSummary` is `{ sent: number; failed: number; rateLimited: number; firstError?: string }`. Task 3 calls this and maps all four fields into the response.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/emailSendSummary.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { summarizeSends } from '../../supabase/functions/_shared/emailSendSummary';

type Employee = { id: string; email: string };

const emp = (id: string): Employee => ({ id, email: `${id}@example.com` });

const ok = (id: string) => ({ recipient: emp(id), ok: true, status: 200, attempts: 1 });
const fail = (id: string, status: number, error?: string) => ({
  recipient: emp(id),
  ok: false,
  status,
  error,
  attempts: 1,
});

describe('summarizeSends', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tallies successes and failures', () => {
    const summary = summarizeSends([ok('a'), fail('b', 500, 'boom'), ok('c')], 'test');

    expect(summary.sent).toBe(2);
    expect(summary.failed).toBe(1);
  });

  it('counts a 429 as both failed and rate-limited', () => {
    const summary = summarizeSends([fail('a', 429, 'too many'), fail('b', 500, 'boom')], 'test');

    // The whole reason this module exists: "2 failed" and "1 of those was the
    // rate limit" are different operational stories.
    expect(summary.failed).toBe(2);
    expect(summary.rateLimited).toBe(1);
  });

  it('keeps the first failure message and ignores later ones', () => {
    const summary = summarizeSends([fail('a', 500, 'first'), fail('b', 500, 'second')], 'test');

    expect(summary.firstError).toBe('first');
  });

  it('truncates a long error rather than pasting a whole Resend body into the response', () => {
    const summary = summarizeSends([fail('a', 500, 'x'.repeat(500))], 'test');

    expect(summary.firstError).toHaveLength(201);
    expect(summary.firstError?.endsWith('…')).toBe(true);
  });

  it('falls back to the status when a failure carries no message', () => {
    const summary = summarizeSends([fail('a', 502)], 'test');

    expect(summary.firstError).toBe('HTTP 502');
  });

  it('omits firstError entirely when nothing failed', () => {
    const summary = summarizeSends([ok('a')], 'test');

    expect(summary).toEqual({ sent: 1, failed: 0, rateLimited: 0 });
  });

  it('logs the employee id and never the email address', () => {
    summarizeSends([fail('a', 429, 'too many')], 'broadcast');

    const logged = vi.mocked(console.error).mock.calls.flat().join(' ');
    // Function logs are readable well outside the tenant; a bounce is not a
    // reason to spill the roster's addresses into them.
    expect(logged).toContain('a');
    expect(logged).not.toContain('a@example.com');
  });

  it('returns zeros for an empty result set without logging', () => {
    const summary = summarizeSends([], 'test');

    expect(summary).toEqual({ sent: 0, failed: 0, rateLimited: 0 });
    expect(console.error).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/unit/emailSendSummary.test.ts
```

Expected: FAIL — `Failed to resolve import "../../supabase/functions/_shared/emailSendSummary"`.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/emailSendSummary.ts`:

```ts
/**
 * Turns a `sendPaced` result set into the numbers a caller reports and the
 * log lines an operator reads.
 *
 * `notify-schedule-published` and `notify-schedule-unpublished` each hand-roll
 * this same loop. Broadcast needs two things they don't — how many of the
 * failures were specifically 429s, and one sample message to put in front of
 * the manager — so it lives here rather than becoming a third copy. Those two
 * callers are candidates to migrate onto it.
 */

import type { PacedResult } from './emailQueue.ts';

/** Keeps a Resend error body out of the response payload and the log line. */
const MAX_ERROR_LENGTH = 200;

export interface EmailSendSummary {
  sent: number;
  failed: number;
  /** Subset of `failed` whose final status was 429. */
  rateLimited: number;
  /** First failure's message, truncated. Absent when nothing failed. */
  firstError?: string;
}

const truncate = (message: string): string =>
  message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH)}…` : message;

/**
 * Tally a fan-out and log each failure.
 *
 * Recipients are constrained to `{ id }` because the id is what gets logged —
 * see the comment on the log line.
 */
export const summarizeSends = <T extends { id: string }>(
  results: PacedResult<T>[],
  label: string,
): EmailSendSummary => {
  let sent = 0;
  let failed = 0;
  let rateLimited = 0;
  let firstError: string | undefined;

  for (const result of results) {
    if (result.ok) {
      sent++;
      continue;
    }

    failed++;
    if (result.status === 429) rateLimited++;
    if (firstError === undefined) {
      firstError = truncate(result.error ?? `HTTP ${result.status}`);
    }

    // Employee id, not address: function logs are readable well outside the
    // tenant, and a bounce log is not a reason to spill a roster's email
    // addresses into them. The id joins back to the row anyway.
    console.error(
      `[${label}] email to employee ${result.recipient.id} failed after ${result.attempts} attempt(s) [${result.status}]:`,
      result.error,
    );
  }

  return firstError === undefined
    ? { sent, failed, rateLimited }
    : { sent, failed, rateLimited, firstError };
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/unit/emailSendSummary.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/emailSendSummary.ts tests/unit/emailSendSummary.test.ts
git commit -m "feat(email): share a paced-send summarizer that keeps the 429 count"
```

---

### Task 3: Route the broadcast through `sendPaced`

The behavioural fix. Note there is no test step here: `index.ts` is a Deno entry that imports `https://deno.land/std@0.168.0/http/server.ts` and reads `Deno.env`, so Vitest cannot import it. Tasks 1 and 2 exist precisely so the logic being moved is already covered.

**Files:**
- Modify: `supabase/functions/broadcast-open-shifts/index.ts` (imports line 5; counters lines 167-168; email block lines 196-271; log line 286-288; response lines 290-299)

**Interfaces:**
- Consumes: `sendPaced` and `sendEmailResult` (re-exported from `_shared/notificationHelpers.ts` lines 10-11), `summarizeSends` from Task 2.
- Produces: the JSON response gains `email_recipients: number`, `email_rate_limited: number`, and `email_failed_reason?: string`. Task 4 reads all three.

- [ ] **Step 1: Update the imports**

Replace line 5:

```ts
import { sendEmail, NOTIFICATION_FROM, APP_URL } from "../_shared/notificationHelpers.ts";
```

with:

```ts
import { sendEmailResult, sendPaced, NOTIFICATION_FROM, APP_URL } from "../_shared/notificationHelpers.ts";
import { summarizeSends } from "../_shared/emailSendSummary.ts";
```

- [ ] **Step 2: Confirm `sendEmail` is no longer referenced in this file**

```bash
grep -n "sendEmail\b" supabase/functions/broadcast-open-shifts/index.ts
```

Expected: no output. If any line still calls `sendEmail(`, it was missed by Step 3 below — finish Step 3 and re-run this.

- [ ] **Step 3: Add the new counters**

Replace lines 167-168:

```ts
    let emailSentCount = 0;
    let emailFailCount = 0;
```

with:

```ts
    let emailSentCount = 0;
    let emailFailCount = 0;
    // Employees who actually have an address — a different, smaller denominator
    // than `allEmployees.length`, which the response reports as total_employees.
    let emailRecipientCount = 0;
    let emailRateLimitedCount = 0;
    let emailFailedReason: string | undefined;
```

- [ ] **Step 4: Replace the send loop**

Replace the whole block from line 200 (`for (const employee of emailEmployees) {`) through line 270 (`      }` closing that `for`) with the code below. Lines 196-199 (the `if (ch.email && RESEND_API_KEY) {` guard, the `emailEmployees` filter, and the `appUrl` const) stay as they are — this replaces only the loop.

The `subject` and `html` were being rebuilt on every iteration inside the loop. `subject` depends on nothing per-employee, so it is hoisted; `html` depends only on `employee.name`, so it becomes `buildHtml(name)`. The template string itself is copied verbatim from lines 203-258 with `${employee.name}` changed to `${name}`.

```ts
      emailRecipientCount = emailEmployees.length;
      const subject = `${totalOpenSpots} Open Shift${totalOpenSpots === 1 ? "" : "s"} Available — ${dateRange}`;

      const buildHtml = (name: string) => `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
              ${generateHeader()}

              <!-- Content -->
              <div style="padding: 40px 32px; background-color: #ffffff;">
                <h1 style="color: #1f2937; font-size: 24px; font-weight: 600; margin: 0 0 16px 0; line-height: 1.3;">Shifts Available</h1>

                <p style="color: #4b5563; line-height: 1.6; font-size: 16px; margin: 0 0 24px 0;">
                  Hi <strong style="color: #1f2937;">${name}</strong>,
                </p>

                <p style="color: #4b5563; line-height: 1.6; font-size: 16px; margin: 0 0 24px 0;">
                  <strong style="color: #1f2937;">${totalOpenSpots} ${shiftWord}</strong> open for the week of <strong style="color: #1f2937;">${dateRange}</strong>. Claim a spot before they fill up!
                </p>

                <div style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); padding: 24px; border-radius: 12px; margin: 24px 0; border-left: 4px solid #3b82f6;">
                  <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                      <td style="padding: 6px 0; color: #4b5563; font-size: 14px; font-weight: 600;">Open Shifts:</td>
                      <td style="padding: 6px 0; color: #1f2937; font-size: 14px; text-align: right;">${totalOpenSpots}</td>
                    </tr>
                    <tr>
                      <td style="padding: 6px 0; color: #4b5563; font-size: 14px; font-weight: 600;">Week:</td>
                      <td style="padding: 6px 0; color: #1f2937; font-size: 14px; text-align: right;">${dateRange}</td>
                    </tr>
                  </table>
                </div>

                <div style="text-align: center; margin: 32px 0;">
                  <a href="${appUrl}"
                     style="background-color: #2563eb; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: #ffffff !important; padding: 14px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3); mso-padding-alt: 14px 32px; border: 2px solid #2563eb;">
                    <span style="color: #ffffff !important;">View Open Shifts</span>
                  </a>
                </div>

                <p style="color: #6b7280; font-size: 14px; margin: 32px 0 0 0; line-height: 1.6;">
                  Open shifts are available on a first-come, first-served basis. Claim yours before they're taken!
                </p>
              </div>

              <!-- Footer -->
              <div style="background-color: #f9fafb; padding: 24px 32px; border-radius: 0 0 8px 8px; border-top: 1px solid #e5e7eb;">
                <p style="color: #6b7280; font-size: 13px; text-align: center; margin: 0; line-height: 1.5;">
                  <strong style="color: #4b5563;">EasyShiftHQ</strong><br>
                  Restaurant Operations Management System
                </p>
                <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 12px 0 0 0;">
                  &copy; ${new Date().getFullYear()} EasyShiftHQ. All rights reserved.
                </p>
                <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 8px 0 0 0;">
                  This is an automated notification. Please do not reply to this email.
                </p>
              </div>
            </div>
          `;

      // Paced rather than one send per iteration. Resend allows 2 requests a
      // second and an unpaced loop issues roughly ten, so the larger rosters
      // were collecting 429s that a bare boolean return hid completely.
      const emailResults = await sendPaced(
        emailEmployees,
        (employee) =>
          // `?? ""` because the `if (ch.email && RESEND_API_KEY)` narrowing does
          // not survive into this callback — the same reason both merged
          // callers write it (notify-schedule-published/index.ts:251).
          sendEmailResult(RESEND_API_KEY ?? "", NOTIFICATION_FROM, employee.email!, subject, buildHtml(employee.name)),
        { label: `open-shifts-broadcast ${publication_id}` }
      );

      const summary = summarizeSends(emailResults, "broadcast-open-shifts");
      emailSentCount = summary.sent;
      emailFailCount = summary.failed;
      emailRateLimitedCount = summary.rateLimited;
      emailFailedReason = summary.firstError;
```

The per-iteration `try/catch` is gone on purpose, not by omission: `sendPaced` already catches anything the send function throws and records it as a status-0 result (`emailQueue.ts:167-169`), so a thrower is still counted as a failure and still does not abort the rest of the fan-out.

- [ ] **Step 5: Update the summary log**

Replace lines 286-288:

```ts
    console.log(
      `Broadcast open shifts: ${pushSentCount} push, ${emailSentCount} email sent for publication ${publication_id}`
    );
```

with:

```ts
    console.log(
      `Broadcast open shifts: ${pushSentCount} push, ${emailSentCount}/${emailRecipientCount} email sent for publication ${publication_id}` +
        (emailFailCount > 0 ? ` — ${emailFailCount} failed, ${emailRateLimitedCount} rate-limited` : "")
    );
```

- [ ] **Step 6: Add the response fields**

Replace lines 296-298:

```ts
        email_sent: emailSentCount,
        email_failed: emailFailCount,
        total_employees: allEmployees.length,
```

with:

```ts
        email_recipients: emailRecipientCount,
        email_sent: emailSentCount,
        email_failed: emailFailCount,
        email_rate_limited: emailRateLimitedCount,
        email_failed_reason: emailFailedReason,
        total_employees: allEmployees.length,
```

- [ ] **Step 7: Verify**

```bash
npm run lint && npx vitest run tests/unit/emailQueue.test.ts tests/unit/emailSendSummary.test.ts
```

Expected: lint clean, 25 tests pass.

If `deno` is on PATH, also run the type check the CI edge-function job runs:

```bash
deno check supabase/functions/broadcast-open-shifts/index.ts
```

Expected: no errors. If `deno` is not installed, skip it — CI will cover it.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/broadcast-open-shifts/index.ts
git commit -m "fix(broadcast): pace open-shift emails and report what failed"
```

---

### Task 4: Report partial delivery in the toast

The function has always returned `email_failed`; the client destructures it and never reads it, so a manager sees an unqualified success message even when every email 429'd.

**Files:**
- Modify: `src/hooks/useBroadcastOpenShifts.ts` (whole file, 47 lines)
- Test: `tests/unit/useBroadcastOpenShifts.test.tsx` (new — no test covers this hook today)

**Interfaces:**
- Consumes: the response fields Task 3 added.
- Produces: exported `BroadcastResult` type and exported pure `buildBroadcastToast(data: BroadcastResult): { title: string; description: string; variant?: 'destructive' }`.

The new response fields are typed **optional** deliberately. The edge function and the bundle do not deploy atomically, so a freshly-loaded client can briefly talk to the old function. Optional-plus-`?? 0` degrades to the current message rather than rendering `undefined`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/useBroadcastOpenShifts.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const invokeMock = vi.fn();
const toastMock = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invokeMock(...a) },
  },
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }));

import { useBroadcastOpenShifts, buildBroadcastToast } from '@/hooks/useBroadcastOpenShifts';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

const result = (over: Partial<Parameters<typeof buildBroadcastToast>[0]> = {}) => ({
  success: true,
  open_shifts: 4,
  push_sent: 10,
  push_failed: 0,
  email_recipients: 12,
  email_sent: 12,
  email_failed: 0,
  email_rate_limited: 0,
  total_employees: 25,
  ...over,
});

describe('buildBroadcastToast', () => {
  it('reports plain success when every email went out', () => {
    expect(buildBroadcastToast(result())).toEqual({
      title: 'Broadcast sent',
      description: 'Notified 25 team members about 4 open shifts.',
    });
  });

  it('names the email denominator when some failed', () => {
    const toast = buildBroadcastToast(result({ email_sent: 9, email_failed: 3 }));

    // "3 of 12", not "3 of 25": total_employees counts everyone, but only the
    // 12 with an address were ever emailed.
    expect(toast.description).toBe(
      'Notified 25 team members about 4 open shifts. 3 of 12 emails failed to send.',
    );
    expect(toast.variant).toBeUndefined();
  });

  it('stays grammatical for a single failure without a plural branch', () => {
    expect(buildBroadcastToast(result({ email_sent: 11, email_failed: 1 })).description).toContain(
      '1 of 12 emails failed to send.',
    );
  });

  it('goes destructive when no email got through at all', () => {
    const toast = buildBroadcastToast(result({ email_sent: 0, email_failed: 12 }));

    expect(toast).toEqual({
      title: 'Broadcast sent, but no emails went out',
      description: 'Push notifications were sent. All 12 emails failed to send.',
      variant: 'destructive',
    });
  });

  it('reports plain success when there was no email channel to fail', () => {
    const toast = buildBroadcastToast(
      result({ email_recipients: 0, email_sent: 0, email_failed: 0 }),
    );

    expect(toast.variant).toBeUndefined();
    expect(toast.description).toBe('Notified 25 team members about 4 open shifts.');
  });

  it('degrades to the plain message when the function predates these fields', () => {
    const toast = buildBroadcastToast({
      success: true,
      open_shifts: 4,
      push_sent: 10,
      push_failed: 0,
      email_sent: 12,
      email_failed: 0,
      total_employees: 25,
    });

    expect(toast.description).toBe('Notified 25 team members about 4 open shifts.');
  });
});

describe('useBroadcastOpenShifts', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    toastMock.mockReset();
  });

  it('surfaces partial email failure through the toast', async () => {
    invokeMock.mockResolvedValue({
      data: result({ email_sent: 9, email_failed: 3, email_rate_limited: 3 }),
      error: null,
    });

    const { result: hook } = renderHook(() => useBroadcastOpenShifts(), { wrapper });
    hook.current.mutate({ restaurantId: 'r1', publicationId: 'p1' });

    await waitFor(() => expect(hook.current.isSuccess).toBe(true));
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining('3 of 12 emails failed to send.'),
      }),
    );
  });

  it('reports the error message when the invoke itself fails', async () => {
    invokeMock.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const { result: hook } = renderHook(() => useBroadcastOpenShifts(), { wrapper });
    hook.current.mutate({ restaurantId: 'r1', publicationId: 'p1' });

    await waitFor(() => expect(hook.current.isError).toBe(true));
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Broadcast failed', variant: 'destructive' }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/unit/useBroadcastOpenShifts.test.tsx
```

Expected: FAIL — `buildBroadcastToast` is not exported from `@/hooks/useBroadcastOpenShifts`.

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `src/hooks/useBroadcastOpenShifts.ts` with:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface BroadcastResult {
  success: boolean;
  open_shifts: number;
  push_sent: number;
  push_failed: number;
  email_sent: number;
  email_failed: number;
  total_employees: number;
  /**
   * Employees who actually have an address — the denominator the email counts
   * range over. `total_employees` counts everyone, so it is the wrong number to
   * report a failure against.
   *
   * Optional because the function and the bundle do not deploy together: a
   * freshly-loaded client can briefly talk to a function that predates these.
   */
  email_recipients?: number;
  email_rate_limited?: number;
  email_failed_reason?: string;
}

export interface BroadcastToast {
  title: string;
  description: string;
  variant?: 'destructive';
}

export function buildBroadcastToast(data: BroadcastResult): BroadcastToast {
  const recipients = data.email_recipients ?? 0;
  const failed = data.email_failed ?? 0;
  const base = `Notified ${data.total_employees} team members about ${data.open_shifts} open shifts.`;

  // Nothing was emailed at all. Push may still have landed, so this isn't an
  // outright failure — but "Broadcast sent" on its own would read as delivery.
  if (failed > 0 && failed >= recipients) {
    return {
      title: 'Broadcast sent, but no emails went out',
      description: `Push notifications were sent. All ${recipients} emails failed to send.`,
      variant: 'destructive',
    };
  }

  if (failed > 0) {
    // "1 of 12 emails failed to send" is grammatical at every n, so the count
    // needs no pluralization branch.
    return {
      title: 'Broadcast sent',
      description: `${base} ${failed} of ${recipients} emails failed to send.`,
    };
  }

  return { title: 'Broadcast sent', description: base };
}

export function useBroadcastOpenShifts() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: { restaurantId: string; publicationId: string }) => {
      const { data, error } = await supabase.functions.invoke('broadcast-open-shifts', {
        body: {
          restaurant_id: params.restaurantId,
          publication_id: params.publicationId,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error ?? 'Broadcast failed');
      return data as BroadcastResult;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['week_publication_status'] });
      queryClient.invalidateQueries({ queryKey: ['schedule_publications'] });
      toast(buildBroadcastToast(data));
    },
    onError: (error: Error) => {
      toast({
        title: 'Broadcast failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/unit/useBroadcastOpenShifts.test.tsx
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Run the full check**

```bash
npm run typecheck && npm run lint && npm run test
```

Expected: all clean. `npm run typecheck` matters here — `useBroadcastOpenShifts` is consumed by `src/components/scheduling/BroadcastOpenShiftsDialog.tsx`, and the return type changed from an inline object literal to the named `BroadcastResult`.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useBroadcastOpenShifts.ts tests/unit/useBroadcastOpenShifts.test.tsx
git commit -m "fix(broadcast): tell the manager when open-shift emails failed"
```

---

## Out of scope, by decision

Recorded so a reviewer does not read them as oversights. Full rationale is in the design doc.

- **`send-weekly-brief-email` is not touched.** It uses Resend's batch endpoint (up to 100 recipients per request), so pacing is moot. Its separate defect — counting a whole batch as delivered on `res.ok` without reading per-message results, `index.ts:158` — is left alone by scoping decision.
- **`notify-schedule-published` and `notify-schedule-unpublished` are not migrated onto `summarizeSends`.** They merged hours ago; leaving one more PR of duplication beats perturbing their tested behaviour here.
- **Broadcast idempotency is not fixed.** The publication stamp is written after the send loop (`index.ts:273-284`) with no server-side dedupe, so a mid-flight death leaves employees mailed and nothing stamped. Pre-existing; this change widens the window ~5× on the happy path, and Task 1's budget guard is what bounds it.
- **HTTP status stays 200 on partial email failure.** The destructive toast variant carries the signal instead.
