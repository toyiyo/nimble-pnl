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
public endpoint from confirming which slugs exist (`index.ts:129`, the comment
above the branch says so). That merge is correct and stays. The merge this
design undoes is the client-side one, between *the function answered* and *the
function did not*.

Splitting error from inactive on the client leaks nothing the function hides:
an unknown slug and a paused page both stay on the 200 `{inactive: true}` path
(`index.ts:129-134`), and the new `error` classification is reachable only via a
4xx/5xx or an unreadable 200 — none of which vary with whether a slug exists.

Two premises worth pinning, because the fix depends on them:

- `supabase.functions.invoke()` **resolves** with `{ data, error }` in every
  failure mode. A 500 arrives as a resolved `error`, not a throw — which is why
  the current code catches it at all, and why the fix belongs in the same branch
  rather than in a `try`. Under the pinned SDK (`@supabase/functions-js` 2.4.6,
  via `@supabase/supabase-js@^2.57.4` at `package.json:89`) the whole `invoke()`
  body — including the `fetch` rejection path — sits inside one `try/catch` that
  returns `{ data: null, error }`, so transport failures resolve too. The entry
  in `memory/lessons.md` 2026-05-16 says `invoke()` "only rejects on transport
  failures"; that half is stale for this SDK version and should be corrected
  there separately.
- `restaurant_name` can be the empty string: the payload uses `?? ''` when the
  restaurant join comes back null
  (`supabase/functions/review-public/index.ts:141`). Under the current schema
  that fallback is unreachable — `review_pages.restaurant_id` is `NOT NULL` with
  `ON DELETE CASCADE` and `restaurants.name` is `NOT NULL` — so accepting `''`
  is defensive, not a live scenario. It stays in the validator and in the test
  table anyway: the cost is one line, and the failure it prevents is a live page
  rendering as an error.

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
> That's on us, not you. — *first failure*
> Still not working. Give it a minute and try again. — *second and later*
> [ Try again ]

Two audiences hit this screen: a guest at a table, who needs to know the tap
failed and it wasn't their fault, and the owner testing their own QR, who needs
to know this is **not** a page-configuration problem. Naming the failure as ours
serves both; the escalated line on repeat serves the owner during an outage like
the one that prompted this, where the same static copy on the fourth attempt
reads as a dead end. The register matches the page's existing voice
(`src/pages/ReviewPage.tsx:244`, `:388`) — the file's other error strings are
purely instructional (`:240`, `:362`), so this is a departure in shape, not in
tone, and is worth a second look at UI review.

Retry re-runs the fetch by bumping an `attempt` counter that is a dependency of
the load effect, and resets the state to `loading` so the skeleton shows while
it retries. No page reload — a reload would be a heavier hammer and would lose
nothing but also gain nothing.

**Retry mechanics.** No `disabled` prop is needed, because the button is not on
screen during the retry: the click resets the state to `loading`, which swaps the
whole card for the skeleton and unmounts the button with it. A second tap has
nothing to hit. That is stronger than disabling it, and it is why the escalated
copy — not a spinner on the button — is what tells a guest the retry ran. The
existing `cancelled` flag (`src/pages/ReviewPage.tsx:70`, `:75`, `:83-85`) covers
the in-flight response of a superseded attempt at the data layer.

A fast repeat failure therefore reads as error → skeleton → error rather than a
flicker the guest can drive, so no artificial minimum skeleton duration is
needed.

**Accessibility.** The load effect currently announces nothing: the `aria-live`
region at `src/pages/ReviewPage.tsx:216-218` lives inside the loaded state, and
the focus effect at `:88-90` deliberately skips `'land'` and never runs for the
early-return screens. A screen-reader guest who lands mid-fetch therefore hears
nothing when the skeleton resolves, and hears nothing again after tapping *Try
again*. This change fixes that for the screens it owns:

- Each terminal load screen (ready, inactive, error) sets the existing
  `announcement` state, so the polite region carries the outcome. The region
  moves out of the loaded-state JSX to the outermost wrapper so it is mounted in
  every state and a transition into it is actually announced.
- The error screen's `<h1>` takes `tabIndex={-1}` and receives focus on entry,
  the same idiom as `branchHeadingRef` at `:252-256`. Without it, focus lands on
  `<body>` when the retry button unmounts and the guest is dropped to the top of
  the document.
- The card gets a `<main>` wrapper. `/r/:slug` is a standalone route outside the
  authenticated layout's `<main>` (`src/App.tsx:112`, route at `:319-339`), so
  this page has never had a landmark in any state. It is one element on a render
  path this change is already rewriting.

**Styling.** *Try again* is the sole path forward, so it takes the primary-CTA
treatment already in the file (`src/pages/ReviewPage.tsx:366-373`:
`h-11 w-full rounded-lg bg-primary text-[15px] font-medium text-primary-foreground`),
not the ghost/underline idiom used for the opt-out at `:272-278`. Semantic tokens
throughout; the card reuses the `card` class at `:162` and the
`counter-display`/`counter-micro` typography. The button carries visible text, so
it needs no `aria-label`.

This is the same shape as the two error affordances already in the file, which
both name the failure and leave the action in reach: `rateError` at
`src/pages/ReviewPage.tsx:238-246` and `submitError` at
`src/pages/ReviewPage.tsx:360-364`. The load path is the only one of the three
that lacked it.

No interaction with the star write guard: the error and loading screens are
early returns that gate before any `stage`-based rendering, so a retry can only
happen before a rating has been committed and `committedRef` (`:67`) is
untouched.

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
- **Offering the feedback form and contact capture to promoters too.** Raised
  while this design was in review: today a 4★+ tap goes straight to the Google
  hand-off (`src/pages/ReviewPage.tsx:125-128`) with no way to say anything or
  leave contact details. That is a change to the funnel's branching and to the
  `rate`/`comment` contract, not to load-state handling — its own cycle.
- **Silent ratings being invisible in the inbox.** The inbox lists only rows
  with a comment (`src/hooks/useReviewResponses.ts:67`), so a 5★ tap with no
  written feedback appears in the header counters but never in the list. Also
  raised in review, also a separate surface.

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
4. Function returns 500 twice → the second render carries the escalated copy.

Case 1 is the outage, reproduced: it fails on `main` and passes after the fix.
