# Review Page Load States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the public review page from reporting an edge-function failure as "This link isn't active", and give the failure its own retryable screen.

**Architecture:** A pure classifier in `src/lib/reviews/reviewPageLoad.ts` turns the `{ data, error }` pair from `supabase.functions.invoke('review-public')` into one of three outcomes — `ready` / `inactive` / `error`. `ReviewPage` replaces its `page` + `loading` + `inactive` state trio with a single discriminated union and grows a third early-return screen. No server-side change.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Playwright, Tailwind + semantic tokens.

**Design doc:** `docs/superpowers/specs/2026-08-05-review-page-load-states-design.md` (commit `a86fa485`, revised after Phase 2.5 review).

## Global Constraints

- Semantic tokens only — no `bg-white`, `text-black`, or any literal colour. Existing screens use `text-foreground`, `text-muted-foreground`, `border-border`, `bg-card`, `bg-primary`, `text-primary-foreground`.
- The paused screen's copy must not change: heading `This link isn't active`, body `Ask the restaurant for a current one.` It is the regression guard for the half of the behaviour that stays.
- The error screen's copy is exactly: heading `Something went wrong`; body `That's on us, not you.` on the first failure and `Still not working. Give it a minute and try again.` on the second and later; button label `Try again`.
- `restaurant_name: ''` must classify as `ready`. A validator that rejects it would render a live page as an error.
- The `rate` and `comment` code paths (`src/pages/ReviewPage.tsx:97-160`) are untouched, including `committedRef`.
- No new dependency, no change to `supabase/functions/review-public/`.
- Pure logic lives in `src/lib`, not in `src/pages` — SonarCloud measures coverage on new code and the page is not a coverage-measured surface.

---

### Task 1: The load classifier

**Files:**
- Create: `src/lib/reviews/reviewPageLoad.ts`
- Test: `tests/unit/reviewPageLoad.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `PublicReviewPage` (interface), `ReviewPageLoad` (union type), `classifyReviewPageResponse(data: unknown, error: unknown): ReviewPageLoad`. Task 2 imports all three.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/reviewPageLoad.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyReviewPageResponse } from '@/lib/reviews/reviewPageLoad';

const VALID = {
  restaurant_name: 'Test Diner',
  headline: 'How was everything?',
  subheadline: null,
  logo_url: null,
  threshold: 4,
};

describe('classifyReviewPageResponse', () => {
  it('classifies a resolved error as error, whatever the data says', () => {
    expect(classifyReviewPageResponse(VALID, { message: 'boom' })).toEqual({ kind: 'error' });
    expect(classifyReviewPageResponse(null, { message: 'boom' })).toEqual({ kind: 'error' });
  });

  it('classifies a missing or non-object payload as error', () => {
    expect(classifyReviewPageResponse(null, null)).toEqual({ kind: 'error' });
    expect(classifyReviewPageResponse(undefined, null)).toEqual({ kind: 'error' });
    expect(classifyReviewPageResponse('nope', null)).toEqual({ kind: 'error' });
    expect(classifyReviewPageResponse([VALID], null)).toEqual({ kind: 'error' });
  });

  it('classifies the paused payload as inactive', () => {
    expect(classifyReviewPageResponse({ inactive: true }, null)).toEqual({ kind: 'inactive' });
  });

  it('classifies a valid payload as ready and carries it through', () => {
    expect(classifyReviewPageResponse(VALID, null)).toEqual({ kind: 'ready', page: VALID });
  });

  it('accepts an empty restaurant_name', () => {
    // The function emits `?? ''` when the restaurant join is null
    // (review-public/index.ts:141). Unreachable under the current NOT NULL
    // schema, but a validator that rejected it would render a live page as an
    // error — the exact failure this whole change exists to prevent.
    const page = { ...VALID, restaurant_name: '' };
    expect(classifyReviewPageResponse(page, null)).toEqual({ kind: 'ready', page });
  });

  it('accepts a populated subheadline and logo_url', () => {
    const page = { ...VALID, subheadline: 'It takes 10 seconds', logo_url: 'https://x/y.png' };
    expect(classifyReviewPageResponse(page, null)).toEqual({ kind: 'ready', page });
  });

  it('classifies a payload the page cannot render as error', () => {
    expect(classifyReviewPageResponse({ ...VALID, headline: undefined }, null)).toEqual({ kind: 'error' });
    expect(classifyReviewPageResponse({ ...VALID, restaurant_name: 7 }, null)).toEqual({ kind: 'error' });
    expect(classifyReviewPageResponse({ ...VALID, threshold: 'four' }, null)).toEqual({ kind: 'error' });
    expect(classifyReviewPageResponse({ ...VALID, threshold: 2.5 }, null)).toEqual({ kind: 'error' });
    expect(classifyReviewPageResponse({ ...VALID, threshold: 0 }, null)).toEqual({ kind: 'error' });
    expect(classifyReviewPageResponse({ ...VALID, threshold: 6 }, null)).toEqual({ kind: 'error' });
    expect(classifyReviewPageResponse({ ...VALID, subheadline: 12 }, null)).toEqual({ kind: 'error' });
  });

  it('ignores inactive when it is not exactly true', () => {
    // A payload carrying `inactive: false` alongside a real page is still a
    // page; a payload carrying only `inactive: false` is unreadable.
    expect(classifyReviewPageResponse({ ...VALID, inactive: false }, null)).toEqual({
      kind: 'ready',
      page: { ...VALID, inactive: false },
    });
    expect(classifyReviewPageResponse({ inactive: false }, null)).toEqual({ kind: 'error' });
  });
});
```

Note on the `inactive: false` + valid-page case: `classifyReviewPageResponse` returns the payload object it was handed, extra keys and all — it validates, it does not strip. The assertion spells that out so a later change to cloning behaviour is a deliberate decision, not a surprise.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/unit/reviewPageLoad.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/reviews/reviewPageLoad"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/reviews/reviewPageLoad.ts`:

```ts
/**
 * What `review-public`'s `page` action can tell the client, and how the client
 * should read it.
 *
 * These three outcomes used to be two. `ReviewPage` collapsed a resolved
 * `error`, a null payload and a genuinely paused page into one "this link
 * isn't active" screen, so when the function started failing on every call —
 * `REVIEW_TOKEN_SECRET` was never set in production — the page told the owner
 * the one thing that was demonstrably fine, and they spent the outage toggling
 * `is_active`. An infrastructure failure is not a domain state.
 */

export interface PublicReviewPage {
  restaurant_name: string;
  headline: string;
  subheadline: string | null;
  logo_url: string | null;
  threshold: number;
}

export type ReviewPageLoad =
  | { kind: 'ready'; page: PublicReviewPage }
  | { kind: 'inactive' }
  | { kind: 'error' };

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

/**
 * The payload has to be checked, not cast. The old code did `data as PublicPage`
 * and trusted it, so a 200 carrying something else rendered a card with
 * `undefined` in it and a star control wired to a threshold of `undefined`.
 * A response the client cannot read is a failure and should look like one.
 *
 * `restaurant_name` may be the empty string: the function emits `?? ''` when the
 * restaurant join comes back null (review-public/index.ts:141).
 */
function isPublicReviewPage(value: Record<string, unknown>): value is Record<string, unknown> &
  PublicReviewPage {
  return (
    typeof value.restaurant_name === 'string' &&
    typeof value.headline === 'string' &&
    isNullableString(value.subheadline) &&
    isNullableString(value.logo_url) &&
    typeof value.threshold === 'number' &&
    Number.isInteger(value.threshold) &&
    value.threshold >= 1 &&
    value.threshold <= 5
  );
}

/**
 * `supabase.functions.invoke()` resolves with `{ data, error }` in every failure
 * mode — under the pinned functions-js the whole call body, including the fetch
 * rejection path, sits inside one try/catch. So a 500 and a dropped connection
 * both arrive here as a truthy `error`, never as a throw.
 */
export function classifyReviewPageResponse(data: unknown, error: unknown): ReviewPageLoad {
  if (error) return { kind: 'error' };
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { kind: 'error' };

  const payload = data as Record<string, unknown>;
  if (payload.inactive === true) return { kind: 'inactive' };
  if (isPublicReviewPage(payload)) return { kind: 'ready', page: payload };
  return { kind: 'error' };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/unit/reviewPageLoad.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck and lint**

```bash
npm run typecheck && npx eslint src/lib/reviews/reviewPageLoad.ts tests/unit/reviewPageLoad.test.ts
```

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/reviews/reviewPageLoad.ts tests/unit/reviewPageLoad.test.ts
git commit -m "feat(reviews): classify the public page load into ready/inactive/error"
```

---

### Task 2: Rewire ReviewPage onto the union

**Files:**
- Modify: `src/pages/ReviewPage.tsx` (lines 20-26, 39-90, 162-189)
- Test: covered end-to-end by Task 3; no unit test — the page is not a coverage-measured surface and the logic it now holds is wiring.

**Interfaces:**
- Consumes: `PublicReviewPage`, `ReviewPageLoad`, `classifyReviewPageResponse` from Task 1.
- Produces: the DOM contract Task 3 asserts against — an `<h1>` reading `Something went wrong`, a button named `Try again`, and the unchanged `<h1>` reading `This link isn't active`.

- [ ] **Step 1: Replace the local payload interface with the shared one**

In `src/pages/ReviewPage.tsx`, delete the `PublicPage` interface at lines 20-26 and add to the import block (after the `supabase` import at line 13, per the project's import order — types come after hooks):

```tsx
import {
  classifyReviewPageResponse,
  type PublicReviewPage,
  type ReviewPageLoad,
} from '@/lib/reviews/reviewPageLoad';
```

The file imports named hooks from `react` with no default import, so `React.ReactNode` is not in scope. Widen line 1 to bring the type in:

```tsx
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
```

- [ ] **Step 2: Replace the three state slots with one union**

Replace lines 42-44:

```tsx
  const [page, setPage] = useState<PublicPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [inactive, setInactive] = useState(false);
```

with:

```tsx
  // One state, not three booleans. Four real outcomes across three booleans
  // left five representable combinations, and the render read two of them
  // together (`inactive || !page`) to recover the fourth.
  const [load, setLoad] = useState<{ kind: 'loading' } | ReviewPageLoad>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [failures, setFailures] = useState(0);
```

- [ ] **Step 3: Rewrite the load effect**

Replace lines 69-86:

```tsx
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.functions.invoke('review-public', {
        body: { action: 'page', slug },
      });
      if (cancelled) return;
      if (error || !data || data.inactive) {
        setInactive(true);
      } else {
        setPage(data as PublicPage);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);
```

with:

```tsx
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.functions.invoke('review-public', {
        body: { action: 'page', slug },
      });
      if (cancelled) return;
      const result = classifyReviewPageResponse(data, error);
      setLoad(result);
      if (result.kind === 'error') setFailures((count) => count + 1);
      // The polite region is the only thing a screen-reader guest gets when a
      // skeleton resolves — none of these screens takes focus on its own except
      // the error one, and a silent swap reads as nothing having happened.
      setAnnouncement(
        result.kind === 'ready'
          ? result.page.headline
          : result.kind === 'inactive'
            ? "This link isn't active."
            : 'Something went wrong loading this page.'
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, attempt]);
```

- [ ] **Step 4: Add the retry handler and the error-heading ref**

After the `committedRef` declaration at line 67, add:

```tsx
  const errorHeadingRef = useRef<HTMLHeadingElement | null>(null);
```

After the `handlePreview` callback (line 92-95), add:

```tsx
  const handleRetry = useCallback(() => {
    setLoad({ kind: 'loading' });
    setAttempt((count) => count + 1);
  }, []);
```

And after the `stage` focus effect at lines 88-90, add:

```tsx
  // Without this, focus sits on <body> the moment the retry button unmounts,
  // dropping the guest to the top of the document mid-interaction.
  useEffect(() => {
    if (load.kind === 'error') errorHeadingRef.current?.focus();
  }, [load.kind, attempt]);
```

- [ ] **Step 5: Rewrite the early-return screens**

Replace lines 164-189 (the `if (loading)` and `if (inactive || !page)` blocks) with:

```tsx
  // The live region has to be mounted in every state, not just the loaded one,
  // or the transition into a state is exactly what never gets announced.
  const shell = (children: ReactNode) => (
    <main className="theme-counter min-h-screen bg-background flex items-center justify-center p-4">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div className={card}>{children}</div>
    </main>
  );

  if (load.kind === 'loading') {
    return shell(
      <>
        <Skeleton className="mx-auto h-14 w-14 rounded-full" />
        <Skeleton className="mx-auto mt-4 h-5 w-40" />
        <Skeleton className="mx-auto mt-6 h-10 w-56" />
      </>
    );
  }

  if (load.kind === 'inactive') {
    return shell(
      <>
        <h1 className="counter-display text-[22px] font-semibold text-foreground text-center">
          This link isn&apos;t active
        </h1>
        <p className="counter-micro mt-3 text-[12px] text-muted-foreground text-center">
          Ask the restaurant for a current one.
        </p>
      </>
    );
  }

  if (load.kind === 'error') {
    return shell(
      <>
        <h1
          ref={errorHeadingRef}
          tabIndex={-1}
          className="counter-display text-[22px] font-semibold text-foreground text-center focus:outline-none"
        >
          Something went wrong
        </h1>
        <p className="counter-micro mt-3 text-[12px] text-muted-foreground text-center">
          {failures > 1
            ? 'Still not working. Give it a minute and try again.'
            : "That's on us, not you."}
        </p>
        <Button
          type="button"
          onClick={handleRetry}
          className="mt-6 h-11 w-full rounded-lg bg-primary text-[15px] font-medium text-primary-foreground"
        >
          Try again
        </Button>
      </>
    );
  }

  const page: PublicReviewPage = load.page;
```

- [ ] **Step 6: Wrap the loaded state in the same shell**

At line 191-193 the loaded state opens with its own `<div className="theme-counter …"><div className={card}>`. Change the outer `<div>` to `<main>` (and its closing tag at line 395), and delete the now-duplicated `aria-live` paragraph at lines 216-218 — `shell` does not wrap this branch, so the region must be moved into the `<main>` here rather than dropped:

```tsx
  return (
    <main className="theme-counter min-h-screen bg-background flex items-center justify-center p-4">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div className={card}>
```

The `<p aria-live>` previously sat between the logo block and the stage content; moving it to the top of `<main>` changes nothing visually (it is `sr-only`) and makes it present in all four states.

- [ ] **Step 7: Verify no reference to the removed state survives**

```bash
grep -n "setInactive\|setPage\|setLoading\|PublicPage\b" src/pages/ReviewPage.tsx
```

Expected: no output.

- [ ] **Step 8: Typecheck, lint, and run the existing review unit tests**

```bash
npm run typecheck && npx eslint src/pages/ReviewPage.tsx && npx vitest run tests/unit/reviewPageLoad.test.ts tests/unit/useReviewPages.test.ts tests/unit/useReviewResponses.test.ts
```

Expected: all clean and passing.

- [ ] **Step 9: Commit**

```bash
git add src/pages/ReviewPage.tsx
git commit -m "fix(reviews): stop reporting a load failure as a paused page"
```

---

### Task 3: E2E coverage for the three load outcomes

**Files:**
- Create: `tests/e2e/review-page-load.spec.ts`

**Interfaces:**
- Consumes: the DOM contract from Task 2 (headings `Something went wrong` / `This link isn't active`, button `Try again`).
- Produces: nothing downstream.

This is the Phase 8 E2E hard-gate for a user-facing page change. `review-public` is not served in the e2e stack, so every case stubs the route — the pattern at `tests/e2e/review-stars.spec.ts:26-52`. No auth: the page is public.

- [ ] **Step 1: Write the spec**

Create `tests/e2e/review-page-load.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

/**
 * E2E: what the public review page says when it cannot load.
 *
 * The page used to render "This link isn't active" for an edge-function
 * failure as well as for a genuinely paused page. When `review-public` started
 * returning 500 on every call in production, that message sent the restaurant
 * owner to the `is_active` toggle on a page that was already live. The first
 * test here is that outage: it fails on the old code and passes on the new.
 *
 * The edge function is not served in the e2e stack, so `review-public` is
 * stubbed at the route.
 */

const FN_GLOB = '**/functions/v1/review-public';

const LIVE_PAGE = {
  restaurant_name: 'Test Diner',
  headline: 'How was everything?',
  subheadline: null,
  logo_url: null,
  threshold: 4,
};

test.describe('public review page load states', () => {
  test('a 500 shows the error screen, not the paused screen, and Try again recovers', async ({
    page,
  }) => {
    let failNext = true;

    await page.route(FN_GLOB, async (route) => {
      if (failNext) {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Something went wrong.' }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(LIVE_PAGE),
      });
    });

    await page.goto('/r/table-tents');

    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible({
      timeout: 10000,
    });
    // The whole point: an infrastructure failure must not claim the page is paused.
    await expect(page.getByText("This link isn't active")).toHaveCount(0);

    failNext = false;
    await page.getByRole('button', { name: 'Try again' }).click();

    await expect(page.getByRole('heading', { name: 'How was everything?' })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: /rate your visit/i })).toBeVisible();
  });

  test('a second failure escalates the copy', async ({ page }) => {
    await page.route(FN_GLOB, async (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Something went wrong.' }),
      })
    );

    await page.goto('/r/table-tents');

    await expect(page.getByText("That's on us, not you.")).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'Try again' }).click();

    await expect(page.getByText('Still not working. Give it a minute and try again.')).toBeVisible();
  });

  test('a paused page still shows the paused screen', async ({ page }) => {
    await page.route(FN_GLOB, async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ inactive: true }),
      })
    );

    await page.goto('/r/table-tents');

    // The regression guard for the half of the behaviour that must not change.
    await expect(page.getByRole('heading', { name: "This link isn't active" })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
  });

  test('a 200 the client cannot read shows the error screen', async ({ page }) => {
    await page.route(FN_GLOB, async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ restaurant_name: 'Test Diner' }),
      })
    );

    await page.goto('/r/table-tents');

    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible({
      timeout: 10000,
    });
  });
});
```

- [ ] **Step 2: Run the new spec**

```bash
npx playwright test tests/e2e/review-page-load.spec.ts --reporter=line
```

Expected: 4 passed. Run in the foreground and let the Bash tool's `timeout` bound it — no poll loop.

- [ ] **Step 3: Run the sibling review specs for regressions**

```bash
npx playwright test tests/e2e/review-stars.spec.ts tests/e2e/review-funnel.spec.ts --reporter=line
```

Expected: all passing. `review-stars.spec.ts` exercises the same page through the loaded state and is the check that the `shell`/`<main>` restructure did not move anything the star control depends on.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/review-page-load.spec.ts
git commit -m "test(reviews): cover the public page's three load outcomes end to end"
```

---

## Verification

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run test` — full unit suite
- [ ] `npx playwright test tests/e2e/review-page-load.spec.ts tests/e2e/review-stars.spec.ts tests/e2e/review-funnel.spec.ts --reporter=line`
- [ ] Manual: `npm run dev`, visit `/r/<a real local slug>` with the local edge function stopped — expect the error screen and a working *Try again*, not the paused screen.
