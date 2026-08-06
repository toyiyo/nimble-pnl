# Review Funnel Follow-Ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a promoter leave a comment and contact details, and show every rating in the admin inbox.

**Architecture:** The public page keeps the server's routing decision in state, then offers the follow-up form on both branches. The submit rule moves out of the JSX into a pure module, duplicated in Deno for the edge function. The admin hook takes a filter parameter that is applied server-side, before the 500-row cap. One `CREATE OR REPLACE` migration changes the unread rule to match.

**Tech Stack:** React 18, TypeScript, Vite, TailwindCSS, shadcn/ui, React Query, Supabase (PostgreSQL + Deno edge functions), Vitest, Playwright, pgTAP.

**Design doc:** `docs/superpowers/specs/2026-08-06-review-funnel-followups-design.md` (commit `4fe0175b`).

## Global Constraints

- Worktree: `/Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/review-funnel-followups`. Branch: `feature/review-funnel-followups`. Every Bash call starts with `cd <worktree> &&`.
- Never `git add -A`, `git add .`, or `git commit -a`. Stage explicit paths only.
- Write every comment, commit message and document in ASD-STE100. See `docs/STE100_STYLE.md`. Maximum 20 words for an instruction, 25 for a description. Active voice. No `-ing` word as a noun. No hedges.
- No direct colors. Use semantic tokens (`text-foreground`, `bg-muted/30`, `border-border/40`).
- No manual caching. React Query only, `staleTime: 30000`.
- Every button without visible text needs `aria-label`. Every input needs a label.
- Handle the loading state, the error state and the empty state.
- The submit rule is duplicated: `src/lib/reviews/reviewSubmission.ts` (TypeScript) and `supabase/functions/_shared/reviewContact.ts` (Deno). The edge function cannot import from `src/`. The server copy is authoritative. Each copy names the other in a comment.
- The actionable-row rule is duplicated too: SQL in the migration, TypeScript in `isActionableResponse`. Each copy names the other in a comment.
- The migration must use `CREATE OR REPLACE FUNCTION`. A `DROP FUNCTION` resets the grants and breaks the Feedback tab header with `permission denied for function`.
- Every early exit in `handleComment` after the 400 check returns `{ ok: true }`. A caller must not tell a bot trip from a replay from a real write.
- Run Playwright with `--reporter=line`. Never the default `html` reporter.
- Bound every wait with the Bash tool `timeout` parameter. No poll loop.

---

### Task 1: The submit rule module

**Files:**
- Create: `src/lib/reviews/reviewSubmission.ts`
- Test: `tests/unit/reviewSubmission.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export function isPlausibleEmail(value: string): boolean`
  - `export function canSubmitFollowUp(input: { comment: string; consent: boolean; email: string }): boolean`
  - `export const MAX_EMAIL_LENGTH = 320`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/reviewSubmission.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

import { canSubmitFollowUp, isPlausibleEmail } from '@/lib/reviews/reviewSubmission';

describe('isPlausibleEmail', () => {
  it('accepts an ordinary address', () => {
    expect(isPlausibleEmail('ada@example.com')).toBe(true);
  });

  it('accepts a subdomain and a plus tag', () => {
    expect(isPlausibleEmail('ada+tag@mail.example.co.uk')).toBe(true);
  });

  it('trims before it checks', () => {
    expect(isPlausibleEmail('  ada@example.com  ')).toBe(true);
  });

  it('rejects an address with no domain', () => {
    expect(isPlausibleEmail('ada@')).toBe(false);
  });

  it('rejects an address with no dot in the domain', () => {
    expect(isPlausibleEmail('ada@localhost')).toBe(false);
  });

  it('rejects an address with a space', () => {
    expect(isPlausibleEmail('ada example.com')).toBe(false);
  });

  it('rejects an empty value', () => {
    expect(isPlausibleEmail('   ')).toBe(false);
  });

  it('rejects a value past the 320-character server limit', () => {
    // The server slices at 320. A longer value would arrive truncated, so a
    // client that calls it valid enables a button the server then rejects.
    expect(isPlausibleEmail(`${'a'.repeat(320)}@example.com`)).toBe(false);
  });
});

describe('canSubmitFollowUp', () => {
  it('allows a comment on its own', () => {
    expect(canSubmitFollowUp({ comment: 'The soup was cold', consent: false, email: '' })).toBe(
      true
    );
  });

  it('allows an email on its own when the guest consents', () => {
    expect(canSubmitFollowUp({ comment: '', consent: true, email: 'ada@example.com' })).toBe(true);
  });

  it('refuses an email without consent', () => {
    // Consent false means the server discards the value. A button that sends
    // it promises the guest a reply the restaurant never gets.
    expect(canSubmitFollowUp({ comment: '', consent: false, email: 'ada@example.com' })).toBe(
      false
    );
  });

  it('refuses a malformed email with no comment', () => {
    expect(canSubmitFollowUp({ comment: '', consent: true, email: 'ada@' })).toBe(false);
  });

  it('refuses an empty form', () => {
    expect(canSubmitFollowUp({ comment: '', consent: false, email: '' })).toBe(false);
  });

  it('refuses a whitespace-only comment with no email', () => {
    expect(canSubmitFollowUp({ comment: '   \n  ', consent: false, email: '' })).toBe(false);
  });

  it('allows a malformed email when the guest also writes a comment', () => {
    // The comment alone is enough. A typo in an optional field must not block
    // the note the guest came to leave.
    expect(canSubmitFollowUp({ comment: 'Great night', consent: true, email: 'ada@' })).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to check that it fails**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/review-funnel-followups && npx vitest run tests/unit/reviewSubmission.test.ts --reporter=verbose
```

Expected: FAIL. The message names the missing module `@/lib/reviews/reviewSubmission`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/reviews/reviewSubmission.ts`:

```ts
/**
 * The rule that decides when the guest follow-up form may be sent.
 *
 * The comment is optional. A guest may give an email and no comment, or a
 * comment and no email. A form that holds neither writes nothing, so the
 * Send control stays disabled.
 *
 * This whole module is a copy. `supabase/functions/_shared/reviewContact.ts`
 * holds the Deno original, which an edge function can import and this file
 * cannot: `isPlausibleEmail` and `hasFollowUpPayload` there answer to
 * `isPlausibleEmail` and `canSubmitFollowUp` here. That copy is
 * authoritative: this one only enables a button. Change both together, or
 * the button sends a request the server answers with a 400.
 */

/** The longest email `handleComment` accepts. It slices at this length. */
export const MAX_EMAIL_LENGTH = 320;

/**
 * One local part, one `@`, and a domain with at least one dot. Only a sent
 * mail proves an address works. This check catches the typo a guest can see.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function isPlausibleEmail(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_EMAIL_LENGTH) return false;
  return EMAIL_PATTERN.test(trimmed);
}

export function canSubmitFollowUp(input: {
  comment: string;
  consent: boolean;
  email: string;
}): boolean {
  if (input.comment.trim().length > 0) return true;
  // Consent false means the server discards the name and the email. Without
  // consent an address is not a payload.
  return input.consent && isPlausibleEmail(input.email);
}
```

- [ ] **Step 4: Run the test to check that it passes**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/review-funnel-followups && npx vitest run tests/unit/reviewSubmission.test.ts --reporter=verbose
```

Expected: PASS, 15 tests.

- [ ] **Step 5: Run the type check**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/review-funnel-followups && npm run typecheck
```

Expected: no error.

- [ ] **Step 6: Commit**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/review-funnel-followups && git add src/lib/reviews/reviewSubmission.ts tests/unit/reviewSubmission.test.ts && git -c commit.gpgsign=false commit -m "feat(reviews): add the follow-up submit rule

The comment becomes optional. A guest may give an email and no comment.
The rule is pure, so a unit test covers it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The server accepts a contact-only submit

**Files:**
- Create: `supabase/functions/_shared/reviewContact.ts`
- Modify: `supabase/functions/review-public/index.ts:257-330`

**Interfaces:**
- Consumes: the rule from Task 1, restated in Deno. No import across the boundary.
- Produces, from `../_shared/reviewContact.ts`:
  - `export const MAX_EMAIL_LENGTH = 320`
  - `export function isPlausibleEmail(value: string): boolean`
  - `export function hasFollowUpPayload(input: { comment: string; consent: boolean; email: string }): boolean`

**Context:** `handleComment` has no test harness in this repo. The edge function is stubbed in the E2E specs. Task 4 covers the client contract; the pgTAP test in Task 5 covers the aggregate. Verify this task with `npm run typecheck` and a careful read.

- [ ] **Step 1: Create the shared Deno module**

Create `supabase/functions/_shared/reviewContact.ts`:

```ts
/**
 * The submit rule `handleComment` uses.
 *
 * `src/lib/reviews/reviewSubmission.ts` holds the client copy, which enables
 * the Send control: `isPlausibleEmail` and `canSubmitFollowUp` there answer
 * to `isPlausibleEmail` and `hasFollowUpPayload` here. This copy is
 * authoritative: it decides what the server writes. An edge function cannot
 * import from `src/`. Change both together, or the button sends a request
 * the server answers with a 400.
 */

/** The longest email `handleComment` accepts. It slices at this length. */
export const MAX_EMAIL_LENGTH = 320;

/**
 * One local part, one `@`, and a domain with at least one dot. Only a sent
 * mail proves an address works. This check catches the typo a guest can see.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function isPlausibleEmail(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_EMAIL_LENGTH) return false;
  return EMAIL_PATTERN.test(trimmed);
}

export function hasFollowUpPayload(input: {
  comment: string;
  consent: boolean;
  email: string;
}): boolean {
  if (input.comment.trim().length > 0) return true;
  // Consent false means the server discards the name and the email. Without
  // consent an address is not a payload.
  return input.consent && isPlausibleEmail(input.email);
}
```

- [ ] **Step 2: Import the module in the edge function**

In `supabase/functions/review-public/index.ts`, add one import after line 16:

```ts
import { hashIp, isOverLimit, REVIEW_RATE_WINDOW_MS } from '../_shared/reviewRateLimit.ts';
import { hasFollowUpPayload, MAX_EMAIL_LENGTH } from '../_shared/reviewContact.ts';
```

- [ ] **Step 3: Delete the duplicate constant**

`index.ts:257-259` declares three constants. Delete the `MAX_EMAIL_LENGTH` line, which the import now supplies. Keep the other two.

```ts
// before
const MAX_COMMENT_LENGTH = 4000;
const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 320;

// after
const MAX_COMMENT_LENGTH = 4000;
const MAX_NAME_LENGTH = 200;
```

- [ ] **Step 4: Change the required-comment rule to a required-payload rule**

Replace `index.ts:274-276`:

```ts
// before
  // A malformed request is answered honestly with a 400 — that tells an
  // attacker nothing they did not already know about their own payload.
  if (!token || !comment || comment.length > MAX_COMMENT_LENGTH) return fail(400);

// after
  // A malformed request is answered honestly with a 400 — that tells an
  // attacker nothing they did not already know about their own payload.
  if (!token || comment.length > MAX_COMMENT_LENGTH) return fail(400);

  // The comment is optional, the payload is not. A request with neither a
  // comment nor a usable email writes nothing, so it stays a 400.
  if (!hasFollowUpPayload({ comment, consent, email })) return fail(400);
```

- [ ] **Step 5: Move the single-use guard to `commented_at` and store NULL for an empty comment**

Replace `index.ts:313-324`:

```ts
// before
  // `comment IS NULL` is what makes the token single-use: a replay updates
  // zero rows and still answers ok.
  const { data: updated, error: updateError } = await supabase
    .from('review_responses')
    .update({
      comment,
      contact_consent: consent,
      commented_at: new Date().toISOString(),
    })
    .eq('id', payload.rid)
    .is('comment', null)
    .select('id');

// after
  // `commented_at IS NULL` is what makes the token single-use: a replay
  // updates zero rows and still answers ok. `comment IS NULL` cannot do that
  // job now — a contact-only submit leaves the comment NULL, so a replay
  // would match again, re-run the UPDATE, and hit the primary key on
  // review_response_contacts. `handleComment` is the only writer of
  // `commented_at`, so the new guard rejects every replay the old one did.
  //
  // An empty comment stores as NULL, not as an empty string.
  // `review_response_metrics` counts `comment IS NOT NULL`, so an empty
  // string would inflate the comment count and put a blank row in the inbox.
  const { data: updated, error: updateError } = await supabase
    .from('review_responses')
    .update({
      comment: comment || null,
      contact_consent: consent,
      commented_at: new Date().toISOString(),
    })
    .eq('id', payload.rid)
    .is('commented_at', null)
    .select('id');
```

- [ ] **Step 6: Run the type check and the lint**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/review-funnel-followups && npm run typecheck && npm run lint
```

Expected: no error. `npm run typecheck` skips `supabase/functions`; the lint covers it.

- [ ] **Step 7: Read the changed handler once, end to end**

Read `supabase/functions/review-public/index.ts:261-349`. Check three rules:
1. Every exit after the two 400 lines returns `ok()`, which is `{ ok: true }`.
2. The honeypot path and the rate limit path do not change.
3. The contact insert still runs on `consent && (name || email)`.

- [ ] **Step 8: Commit**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/review-funnel-followups && git add supabase/functions/_shared/reviewContact.ts supabase/functions/review-public/index.ts && git -c commit.gpgsign=false commit -m "feat(reviews): accept a contact-only follow-up submit

The comment becomes optional on the server. The single-use guard moves to
commented_at, which stays the only column handleComment writes for that
job. An empty comment stores as NULL.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The promoter screen offers the form

**Files:**
- Modify: `src/pages/ReviewPage.tsx`

**Interfaces:**
- Consumes: `canSubmitFollowUp` from `@/lib/reviews/reviewSubmission` (Task 1).
- Produces: the DOM contract Task 4 asserts against — a `Tell us something directly` button, a `Back` button, a `Your feedback (optional)` label, and a `Leave a Google review` link on the `thanks` stage.

**Note on the branch test:** the design doc keys the copy on `routed_to`. Do
not hold `routed_to` in state. `routeRating` in
`supabase/functions/_shared/reviewRouting.ts:22` returns `'destination'` only
when a `destinationUrl` exists, and `handleRate` releases the URL only on that
branch. So `destinationUrl !== null` is the same test, and it cannot fall out
of step with a second state value.

- [ ] **Step 1: Add the imports**

In `src/pages/ReviewPage.tsx`, add the icon import and the module import. Follow the project import order: icons after the UI components, libraries last.

```tsx
import { StarRating } from '@/components/reviews/StarRating';

import { ChevronLeft } from 'lucide-react';

import { canSubmitFollowUp } from '@/lib/reviews/reviewSubmission';
import {
  classifyReviewPageResponse,
  type PublicReviewPage,
  type ReviewPageLoadState,
} from '@/lib/reviews/reviewPageLoad';
```

- [ ] **Step 2: Derive the branch from `destinationUrl`**

After the `announcement` state (`ReviewPage.tsx:66`), add:

```tsx
  // The server's branch decision, derived. `routeRating` returns
  // `'destination'` only when a URL exists. `handleRate` releases the URL only
  // on that branch. This test is the same one, with no second state to keep in
  // step. The form copy follows it. `What happened?` in front of a five-star
  // guest reads as an accusation.
  const isPromoterBranch = destinationUrl !== null;
```

- [ ] **Step 3: Leave `handleCommit` as it is**

`ReviewPage.tsx:144-152` already sets `destinationUrl` on the promoter branch and leaves it null on the other. Step 2 reads that value. No change here.

- [ ] **Step 4: Add the stage-move callback**

After `handleCommit` (`ReviewPage.tsx:155`), add:

```tsx
  // Every stage move clears the error banner first. The guest did not send the
  // new form yet. `That didn't send.` above it reads as a new failure.
  const goToStage = useCallback((next: Stage, message: string) => {
    setSubmitError(false);
    setStage(next);
    setAnnouncement(message);
  }, []);
```

The comment text, the consent tick, the name and the email are not cleared. A guest who taps `Back` and returns keeps what they typed.

- [ ] **Step 5: Change the submit guard, the payload and the announcement**

Replace `ReviewPage.tsx:157-180`:

```tsx
// before
  const handleSubmitComment = useCallback(async () => {
    if (!token || !comment.trim()) return;
    setSubmitting(true);
    setSubmitError(false);

    const { error } = await supabase.functions.invoke('review-public', {
      body: {
        action: 'comment',
        token,
        comment: comment.trim(),
        consent,
        name: consent ? name : undefined,
        email: consent ? email : undefined,
        hp: honeypot,
      },
    });

    setSubmitting(false);
    if (error) {
      setSubmitError(true);
      return;
    }
    setStage('thanks');
  }, [comment, consent, email, honeypot, name, token]);

// after
  const handleSubmitComment = useCallback(async () => {
    // The `disabled` prop is not the only gate. This guard must hold the same
    // rule, or a tap that gets past the button answers with nothing: no
    // request, no error, no new stage.
    if (!token || !canSubmitFollowUp({ comment, consent, email })) return;
    setSubmitting(true);
    setSubmitError(false);

    const { error } = await supabase.functions.invoke('review-public', {
      body: {
        action: 'comment',
        token,
        // An empty string would store as a blank comment. Send nothing.
        comment: comment.trim() || undefined,
        consent,
        name: consent ? name : undefined,
        email: consent ? email : undefined,
        hp: honeypot,
      },
    });

    setSubmitting(false);
    if (error) {
      setSubmitError(true);
      return;
    }
    goToStage(
      'thanks',
      destinationUrl
        ? 'Thanks. You can also share this on Google.'
        : 'Thanks. The owner has your note.'
    );
  }, [comment, consent, destinationUrl, email, goToStage, honeypot, name, token]);
```

`goToStage` is declared in Step 4, above `handleSubmitComment`. Keep that
order, or the `const` is read before its declaration.

- [ ] **Step 6: Add the `Tell us something directly` control to the promoter stage**

Replace `ReviewPage.tsx:323-329` (the `No thanks` button) with two controls:

```tsx
// before
          <button
            type="button"
            onClick={() => setStage('thanks')}
            className="counter-micro mt-4 w-full text-center text-[12px] text-muted-foreground underline"
          >
            No thanks
          </button>

// after
          <button
            type="button"
            onClick={() => goToStage('feedback', 'Tell us more. This goes straight to the owner.')}
            className="counter-micro mt-4 w-full text-center text-[12px] text-muted-foreground underline"
          >
            Tell us something directly
          </button>
          <button
            type="button"
            onClick={() => setStage('thanks')}
            className="counter-micro mt-2 w-full text-center text-[12px] text-muted-foreground underline"
          >
            No thanks
          </button>
```

- [ ] **Step 7: Add the `Back` control and the branch copy to the feedback stage**

Replace `ReviewPage.tsx:333-344` (the heading block of the `feedback` stage):

```tsx
// before
      {stage === 'feedback' && (
        <>
          <h1
            ref={branchHeadingRef}
            tabIndex={-1}
            className="counter-display text-center text-[26px] font-semibold text-foreground focus:outline-none"
          >
            What happened?
          </h1>
          <p className="counter-micro mt-2 text-center text-[12px] text-muted-foreground">
            this goes straight to the owner — not public
          </p>

// after
      {stage === 'feedback' && (
        <>
          {isPromoterBranch && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => goToStage('promoter', 'Back to the Google link.')}
              className="mb-2 h-9 px-2 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Back
            </Button>
          )}
          <h1
            ref={branchHeadingRef}
            tabIndex={-1}
            className="counter-display text-center text-[26px] font-semibold text-foreground focus:outline-none"
          >
            {isPromoterBranch ? 'Tell us more' : 'What happened?'}
          </h1>
          <p className="counter-micro mt-2 text-center text-[12px] text-muted-foreground">
            this goes straight to the owner — not public
          </p>
```

The `Back` control renders on the promoter branch only. A detractor never saw the `promoter` stage, so `Back` would move them to a screen they have not seen.

- [ ] **Step 8: Change the field label and add the help line**

Replace `ReviewPage.tsx:347-358` (the comment field block):

```tsx
// before
            <div>
              <Label htmlFor="review-comment" className="text-[13px] text-foreground">
                Your feedback
              </Label>
              <Textarea
                id="review-comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                rows={4}
                className="mt-1.5 bg-background border-border"
              />
            </div>

// after
            <div>
              <Label htmlFor="review-comment" className="text-[13px] text-foreground">
                Your feedback (optional)
              </Label>
              <Textarea
                id="review-comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                rows={4}
                className="mt-1.5 bg-background border-border"
              />
              {/* Without this line a guest who wants no comment sees a dead
                  Send control and no reason for it. */}
              <p className="counter-micro mt-1.5 text-[12px] text-muted-foreground">
                Write a note, give your email, or both.
              </p>
            </div>
```

- [ ] **Step 9: Change the Send control rule**

Replace `ReviewPage.tsx:417-424`:

```tsx
// before
            <Button
              type="button"
              onClick={handleSubmitComment}
              disabled={submitting || comment.trim().length === 0}
              className="h-11 w-full rounded-lg bg-primary text-[15px] font-medium text-primary-foreground"
            >
              {submitting ? 'Sending…' : 'Send to the owner'}
            </Button>

// after
            <Button
              type="button"
              onClick={handleSubmitComment}
              disabled={submitting || !canSubmitFollowUp({ comment, consent, email })}
              className="h-11 w-full rounded-lg bg-primary text-[15px] font-medium text-primary-foreground"
            >
              {submitting ? 'Sending…' : 'Send to the owner'}
            </Button>
```

- [ ] **Step 10: Add the Google button to the thanks stage**

Replace `ReviewPage.tsx:429-442`:

```tsx
// before
      {stage === 'thanks' && (
        <>
          <h1
            ref={branchHeadingRef}
            tabIndex={-1}
            className="counter-display text-center text-[26px] font-semibold text-foreground focus:outline-none"
          >
            Thanks for telling us
          </h1>
          <p className="counter-micro mt-3 text-center text-[12px] text-muted-foreground">
            have a good one
          </p>
        </>
      )}

// after
      {stage === 'thanks' && (
        <>
          <h1
            ref={branchHeadingRef}
            tabIndex={-1}
            className="counter-display text-center text-[26px] font-semibold text-foreground focus:outline-none"
          >
            Thanks for telling us
          </h1>
          {/* A sign-off above a call to action reads as an end. Say what the
              button below is for, or say goodbye — never both. */}
          <p className="counter-micro mt-3 text-center text-[12px] text-muted-foreground">
            {destinationUrl ? 'You can also share this on Google.' : 'have a good one'}
          </p>
          {/* A comment must not cost the restaurant a Google review. */}
          {destinationUrl && (
            <a
              href={destinationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 flex h-11 w-full items-center justify-center rounded-lg bg-primary text-[15px] font-medium text-primary-foreground"
            >
              Leave a Google review
            </a>
          )}
        </>
      )}
```

- [ ] **Step 11: Run the type check, the lint and the whole unit suite**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/review-funnel-followups && npm run typecheck && npm run lint && npx vitest run --reporter=dot
```

Expected: no type error, no lint error, and the unit suite stays green.

- [ ] **Step 12: Commit**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/review-funnel-followups && git add src/pages/ReviewPage.tsx && git -c commit.gpgsign=false commit -m "feat(reviews): offer the follow-up form to a promoter

The promoter screen gains a Tell us something directly control. The form
gains a Back control and branch copy. The comment becomes optional. The
thanks screen keeps the Google button.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The promoter path, end to end

**Files:**
- Create: `tests/e2e/review-promoter-followup.spec.ts`

**Interfaces:**
- Consumes: the DOM contract from Task 3.
- Produces: nothing.

**Context:** `tests/e2e/review-stars.spec.ts` is the model. The edge function does not run in the E2E stack, so `review-public` is stubbed with `page.route`. What the spec proves is the client wiring: which controls appear, and what the client sends.

- [ ] **Step 1: Write the failing spec**

Create `tests/e2e/review-promoter-followup.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * E2E: a promoter can leave a comment, an email, or both.
 *
 * Slice 1 sent a four-star or five-star guest straight to the Google
 * hand-off, with no way back. This spec is the regression guard for the
 * three paths that hand-off must not close.
 *
 * The edge function is not served in the e2e stack, so `review-public` is
 * stubbed. Other tests cover its token logic and its routing logic. This spec
 * proves the wiring. It shows which controls appear. It shows what the client
 * sends.
 */

const FN_GLOB = '**/functions/v1/review-public';
const PAGE_BODY = {
  restaurant_name: 'Test Diner',
  headline: 'How was everything?',
  subheadline: null,
  logo_url: null,
  threshold: 4,
};
const RATE_BODY = {
  token: 'stub-token',
  routed_to: 'destination',
  destination_url: 'https://example.com/google-review',
};

/** Stubs the three actions. Collects every `comment` body the page sends. */
async function stubReviewPublic(page: any, commentBodies: any[]) {
  await page.route(FN_GLOB, async (route: any) => {
    const body = route.request().postDataJSON();
    if (body.action === 'page') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(PAGE_BODY),
      });
    }
    if (body.action === 'rate') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(RATE_BODY),
      });
    }
    commentBodies.push(body);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
}

test.describe('public review page promoter follow-up', () => {
  test('a promoter reaches the form and returns with the text kept', async ({ page }) => {
    await stubReviewPublic(page, []);
    await page.goto('/r/table-tents');

    await page.getByRole('radio', { name: '5 out of 5 stars' }).click();
    await expect(page.getByRole('heading', { name: /thank you/i })).toBeVisible();

    await page.getByRole('button', { name: /tell us something directly/i }).click();

    // The heading follows the branch: `What happened?` reads as an
    // accusation in front of a five-star guest.
    await expect(page.getByRole('heading', { name: /tell us more/i })).toBeVisible();
    const field = page.getByLabel(/your feedback \(optional\)/i);
    await field.fill('The bread was excellent');

    await page.getByRole('button', { name: /^back$/i }).click();
    await expect(page.getByRole('link', { name: /leave a google review/i })).toBeVisible();

    await page.getByRole('button', { name: /tell us something directly/i }).click();
    await expect(page.getByLabel(/your feedback \(optional\)/i)).toHaveValue(
      'The bread was excellent'
    );
  });

  test('a promoter sends a comment and still sees the Google button', async ({ page }) => {
    const commentBodies: any[] = [];
    await stubReviewPublic(page, commentBodies);
    await page.goto('/r/table-tents');

    await page.getByRole('radio', { name: '5 out of 5 stars' }).click();
    await page.getByRole('button', { name: /tell us something directly/i }).click();
    await page.getByLabel(/your feedback \(optional\)/i).fill('The bread was excellent');
    await page.getByRole('button', { name: /send to the owner/i }).click();

    await expect(page.getByRole('heading', { name: /thanks for telling us/i })).toBeVisible();
    expect(commentBodies).toHaveLength(1);
    expect(commentBodies[0]).toMatchObject({
      action: 'comment',
      token: 'stub-token',
      comment: 'The bread was excellent',
    });

    // A comment must not cost the restaurant a Google review.
    const link = page.getByRole('link', { name: /leave a google review/i });
    await expect(link).toHaveAttribute('href', 'https://example.com/google-review');
  });

  test('a promoter sends an email with no comment', async ({ page }) => {
    const commentBodies: any[] = [];
    await stubReviewPublic(page, commentBodies);
    await page.goto('/r/table-tents');

    await page.getByRole('radio', { name: '5 out of 5 stars' }).click();
    await page.getByRole('button', { name: /tell us something directly/i }).click();

    const send = page.getByRole('button', { name: /send to the owner/i });
    // An empty form writes nothing, so the control stays disabled.
    await expect(send).toBeDisabled();

    await page.getByLabel(/it's ok to contact me about this/i).check();
    await page.getByLabel(/^email$/i).fill('ada@example.com');
    await expect(send).toBeEnabled();
    await send.click();

    await expect(page.getByRole('heading', { name: /thanks for telling us/i })).toBeVisible();
    expect(commentBodies).toHaveLength(1);
    // No empty string. An empty comment would store as a blank inbox row.
    expect(commentBodies[0].comment).toBeUndefined();
    expect(commentBodies[0]).toMatchObject({ consent: true, email: 'ada@example.com' });
  });
});
```

- [ ] **Step 2: Run the spec**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/review-funnel-followups && npx playwright test tests/e2e/review-promoter-followup.spec.ts --reporter=line
```

Expected: PASS, 3 tests. Task 3 already ships the behaviour.

If a selector fails, fix the selector — not the page. The page is the approved design. If the page is genuinely wrong, report it and stop.

If the run fails to start because the local Supabase auth database returns `500 "Database error finding user"`, that is a known environment fault. Run `npm run db:reset` first. This spec signs in nobody, so only the dev server must be up.

- [ ] **Step 3: Commit**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/review-funnel-followups && git add tests/e2e/review-promoter-followup.spec.ts && git -c commit.gpgsign=false commit -m "test(reviews): cover the promoter follow-up path end to end

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The unread metric follows the actionable rule

**Files:**
- Create: `supabase/migrations/20260806120000_review_metrics_actionable.sql`
- Modify: `supabase/tests/review_response_aggregates_test.sql`

**Interfaces:**
- Consumes: `public.review_response_metrics(p_restaurant_id UUID)` from `20260804110000_review_response_aggregates.sql:46`.
- Produces: the same four columns, with a new `unread_count` rule. Task 7 shows the number; the shape does not change.

- [ ] **Step 1: Write the failing pgTAP test**

Edit `supabase/tests/review_response_aggregates_test.sql`. Add a fourth fixture row and change the four expectations the row moves.

Replace the fixture comment and the response INSERT (lines 4-6 and 24-35):

```sql
-- Fixture: one page in restaurant A with four responses — one commented, one
-- contact-only, two silent — plus an owner (manage:reviews) and an outsider
-- with no restaurant at all.
```

```sql
INSERT INTO public.review_responses
  (id, restaurant_id, review_page_id, rating, routed_to, comment, contact_consent, status)
VALUES
  ('33333333-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000001', 5, 'destination', NULL, false, 'new'),
  ('33333333-0000-0000-0000-000000000002',
   '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000001', 2, 'feedback', 'The soup was cold', false, 'new'),
  ('33333333-0000-0000-0000-000000000003',
   '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000001', 4, 'destination', NULL, false, 'resolved'),
  -- A promoter who left an email and no comment. The guest asked to hear
  -- back, so the row is actionable and must reach the Unread badge.
  ('33333333-0000-0000-0000-000000000004',
   '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000001', 5, 'destination', NULL, true, 'new');
```

Change the four expectations:

```sql
SELECT is(
  (SELECT average_rating FROM public.review_response_metrics('11111111-0000-0000-0000-000000000001')),
  4.0::numeric,
  'review_response_metrics averages every rating, not just commented ones ((5+2+4+5)/4 = 4.0)'
);

SELECT is(
  (SELECT total_ratings FROM public.review_response_metrics('11111111-0000-0000-0000-000000000001')),
  4::bigint,
  'review_response_metrics counts all four responses, unbounded by any row cap'
);
```

`comment_count` stays `1::bigint`. Replace its neighbour, the unread assertion (lines 60-67):

```sql
-- Three rows are status 'new': a comment, a contact-only submit, and a
-- silent five-star tap. The first two need a reply. The third needs no
-- triage, so counting it would put a badge on the tab that the manager has
-- no row to act on and no way to clear.
SELECT is(
  (SELECT unread_count FROM public.review_response_metrics('11111111-0000-0000-0000-000000000001')),
  2::bigint,
  'review_response_metrics counts a new comment and a new contact-only row, not a silent tap'
);
```

Change the `review_page_stats` assertion (lines 69-74):

```sql
SELECT is(
  (SELECT rating_count FROM public.review_page_stats('11111111-0000-0000-0000-000000000001')
   WHERE review_page_id = '22222222-0000-0000-0000-000000000001'),
  4::bigint,
  'review_page_stats aggregates per page via GROUP BY, not per-card round trips'
);
```

`SELECT plan(6);` does not change. The count of assertions is the same.

- [ ] **Step 2: Run the test to check that it fails**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/review-funnel-followups && npm run test:db
```

Expected: FAIL on the unread assertion. It reports `have: 1` and `want: 2`. The old rule counts the comment row alone.

If the local Supabase stack is not up, run `npm run db:start` first.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260806120000_review_metrics_actionable.sql`:

```sql
-- ============================================================================
-- Review funnel follow-ups: the unread badge follows the actionable rule.
--
-- A guest can now finish the follow-up form with contact details and no
-- comment. That guest asked to hear back, so the row needs a reply and must
-- reach the Unread badge. The old rule counted `comment IS NOT NULL` alone
-- and under-counts it.
--
-- Warning: a DROP FUNCTION here breaks the page for every user. A DROP resets
-- the grants. `authenticated` then loses EXECUTE. The Feedback tab header
-- then fails with `permission denied for function`. Use CREATE OR REPLACE.
-- Keep the same signature and the same attributes. Restate the two grant
-- lines below.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.review_response_metrics(p_restaurant_id UUID)
RETURNS TABLE (
  average_rating NUMERIC,
  total_ratings BIGINT,
  comment_count BIGINT,
  unread_count BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    round(avg(rr.rating)::numeric, 1) AS average_rating,
    count(*) AS total_ratings,
    count(*) FILTER (WHERE rr.comment IS NOT NULL) AS comment_count,
    -- Unread counts the rows a manager can act on: a comment to read, or a
    -- guest who asked to hear back. A silent star tap is also born with
    -- status 'new' and needs no triage, so counting it would leave a badge
    -- the manager has no way to open or clear.
    -- `isActionableResponse` in src/hooks/useReviewResponses.ts holds the same
    -- rule for the client. Change both together, or the badge count and the
    -- rows that show a status chip disagree.
    count(*) FILTER (
      WHERE rr.status = 'new'
        AND (rr.comment IS NOT NULL OR rr.contact_consent)
    ) AS unread_count
  FROM public.review_responses rr
  WHERE rr.restaurant_id = p_restaurant_id;
$$;

REVOKE ALL ON FUNCTION public.review_response_metrics(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_response_metrics(UUID) TO authenticated;

COMMENT ON FUNCTION public.review_response_metrics(UUID) IS
'Restaurant-wide average rating / total ratings / comment count / unread actionable count for the Feedback tab header. Unread counts a new row that holds a comment or contact consent. Not capped at any row count, unlike the list query that backs the inbox rows themselves.';

COMMENT ON COLUMN public.review_responses.commented_at IS
'When the guest finished the follow-up form. Does NOT imply a comment: a contact-only submit sets this and leaves comment NULL. Use comment IS NOT NULL to test for a comment.';
```

- [ ] **Step 4: Apply the migration and run the test to check that it passes**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/review-funnel-followups && npm run db:reset && npm run test:db
```

Expected: PASS. The file reports 6 of 6.

- [ ] **Step 5: Check that the grant survived**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/review-funnel-followups && npx supabase db query --local "SELECT has_function_privilege('authenticated', 'public.review_response_metrics(uuid)', 'EXECUTE') AS granted;"
```

Expected: `granted` is `t`. A `f` means the migration dropped the function. Fix the migration; do not add a second grant migration.

If that CLI command is not available in this environment, use `mcp__supabase__execute_sql` against the local server with the same SELECT.

- [ ] **Step 6: Commit**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/review-funnel-followups && git add supabase/migrations/20260806120000_review_metrics_actionable.sql supabase/tests/review_response_aggregates_test.sql && git -c commit.gpgsign=false commit -m "feat(reviews): count a contact-only row as unread

A guest who leaves an email and no comment asked to hear back. The unread
metric now counts a new row that holds a comment or contact consent.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The inbox filter parameter

**Files:**
- Modify: `src/hooks/useReviewResponses.ts:41-74`
- Test: `tests/unit/useReviewResponses.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export type ReviewResponseFilter = 'all' | 'commented' | 'silent'`
  - `export function useReviewResponses(restaurantId?: string, filter: ReviewResponseFilter = 'all')`
  - `export function isActionableResponse(response: ReviewResponse): boolean`

`isActionableResponse` lives here, beside the `ReviewResponse` type. Task 7 and Task 8 both consume it, and both already import the type from this module. One predicate, one place.

- [ ] **Step 1: Change the list stub and write the failing tests**

In `tests/unit/useReviewResponses.test.ts`, replace `makeListStub` (lines 26-34). The `all` mode calls neither `.not()` nor `.is()`, so `.eq()` must return `order` as well.

```ts
/**
 * `.select(...).eq(...)` then, per filter, `.not(...)` / `.is(...)` / neither,
 * then `.order(...).limit(...)`. The `all` mode adds no predicate, so `eq`
 * carries `order` directly.
 */
function makeListStub(data: unknown, error: unknown = null) {
  const limit = vi.fn(async () => ({ data, error }));
  const order = vi.fn(() => ({ limit }));
  const not = vi.fn(() => ({ order }));
  const is = vi.fn(() => ({ order }));
  const eq = vi.fn(() => ({ not, is, order }));
  const select = vi.fn(() => ({ eq }));
  return { stub: { select }, select, eq, not, is, order, limit };
}
```

Add the type import beside the hook import (line 15):

```ts
import { useReviewResponses, type ReviewResponseFilter } from '@/hooks/useReviewResponses';
```

Replace the test at line 99 (`filters to commented rows server-side…`) with four tests:

```ts
  it('adds no comment predicate by default, then caps at 500, newest first', async () => {
    const list = makeListStub([RESPONSE_ROW]);
    mockSupabase.from.mockReturnValue(list.stub);
    mockSupabase.rpc.mockResolvedValue({ data: [METRICS_ROW], error: null });

    const { result } = renderHook(() => useReviewResponses('rest-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.responses).toHaveLength(1));
    expect(mockSupabase.from).toHaveBeenCalledWith('review_responses');
    expect(list.eq).toHaveBeenCalledWith('restaurant_id', 'rest-1');
    // A silent rating is a rating. The default mode hides nothing.
    expect(list.not).not.toHaveBeenCalled();
    expect(list.is).not.toHaveBeenCalled();
    expect(list.order).toHaveBeenCalledWith('submitted_at', { ascending: false });
    expect(list.limit).toHaveBeenCalledWith(500);
  });

  it('filters to commented rows server-side, before the cap', async () => {
    const list = makeListStub([RESPONSE_ROW]);
    mockSupabase.from.mockReturnValue(list.stub);
    mockSupabase.rpc.mockResolvedValue({ data: [METRICS_ROW], error: null });

    const { result } = renderHook(() => useReviewResponses('rest-1', 'commented'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.responses).toHaveLength(1));
    // The predicate must precede the cap. A client-side filter after a
    // 500-row fetch loses a written complaint behind 500 newer silent taps.
    expect(list.not).toHaveBeenCalledWith('comment', 'is', null);
    expect(list.limit).toHaveBeenCalledWith(500);
  });

  it('filters to silent rows server-side, before the cap', async () => {
    const list = makeListStub([RESPONSE_ROW]);
    mockSupabase.from.mockReturnValue(list.stub);
    mockSupabase.rpc.mockResolvedValue({ data: [METRICS_ROW], error: null });

    const { result } = renderHook(() => useReviewResponses('rest-1', 'silent'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.responses).toHaveLength(1));
    expect(list.is).toHaveBeenCalledWith('comment', null);
    expect(list.limit).toHaveBeenCalledWith(500);
  });

  it('caches each filter on its own key, so a filter change refetches', async () => {
    const list = makeListStub([RESPONSE_ROW]);
    mockSupabase.from.mockReturnValue(list.stub);
    mockSupabase.rpc.mockResolvedValue({ data: [METRICS_ROW], error: null });

    const { rerender } = renderHook(
      ({ filter }: { filter: ReviewResponseFilter }) => useReviewResponses('rest-1', filter),
      { wrapper: createWrapper(), initialProps: { filter: 'all' as ReviewResponseFilter } }
    );
    await waitFor(() => expect(list.limit).toHaveBeenCalledTimes(1));

    // A shared query key would answer `silent` from the `all` cache and show
    // commented rows under a filter that excludes them.
    rerender({ filter: 'silent' });
    await waitFor(() => expect(list.limit).toHaveBeenCalledTimes(2));
    expect(list.is).toHaveBeenCalledWith('comment', null);
  });
```

Add one test for the predicate, at the end of the `describe` block:

```ts
  it('calls a row actionable when it holds a comment or contact consent', () => {
    expect(isActionableResponse({ ...RESPONSE_ROW, comment: 'x', contact_consent: false })).toBe(
      true
    );
    // The guest asked to hear back. That is a chore, comment or not.
    expect(isActionableResponse({ ...RESPONSE_ROW, comment: null, contact_consent: true })).toBe(
      true
    );
    // A silent five-star tap needs no triage.
    expect(isActionableResponse({ ...RESPONSE_ROW, comment: null, contact_consent: false })).toBe(
      false
    );
  });
```

Extend the hook import to carry it:

```ts
import {
  isActionableResponse,
  useReviewResponses,
  type ReviewResponseFilter,
} from '@/hooks/useReviewResponses';
```

- [ ] **Step 2: Run the tests to check that they fail**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/review-funnel-followups && npx vitest run tests/unit/useReviewResponses.test.ts --reporter=verbose
```

Expected: FAIL. `isActionableResponse` is not exported, and the default mode still calls `.not()`.

- [ ] **Step 3: Change the hook**

In `src/hooks/useReviewResponses.ts`, add the type and the predicate after the `ReviewResponse` interface (line 21):

```ts
/** Which rows the inbox list asks for. The predicate runs server-side. */
export type ReviewResponseFilter = 'all' | 'commented' | 'silent';

/**
 * A row a manager can act on: a comment to read, or a guest who asked to hear
 * back. A silent five-star tap is neither, so it carries no status and no
 * contact card.
 *
 * The `unread_count` FILTER in `review_response_metrics` holds the same rule
 * in SQL (supabase/migrations/20260806120000_review_metrics_actionable.sql).
 * Change both together, or the header badge and the rows disagree.
 */
export function isActionableResponse(response: ReviewResponse): boolean {
  return response.comment !== null || response.contact_consent;
}
```

Replace the signature and the list query (lines 41-74):

```ts
export function useReviewResponses(
  restaurantId?: string,
  filter: ReviewResponseFilter = 'all'
) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const query = useQuery({
    // The filter joins the key, so each mode caches on its own. A shared key
    // would answer `silent` from the `all` cache.
    queryKey: ['review-responses', restaurantId, filter],
    enabled: Boolean(restaurantId),
    staleTime: 30000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<ReviewResponse[]> => {
      // The filter is applied SERVER-side, before the cap. A filter after a
      // `.limit(500)` would mean a location that takes 500 silent star taps
      // after a written complaint fetches 500 silent rows and shows an empty
      // inbox — the complaint dropped off the end of a window it was never in.
      //
      // Known limit: in `all` mode a heavy run of silent taps can push an old
      // comment past the 500-row cap. `With comments` is the mode that
      // guarantees the full comment list.
      //
      // Capped at 500 for the inbox *list* only. The header metrics below do
      // NOT come from this capped array; they're a separate, uncapped
      // server-side aggregate, so a restaurant past 500 comments still sees a
      // correct average/total/unread count.
      const base = supabase
        .from('review_responses' as any)
        .select(
          'id, restaurant_id, review_page_id, rating, routed_to, comment, contact_consent, status, submitted_at, commented_at'
        )
        .eq('restaurant_id', restaurantId!);

      // `all` adds no predicate, so it reads the base query unchanged.
      let scoped = base;
      if (filter === 'commented') scoped = base.not('comment', 'is', null);
      else if (filter === 'silent') scoped = base.is('comment', null);

      const { data, error } = await scoped
        .order('submitted_at', { ascending: false })
        .limit(500);

      if (error) throw error;
      return (data ?? []) as unknown as ReviewResponse[];
    },
  });
```

The `updateStatus` mutation invalidates `['review-responses', restaurantId]`. React Query matches a key prefix, so every filter's cache still clears. Leave it as it is.

- [ ] **Step 4: Run the tests to check that they pass**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/review-funnel-followups && npx vitest run tests/unit/useReviewResponses.test.ts --reporter=verbose && npm run typecheck
```

Expected: PASS, 17 tests. No type error.

- [ ] **Step 5: Commit**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/review-funnel-followups && git add src/hooks/useReviewResponses.ts tests/unit/useReviewResponses.test.ts && git -c commit.gpgsign=false commit -m "feat(reviews): give useReviewResponses a server-side filter

The default mode shows every rating. The commented and silent modes add
one predicate each, before the 500-row cap. The filter joins the query key.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The inbox list shows every response

**Files:**
- Modify: `src/pages/Reviews.tsx:80-258`

**Interfaces:**
- Consumes: `useReviewResponses(restaurantId, filter)`, `ReviewResponseFilter` and `isActionableResponse` from Task 6.
- Produces: nothing.

- [ ] **Step 1: Add the imports**

In `src/pages/Reviews.tsx`, add the ToggleGroup import and extend the hook import:

```tsx
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
```

```tsx
import {
  isActionableResponse,
  useReviewResponses,
  type ReviewResponse,
  type ReviewResponseFilter,
  type ReviewResponseStatus,
} from '@/hooks/useReviewResponses';
```

Add `useEffect` to the React import on line 1:

```tsx
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
```

- [ ] **Step 2: Add the empty-state table**

After `STATUS_LABELS` (`Reviews.tsx:74-78`), add:

```tsx
const FILTER_LABELS: Array<[ReviewResponseFilter, string]> = [
  ['all', 'All'],
  ['commented', 'With comments'],
  ['silent', 'Silent'],
];

const EMPTY_STATES: Record<ReviewResponseFilter, { title: string; body: string }> = {
  all: {
    title: 'No ratings yet',
    body: 'Put a review page QR code on the table. Every tap lands here.',
  },
  commented: {
    title: 'No written feedback yet',
    body: 'Every guest can leave a note, at any star count. Their notes land here.',
  },
  silent: {
    title: 'Every rating here has a comment',
    body: 'A silent rating is a star tap with no note.',
  },
};
```

- [ ] **Step 3: Hold the filter and pass it to the hook**

Replace `Reviews.tsx:80-92`:

```tsx
// before
function FeedbackTab({ restaurantId, canManage }: { restaurantId?: string; canManage: boolean }) {
  const { responses, metrics, isLoading, error, updateStatus, fetchContact } =
    useReviewResponses(restaurantId);
  const { pages } = useReviewPages(restaurantId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // `responses` is already the commented rows only — the hook filters them
  // server-side, before its 500-row cap. Ratings without a comment are a
  // number, not a message: they count toward the header metrics and stay out
  // of the list, because an inbox of 300 silent five-star taps is an inbox
  // nobody opens.
  const selected = responses.find((row) => row.id === selectedId) ?? null;

// after
function FeedbackTab({ restaurantId, canManage }: { restaurantId?: string; canManage: boolean }) {
  const [filter, setFilter] = useState<ReviewResponseFilter>('all');
  const { responses, metrics, isLoading, error, updateStatus, fetchContact } =
    useReviewResponses(restaurantId, filter);
  const { pages } = useReviewPages(restaurantId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // The hook applies the filter server-side, before its 500-row cap. A row
  // the new mode excludes leaves `selected` null, and the detail pane closes.
  const selected = responses.find((row) => row.id === selectedId) ?? null;
```

- [ ] **Step 4: Change the virtualizer and reset the scroll on a filter change**

Replace `Reviews.tsx:114-123`:

```tsx
// before
  // Comments are free text: a two-line clamp, a one-line meta row and a
  // status chip land most rows near 118px, and `measureElement` corrects the
  // rest. The cap the hook enforces is 500 rows, which is exactly the range
  // where mounting every row starts costing a manager real scroll latency.
  const virtualizer = useVirtualizer({
    count: responses.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 118,
    overscan: 10,
  });

// after
  // Comments are free text: a two-line clamp, a one-line meta row and a
  // status chip land most rows near 118px, and `measureElement` corrects the
  // rest. The cap the hook enforces is 500 rows, which is exactly the range
  // where mounting every row starts costing a manager real scroll latency.
  // Both callbacks stay memoized. The virtualizer compares them by reference
  // to decide if it must re-measure every row. A fresh arrow function per
  // render breaks that check, so a plain row click re-measures all 500 rows.
  // A silent row drops the two-line clamp and the status chip.
  const estimateSize = useCallback(
    (index: number) => (responses[index]?.comment ? 118 : 76),
    [responses]
  );
  // Without a stable key the measurement cache is keyed by index. A filter
  // change then applies the old row's height to the new row at that index.
  const getItemKey = useCallback((index: number) => responses[index].id, [responses]);

  const virtualizer = useVirtualizer({
    count: responses.length,
    getScrollElement: () => listRef.current,
    estimateSize,
    getItemKey,
    overscan: 10,
  });

  // A manager deep inside `All` who taps `Silent` must not land in the middle
  // of a shorter list.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [filter]);
```

- [ ] **Step 5: Render the filter group above the list, and the new empty states**

Replace `Reviews.tsx:165-171` (the empty-state branch). The filter group sits **above** the branch: a manager stuck in `Silent` with zero rows must still reach `All`.

```tsx
// before
      {responses.length === 0 ? (
        <div className="mt-6 rounded-xl border border-border/40 p-10 text-center">
          <h2 className="text-[15px] font-semibold text-foreground">No written feedback yet</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Guests who rate below your threshold get the private form. Their notes land here.
          </p>
        </div>
      ) : (

// after
      <ToggleGroup
        type="single"
        value={filter}
        // Radix sends an empty string when the manager taps the active item.
        // Keep the mode; a list with no filter at all is not a state.
        onValueChange={(value) => value && setFilter(value as ReviewResponseFilter)}
        aria-label="Filter feedback"
        className="mt-6 justify-start"
      >
        {FILTER_LABELS.map(([key, label]) => (
          <ToggleGroupItem key={key} value={key} className="h-9 px-3 text-[13px]">
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {responses.length === 0 ? (
        <div className="mt-4 rounded-xl border border-border/40 p-10 text-center">
          <h2 className="text-[15px] font-semibold text-foreground">
            {EMPTY_STATES[filter].title}
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">{EMPTY_STATES[filter].body}</p>
        </div>
      ) : (
```

Change the wrapper below the branch from `mt-6` to `mt-4`, so the list keeps the same gap the empty state has:

```tsx
// before
        <div className="mt-6 md:grid md:grid-cols-[340px_1fr] md:gap-6">

// after
        <div className="mt-4 md:grid md:grid-cols-[340px_1fr] md:gap-6">
```

- [ ] **Step 6: Change the row**

Replace the body of `FeedbackRow` (`Reviews.tsx:248-255`):

```tsx
// before
      <div className="flex items-center justify-between gap-2">
        <StarDisplay rating={response.rating} className="text-[14px] text-foreground" />
        <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
          {STATUS_LABELS[response.status]}
        </span>
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground truncate">{meta}</p>
      <p className="mt-2 text-[13px] text-foreground line-clamp-2">{response.comment}</p>

// after
      <div className="flex items-center justify-between gap-2">
        <StarDisplay rating={response.rating} className="text-[14px] text-foreground" />
        {/* Two rules, and they are not the same rule. A contact-only row has
            no comment and is actionable: it shows the placeholder AND the
            chip. A silent tap needs no triage, so it carries no status. */}
        {isActionableResponse(response) && (
          <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
            {STATUS_LABELS[response.status]}
          </span>
        )}
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground truncate">{meta}</p>
      {response.comment === null ? (
        <p className="mt-2 text-[13px] text-muted-foreground">No comment left</p>
      ) : (
        <p className="mt-2 text-[13px] text-foreground line-clamp-2">{response.comment}</p>
      )}
```

- [ ] **Step 7: Run the type check, the lint and the unit suite**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/review-funnel-followups && npm run typecheck && npm run lint && npx vitest run --reporter=dot
```

Expected: no error, suite green.

- [ ] **Step 8: Commit**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/review-funnel-followups && git add src/pages/Reviews.tsx && git -c commit.gpgsign=false commit -m "feat(reviews): show every rating in the inbox

A filter group holds All, With comments and Silent. A silent row shows a
placeholder and no status chip. The virtualizer takes a per-row estimate
and a stable key.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: The detail pane follows the actionable rule

**Files:**
- Modify: `src/components/reviews/ReviewFeedbackDetail.tsx:93-143`

**Interfaces:**
- Consumes: `isActionableResponse` from Task 6.
- Produces: nothing.

- [ ] **Step 1: Extend the import**

In `src/components/reviews/ReviewFeedbackDetail.tsx`, change the type import (lines 17-21) into a value import plus the types:

```tsx
import {
  isActionableResponse,
  type ReviewResponse,
  type ReviewResponseContact,
  type ReviewResponseStatus,
} from '@/hooks/useReviewResponses';
```

- [ ] **Step 2: Compute the rule once**

After the `contactLoading` state (line 46), add:

```tsx
  // A comment to read, or a guest who asked to hear back. A silent five-star
  // tap is neither: a status control on it offers a chore that means nothing.
  const isActionable = isActionableResponse(response);
```

- [ ] **Step 3: Gate the status control**

Replace `ReviewFeedbackDetail.tsx:93`:

```tsx
// before
        {canManage && (

// after
        {canManage && isActionable && (
```

- [ ] **Step 4: Replace the comment body with a branch**

Replace `ReviewFeedbackDetail.tsx:113`:

```tsx
// before
      <p className="mt-5 text-[14px] text-foreground whitespace-pre-wrap">{response.comment}</p>

// after
      {response.comment === null ? (
        <p className="mt-5 text-[14px] text-muted-foreground">This guest left a rating only.</p>
      ) : (
        <p className="mt-5 text-[14px] text-foreground whitespace-pre-wrap">{response.comment}</p>
      )}
```

The test here is `comment === null`, not `isActionable`. A contact-only row has no comment and still shows this line.

- [ ] **Step 5: Gate the contact card**

Replace `ReviewFeedbackDetail.tsx:115`:

```tsx
// before
      {canManage && (

// after
      {canManage && isActionable && (
```

On a non-actionable row the card always reads `This guest didn't leave contact details.` It costs a manager a read and gives nothing back.

- [ ] **Step 6: Run the type check, the lint and the unit suite**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/review-funnel-followups && npm run typecheck && npm run lint && npx vitest run --reporter=dot
```

Expected: no error, suite green.

- [ ] **Step 7: Commit**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/review-funnel-followups && git add src/components/reviews/ReviewFeedbackDetail.tsx && git -c commit.gpgsign=false commit -m "feat(reviews): hide the status control on a silent rating

A silent star tap carries no comment and no contact consent. It needs no
triage, so the detail pane drops the status control and the contact card.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Whole-branch verification

**Files:** none.

**Interfaces:**
- Consumes: every task above.
- Produces: the evidence for the PR body.

- [ ] **Step 1: Run the type check, the lint and the build**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/review-funnel-followups && npm run typecheck && npm run lint && npm run build
```

Expected: no error.

- [ ] **Step 2: Run the unit suite**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/review-funnel-followups && npx vitest run --reporter=dot
```

Expected: PASS. Record the totals.

- [ ] **Step 3: Run the database tests**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/review-funnel-followups && npm run test:db
```

Expected: PASS.

- [ ] **Step 4: Run the review E2E specs**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/review-funnel-followups && npx playwright test tests/e2e/review-promoter-followup.spec.ts tests/e2e/review-stars.spec.ts tests/e2e/review-funnel.spec.ts tests/e2e/review-page-load.spec.ts --reporter=line
```

Expected: PASS. Report any failure with its output. Do not report a skipped run as a pass.

- [ ] **Step 5: Read the whole branch diff once**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/review-funnel-followups && git diff $(git merge-base origin/main HEAD)..HEAD --stat
```

Check that the changed files match the plan file list, and that no extra file appears.

---

## Spec coverage

| Spec section | Task |
|---|---|
| 1a — the promoter screen offers the form | 3 (steps 4, 6, 7, 10) |
| 1b — the form copy follows the branch | 3 (steps 2, 3, 7, 8) |
| 1c — the comment becomes optional | 1, 3 (steps 5, 9) |
| 1d — the server accepts a contact-only submit | 2 |
| 1e — the live region | 3 (steps 4, 5) |
| 2a — the inbox filter | 6 |
| 2b — the list shows every response | 7 |
| 2c — status applies to an actionable row only | 6 (predicate), 7 (list), 8 (detail) |
| 2d — the unread metric follows the same rule | 5 |
| Testing — unit `reviewSubmission` | 1 |
| Testing — unit `useReviewResponses` | 6 |
| Testing — pgTAP | 5 |
| Testing — E2E | 4 |
