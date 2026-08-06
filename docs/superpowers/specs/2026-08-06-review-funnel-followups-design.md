# Review Funnel Follow-Ups — Design

**Date:** 2026-08-06
**Branch:** `feature/review-funnel-followups`
**Depends on:** `docs/superpowers/specs/2026-08-04-review-funnel-design.md` (slice 1, shipped)

## Goal

Fix two gaps that slice 1 left in the review funnel.

1. A promoter cannot leave a comment or contact details. A 4-star or 5-star tap
   goes straight to the Google hand-off.
2. The admin inbox hides a rating that carries no comment. A 5-star tap exists
   in `review_responses` but never appears in the list.

## Problem 1 — the promoter branch is a dead end

`src/pages/ReviewPage.tsx:145` routes on the server's decision:

```tsx
if (data.routed_to === 'destination') {
  setDestinationUrl((data.destination_url as string) ?? null);
  setStage('promoter');
```

The `promoter` stage (`src/pages/ReviewPage.tsx:301-331`) shows a Google link and
a `No thanks` control. It offers no comment box and no contact fields. A guest
who loves the restaurant, and who wants a coupon or a reply, has no way to give
an email address.

The server does not cause this. `handleComment`
(`supabase/functions/review-public/index.ts:261`) never reads `routed_to`. It
accepts any valid token whose row has no comment yet. A promoter's token already
works today. The gap is in the client alone.

## Problem 2 — the inbox filters out silent ratings

`src/hooks/useReviewResponses.ts:67` adds one predicate:

```ts
.not('comment', 'is', null)
```

The header metrics do not come from that query. `review_response_metrics`
(`supabase/migrations/20260804110000_review_response_aggregates.sql:47`) is a
separate, uncapped aggregate over every row, so the average and the counts are
correct. Only the list is wrong.

---

## Design

### Part 1a — the promoter screen offers the form

The Google link stays the primary action. Two secondary controls sit under it:

```text
Thank you
Would you share that on Google?

[ Leave a Google review ]

  Tell us something directly
  No thanks
```

`Tell us something directly` moves the stage to `feedback`. The form gains a
`Back` control that returns to `promoter`, so a guest who changes their mind
does not lose the Google link.

After the guest sends the form, the `thanks` stage shows the Google button
again when `destinationUrl` is set. A comment must not cost the restaurant a
Google review.

### Part 1b — the form copy follows the branch

`ReviewPage` keeps the server's decision in a new `routedTo` state value.

| Branch | Heading | Sub-line |
|---|---|---|
| `feedback` | `What happened?` | `this goes straight to the owner — not public` |
| `destination` | `Tell us more` | `this goes straight to the owner — not public` |

`What happened?` in front of a five-star guest reads as an accusation. The
sub-line is correct for both branches and does not change.

### Part 1c — the comment becomes optional

The `Send` control enables when either condition is true:

- the guest writes a comment, or
- the guest ticks consent and gives an email that passes a shape check.

A new pure module holds that rule.

**File:** `src/lib/reviews/reviewSubmission.ts`

```ts
export function isPlausibleEmail(value: string): boolean;
export function canSubmitFollowUp(input: {
  comment: string;
  consent: boolean;
  email: string;
}): boolean;
```

The module is pure, so a unit test covers the rule. The rule must not live
inside the JSX, where only an E2E test can reach it.

### Part 1d — the server accepts a contact-only submit

Three changes in `handleComment`
(`supabase/functions/review-public/index.ts:261`).

**1. The required-comment rule becomes a required-payload rule.**

```ts
// before
if (!token || !comment || comment.length > MAX_COMMENT_LENGTH) return fail(400);

// after
if (!token || comment.length > MAX_COMMENT_LENGTH) return fail(400);
if (!comment && !(consent && isPlausibleEmail(email))) return fail(400);
```

A request with neither a comment nor a usable email writes nothing. It stays a
400, the same honest answer the handler gives today for a malformed body.

**2. The single-use guard moves to `commented_at`.**

```ts
// before
.is('comment', null)

// after
.is('commented_at', null)
```

`handleComment` is the only writer of `commented_at`. Every row that holds a
comment also holds a `commented_at` value, so the new guard rejects exactly the
replays the old one rejected. Unlike the old guard, it also works when the
comment is null.

**3. An empty comment stores as NULL, not as an empty string.**

```ts
comment: comment || null,
```

`review_response_metrics` counts `comment IS NOT NULL`. An empty string would
inflate the comment count and would put a blank row in the inbox.

The honeypot path, the rate limit path and the generic-error discipline do not
change. Every early exit still answers `{ ok: true }`.

The email shape check is duplicated: TypeScript in `src/lib/reviews/`, Deno in
`supabase/functions/_shared/`. The edge function cannot import from `src/`. Each
copy carries a comment that names the other. The server copy is authoritative.

### Part 2a — the inbox filter

`useReviewResponses` takes a second parameter.

```ts
export type ReviewResponseFilter = 'all' | 'commented' | 'silent';
export function useReviewResponses(
  restaurantId?: string,
  filter: ReviewResponseFilter = 'all'
);
```

| Filter | Predicate |
|---|---|
| `all` | none |
| `commented` | `.not('comment', 'is', null)` |
| `silent` | `.is('comment', null)` |

The predicate stays server-side, before the `.limit(500)` cap. The filter joins
the React Query key, so each mode caches on its own.

**Known limit, stated on purpose.** In `all` mode a heavy run of silent taps can
push an old comment past the 500-row cap. `With comments` is the mode that
guarantees the full comment list. A code comment records this trade.

### Part 2b — the list shows every response

A three-button filter group sits above the rows: `All`, `With comments`,
`Silent`. Each button carries `aria-pressed`.

A row with no comment shows `No comment left` in muted text, in place of the
two-line comment clamp.

Empty-state copy follows the mode:

| Mode | Copy |
|---|---|
| `all` | `No ratings yet` |
| `commented` | `No written feedback yet` |
| `silent` | `Every rating here came with a comment` |

### Part 2c — status applies to an actionable row only

A response is **actionable** when it holds a comment, or when the guest gave
contact consent.

```ts
const isActionable = response.comment !== null || response.contact_consent;
```

A non-actionable row shows no status chip in the list and no status control in
the detail pane. A silent five-star tap needs no triage. A status control on it
would offer a manager a chore that means nothing.

A contact-only row **is** actionable. The guest asked to hear back.

The detail pane shows `This guest left a rating only.` in place of the comment
body when the comment is null.

### Part 2d — the unread metric follows the same rule

One migration replaces `review_response_metrics`.

```sql
count(*) FILTER (WHERE rr.status = 'new'
  AND (rr.comment IS NOT NULL OR rr.contact_consent)) AS unread_count
```

The old rule counted `comment IS NOT NULL` alone. That rule now under-counts: a
contact-only row is actionable and must reach the badge.

The same migration documents the changed column meaning.

```sql
COMMENT ON COLUMN public.review_responses.commented_at IS
'When the guest finished the follow-up form. Does NOT imply a comment: a contact-only submit sets this and leaves comment NULL. Use comment IS NOT NULL to test for a comment.';
```

The other three aggregate columns do not change. `average_rating` and
`total_ratings` already count every row. `comment_count` correctly counts
comments only.

---

## Files

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/lib/reviews/reviewSubmission.ts` | Submit-enable rule, email shape check |
| Create | `supabase/functions/_shared/reviewContact.ts` | Server-side email shape check |
| Create | `supabase/migrations/20260806120000_review_metrics_actionable.sql` | Unread rule, column comment |
| Create | `tests/unit/reviewSubmission.test.ts` | The submit rule |
| Create | `tests/e2e/review-promoter-followup.spec.ts` | The promoter path, end to end |
| Modify | `src/pages/ReviewPage.tsx` | Promoter controls, branch copy, optional comment |
| Modify | `supabase/functions/review-public/index.ts` | `handleComment` payload rule and guard |
| Modify | `src/hooks/useReviewResponses.ts` | The filter parameter |
| Modify | `src/pages/Reviews.tsx` | Filter group, silent row, empty states |
| Modify | `src/components/reviews/ReviewFeedbackDetail.tsx` | Actionable rule |
| Modify | `tests/unit/useReviewResponses.test.ts` | The three filter modes |
| Modify | `supabase/tests/review_response_aggregates_test.sql` | The new unread rule |

## Testing

| Layer | Cases |
|---|---|
| Unit — `reviewSubmission` | comment only; email only with consent; email only without consent; malformed email; both empty; whitespace-only comment |
| Unit — `useReviewResponses` | each filter builds the right predicate; the filter joins the query key |
| pgTAP | unread counts a new comment row; unread counts a new contact-only row; unread skips a new silent row; `comment_count` still counts comments only |
| E2E | a promoter reaches the form and returns; a promoter sends a comment and still sees the Google button; a promoter sends an email with no comment |

## Out of scope

These items stay in the slice 2 backlog.

- The coupon or incentive message above a second threshold.
- An `ai-caller` summary over a period's comments.
- A reply by email through `_shared/emailQueue.ts`.

## Security review

**No new public write path.** `handleComment` accepts the same HMAC token it
accepted before. The change widens what a valid token may write, not who holds
one.

**The single-use guard does not weaken.** `commented_at IS NULL` is true for
exactly the rows `comment IS NULL` was true for, plus no others, because
`handleComment` is the only writer of both columns.

**No new PII column.** A contact-only submit writes to
`review_response_contacts`, which slice 1 already holds to `manage:reviews`
through RLS. The primary key on `review_response_id` still allows one contact
row per response.

**No enumeration oracle.** Every widened path keeps the existing answer shape.
A contact-only submit returns the same `{ ok: true }` a comment returns.
