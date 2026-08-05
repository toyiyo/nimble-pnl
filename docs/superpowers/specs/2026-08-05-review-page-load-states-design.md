# Review page load states — design

**Date:** 2026-08-05
**Branch:** `fix/review-page-error-state`

## The problem, from the outage that exposed it

`REVIEW_TOKEN_SECRET` and `REVIEW_IP_PEPPER` were never set as production
edge-function secrets. The env guard in `review-public` runs before the body is
even parsed and returns a bare 500
(`supabase/functions/review-public/index.ts:71-73`), so **every** call to the
public review page failed.

What the guest and the owner saw was: *"This link isn't active — ask the
restaurant for a current one."*

That message is a lie about a specific, checkable thing. The owner spent the
outage toggling `is_active` on a page that was already live, because the UI told
them the page was paused. The infrastructure failure was invisible; the one
domain state the UI named was the one thing that was fine.

The cause is a single line. `src/pages/ReviewPage.tsx:76` collapses three
distinct outcomes into one:

```tsx
if (error || !data || data.inactive) {
  setInactive(true);
}
```

`error` (transport failure or any non-2xx from the function), `!data` (nothing
came back), and `data.inactive` (the page really is paused) all set the same
flag, and `src/pages/ReviewPage.tsx:176` renders the same paused screen for all
three.

## What the function actually returns

Three shapes, and the client currently distinguishes only one of them:

| Situation | Response |
|---|---|
| Page found and live | 200, the payload at `supabase/functions/review-public/index.ts:140-146` |
| Slug unknown **or** page paused | 200 `{ inactive: true }` (`index.ts:134`) |
| Missing config, DB error, bad request | 4xx/5xx `{ error: <generic string> }` (`index.ts:24-25`) |

Merging unknown-slug with paused is deliberate at the function — it stops a
public endpoint from confirming which slugs exist (`index.ts:128`, the comment
above the branch says so). That merge is correct and stays. The merge this
design undoes is the client-side one, between *the function answered* and *the
function did not*.

Two premises worth pinning, because the fix depends on them:

- `supabase.functions.invoke()` **resolves** with `{ data, error }` on HTTP
  failures and only rejects on transport failures. So a 500 arrives as a
  resolved `error`, not a throw — which is why the current code catches it at
  all, and why the fix belongs in the same branch rather than in a `try`.
  (Confirmed for this codebase in `memory/lessons.md`, entry 2026-05-16.)
- `restaurant_name` can legitimately be the empty string: the payload uses
  `?? ''` when the restaurant join comes back null
  (`supabase/functions/review-public/index.ts:141`). Any validation must accept
  `''`, or a live page with an odd join renders as an error.

## The fix

**Split the outcome into three, and let only `data.inactive` mean paused.**

### 1. A pure classifier, in `src/lib`

`src/lib/reviews/reviewPageLoad.ts` (new) exports the payload type and one
function:

```ts
export type ReviewPageLoad =
  | { kind: 'ready'; page: PublicReviewPage }
  | { kind: 'inactive' }
  | { kind: 'error' };

export function classifyReviewPageResponse(data: unknown, error: unknown): ReviewPageLoad;
```

Rules, in order:

1. `error` truthy → `error`
2. `data` is not a non-null object → `error`
3. `data.inactive === true` → `inactive`
4. the payload validates (`restaurant_name` and `headline` are strings,
   `threshold` is an integer 1–5, `subheadline` and `logo_url` are string-or-null)
   → `ready`
5. otherwise → `error`

Rule 4 is a change in behaviour beyond the reported bug, and it is intentional:
today `data as PublicPage` (`src/pages/ReviewPage.tsx:79`) is an unchecked cast,
so a malformed 200 renders a card with `undefined` in it and a star control
wired to a threshold of `undefined`. A response the client cannot read is a
failure, and should look like one.

This lives in `src/lib` rather than in the page for two reasons: it is pure
logic, which this codebase keeps out of `src/pages` so it lands in the
coverage-measured surface; and the classification is the part with edge cases
worth testing directly, without mounting a page.

### 2. One state, not three booleans

`ReviewPage` currently holds `page` and `inactive` as separate `useState`
(`src/pages/ReviewPage.tsx:42-44`) and reads them together at line 176
(`inactive || !page`). Adding a third boolean for the error case would make five
combinations for four real states.

Replace both with a single `ReviewPageLoad`-plus-loading union:

```tsx
const [load, setLoad] = useState<{ kind: 'loading' } | ReviewPageLoad>({ kind: 'loading' });
```

The impossible states (ready-without-a-page, inactive-and-error) stop being
representable.

### 3. An error screen that offers the retry

The paused screen keeps its exact copy — it is correct, it is just no longer
shown for failures. The new screen sits beside it, in the same card:

> **Something went wrong**
> That's on us, not you.
> [ Try again ]

Retry re-runs the fetch by bumping an `attempt` counter that is a dependency of
the load effect, and resets the state to `loading` so the skeleton shows while
it retries. No page reload — a reload would be a heavier hammer and would lose
nothing but also gain nothing.

The button carries visible text, so it needs no `aria-label`. The heading is the
card's `<h1>`, matching the paused and land screens.

This is the same shape as the two error affordances already in the file, which
both name the failure and leave the action in reach: `rateError` at
`src/pages/ReviewPage.tsx:238-246` and `submitError` at
`src/pages/ReviewPage.tsx:360-364`. The load path is the only one of the three
that lacked it.

## What is deliberately not in scope

- **The paused/unknown-slug merge in the function.** Correct as designed; see
  above.
- **Making the missing-config 500 loud at deploy time.** The outage's other
  half — nothing in CI asserts that `REVIEW_TOKEN_SECRET` and
  `REVIEW_IP_PEPPER` exist in a given environment — is real and worth fixing,
  but it is a separate change to a separate surface (CI / deploy checks), and
  bundling it here would make this diff two unrelated things.
- **The `rate` and `comment` paths.** They already distinguish failure from
  outcome (`src/pages/ReviewPage.tsx:115`, `:155`) and are untouched.

## Testing

**Unit — `tests/unit/reviewPageLoad.test.ts` (new).** The classifier's table:
resolved `error` → `error`; `data: null` → `error`; `{inactive: true}` →
`inactive`; a valid payload → `ready` with the page; `restaurant_name: ''` →
`ready` (the `?? ''` case, guarding against an over-strict validator); a payload
missing `headline`, and one with a non-numeric `threshold` → `error`.

**E2E — `tests/e2e/review-page-load.spec.ts` (new).** `review-public` is not
served in the e2e stack, so the page fetch is stubbed at the route, following
the pattern already established at `tests/e2e/review-stars.spec.ts:26-52`. Three
cases, no auth needed:

1. Function returns 500 → the error screen renders, **not** the paused screen;
   clicking *Try again* with the stub flipped to a good payload loads the page.
2. Function returns `{inactive: true}` → the paused screen still renders. This
   is the regression guard for the half of the behaviour that must not change.
3. Function returns a malformed 200 → the error screen renders.

Case 1 is the outage, reproduced: it fails on `main` and passes after the fix.
