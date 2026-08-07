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

`Back` sits above the heading, as a ghost button with a `ChevronLeft` icon.
`Reviews.tsx:75-82` and `Reviews.tsx:346-357` already use that pattern. The
control is secondary in weight; `Send to the owner` stays the primary action.

**Warning: a stale error banner reads as a new failure.** Both stage controls
clear the error state before they change the stage.

```ts
// on `Tell us something directly` and on `Back`
setSubmitError(false);
```

`ReviewPage.tsx:411-415` renders the banner `That didn't send. Your rating is
already saved — try once more.` on `submitError`. Without the reset a guest
sees that banner over a form they did not send yet.

The comment text, the consent tick, the name and the email stay. A guest who
taps `Back` and returns must not lose what they typed.

After the guest sends the form, the `thanks` stage shows the Google button
again when `destinationUrl` is set. A comment must not cost the restaurant a
Google review.

```text
Thanks for telling us
You can also share this on Google.

[ Leave a Google review ]     ← only when destinationUrl is set
```

The sub-line `have a good one` (`ReviewPage.tsx:437-439`) becomes `You can also
share this on Google.` when a Google button follows it. A sign-off above a call
to action reads as an end. Without a `destinationUrl` the sub-line does not
change. The button uses the same style the `promoter` stage uses.

### Part 1b — the form copy follows the branch

`ReviewPage` keeps the server's decision in a new `routedTo` state value.

| Branch | Heading | Sub-line |
|---|---|---|
| `feedback` | `What happened?` | `this goes straight to the owner — not public` |
| `destination` | `Tell us more` | `this goes straight to the owner — not public` |

`What happened?` in front of a five-star guest reads as an accusation. The
sub-line is correct for both branches and does not change.

The comment field label states the new rule. `ReviewPage.tsx:348-350` reads
`Your feedback` today.

| Element | Copy |
|---|---|
| `Label` for `review-comment` | `Your feedback (optional)` |
| Help line under the field | `Write a note, give your email, or both.` |

The name and the email fields sit behind the consent tick
(`ReviewPage.tsx:371-397`). Without the help line a guest who wants no comment
sees a dead `Send` control and no reason for it.

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

**Warning: the button rule is not the only gate.** `handleSubmitComment`
(`ReviewPage.tsx:156`) holds a second, independent guard.

```ts
// before
if (!token || !comment.trim()) return;

// after
if (!token || !canSubmitFollowUp({ comment, consent, email })) return;
```

A change to the `disabled` rule alone leaves this guard in place. The button
then answers a tap with nothing: no request, no error, no new stage.

The request body sends no empty string.

```ts
comment: comment.trim() || undefined,
```

### Part 1e — the live region

`ReviewPage` holds one `aria-live` region through `setAnnouncement`. The region
is a diff channel: two identical strings announce once. Each new stage move
sets its own string.

| Move | Announcement |
|---|---|
| `promoter` → `feedback` (`Tell us something directly`) | `Tell us more. This goes straight to the owner.` |
| `feedback` → `promoter` (`Back`) | `Back to the Google link.` |
| `feedback` → `thanks`, `destinationUrl` set | `Thanks. You can also share this on Google.` |
| `feedback` → `thanks`, no `destinationUrl` | `Thanks. The owner has your note.` |

The `thanks` move sets no announcement today (`ReviewPage.tsx:157-180`). A
screen-reader guest hears nothing after a send, and hears nothing about the new
Google button. A guest who taps `Tell us something directly` and `Back` more
than once hears two different strings, so each move stays audible.

The heading focus effect (`ReviewPage.tsx:91-93`) stays. It moves focus; it
does not replace the announcement.

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
export type ReviewResponseFilter = 'all' | 'needsReply' | 'silent';
export function useReviewResponses(
  restaurantId?: string,
  filter: ReviewResponseFilter = 'all'
);
```

| Filter | Predicate |
|---|---|
| `all` | none |
| `needsReply` | `.or('comment.not.is.null,contact_consent.is.true')` |
| `silent` | `.is('comment', null).eq('contact_consent', false)` |

The predicate stays server-side, before the `.limit(500)` cap. The filter joins
the React Query key, so each mode caches on its own.

**Known limit, stated on purpose.** In `all` mode a heavy run of silent taps can
push an old comment past the 500-row cap. `Needs a reply` is the mode that
guarantees the full actionable list. A code comment records this trade.

### Part 2b — the list shows every response

A `ToggleGroup` with `type="single"` sits above the rows. It holds three
`ToggleGroupItem` controls: `All`, `Needs a reply`, `Silent`. Six components
already use this primitive, for example `src/components/roles/RoleEditor.tsx`.
Radix gives the group one tab stop and arrow-key movement. Three plain buttons
with `aria-pressed` give three tab stops and no arrow keys.

A row with no comment shows `No comment left` in muted text, in place of the
two-line comment clamp.

Empty-state copy follows the mode:

| Mode | Copy |
|---|---|
| `all` | `No ratings yet` |
| `needsReply` | `Nothing needs a reply yet` |
| `silent` | `No silent ratings` |

**The virtualizer needs three changes.** `Reviews.tsx:118-123` sets
`estimateSize: () => 118`, a constant tuned for a two-line comment clamp, a
meta row and a status chip. A silent row holds none of the clamp and no chip.

```ts
const virtualizer = useVirtualizer({
  count: responses.length,
  getScrollElement: () => listRef.current,
  // A silent row drops the two-line clamp and the status chip.
  estimateSize: (index) => (responses[index]?.comment ? 118 : 76),
  // Without a stable key the measurement cache is keyed by index. A filter
  // change then applies the old row's height to the new row at that index.
  getItemKey: (index) => responses[index].id,
  overscan: 10,
});
```

The list scrolls to the top on every filter change. A manager deep inside
`All` who taps `Silent` must not land in the middle of a shorter list.

```ts
useEffect(() => {
  if (listRef.current) listRef.current.scrollTop = 0;
}, [filter]);
```

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

**Warning: two rules apply here, and they are not the same rule.** A
contact-only row has no comment and is actionable. It shows the placeholder
text **and** it keeps the status chip.

| Element | Rule |
|---|---|
| `No comment left` in the list row | `comment === null` |
| `This guest left a rating only.` in the detail pane | `comment === null` |
| Status chip in the list row | `isActionable` |
| Status `Select` in the detail pane | `isActionable && canManage` |
| `Contact` card in the detail pane | `isActionable && canManage` |

A single `comment === null` test on all five elements hides the status chip on
a contact-only row. That result contradicts the rule above.

`ReviewFeedbackDetail.tsx:115-143` renders the `Contact` card on `canManage`
alone. On a non-actionable row that card always reads `This guest didn't leave
contact details`. The card then costs a manager a read and gives nothing back,
for the same reason the status control does.

### Part 2d — the unread metric follows the same rule

One migration replaces `review_response_metrics`.

```sql
count(*) FILTER (WHERE rr.status = 'new'
  AND (rr.comment IS NOT NULL OR rr.contact_consent)) AS unread_count
```

**Warning: a `DROP FUNCTION` here breaks the page for every user.** The
migration must use `CREATE OR REPLACE FUNCTION`, with the same signature
`public.review_response_metrics(p_restaurant_id UUID)` and the same attributes
`LANGUAGE sql STABLE SET search_path = public, pg_temp`. A `DROP` resets the
grants. `authenticated` then loses EXECUTE, and the Feedback tab header fails
with `permission denied for function`.

The migration also repeats the two grant lines, as
`20260803100000_assign_membership_role_custom_role_flavor_check.sql:187-193`
does.

```sql
REVOKE ALL ON FUNCTION public.review_response_metrics(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_response_metrics(UUID) TO authenticated;
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
`review_response_contacts`. Slice 1 already holds that table to
`manage:reviews` through the `review_response_contacts_select` policy
(`supabase/migrations/20260804100100_review_funnel_tables.sql:194-196`). The
primary key on `review_response_id`
(`supabase/migrations/20260804100100_review_funnel_tables.sql:78`) still allows
one contact row per response.

**No new grant.** `service_role` already holds `GRANT INSERT` on
`review_response_contacts`
(`supabase/migrations/20260804120000_review_funnel_service_role_grants.sql:46`)
and `GRANT UPDATE (comment, contact_consent, commented_at)` on
`review_responses` (line 44 of the same file). The widened write path uses the
grants slice 1 gave it.

**No enumeration oracle.** Every widened path keeps the existing answer shape.
A contact-only submit returns the same `{ ok: true }` a comment returns.
