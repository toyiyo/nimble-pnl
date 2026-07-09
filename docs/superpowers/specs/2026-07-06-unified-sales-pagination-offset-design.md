# Design: Fix `useUnifiedSales` pagination offset (duplicate-page inflation)

**Date:** 2026-07-06
**Topic:** unified-sales-pagination-offset
**Type:** Bugfix (correctness — financial view)

## Problem

On `/pos-sales`, the **Grouped** view shows per-item revenue/quantity/sale-count
that far exceed reality. In the reported case the store's true revenue was
~$14,315 (shown correctly in the header cards), yet individual grouped items
displayed values like $31,458 — impossible for a single item. The inflation
grows every time the user clicks **Load more**, and the inflated `qty` and
`sales` numbers move in lockstep and land on round multiples of the real value.

## Root cause

`src/hooks/useUnifiedSales.tsx` paginates `unified_sales` with
`useInfiniteQuery`. The page fetcher uses `pageParam` **directly as the SQL row
offset**:

```js
const from = pageParam;
const to = pageParam + PAGE_SIZE - 1;
// ...
.range(from, to);
return { sales: salesWithSplits, hasMore: (data?.length ?? 0) === PAGE_SIZE };
```

But `getNextPageParam` reads a field the page never returns:

```js
getNextPageParam: (lastPage) => (lastPage?.hasMore ? (lastPage?.nextPage || 0) : undefined),
```

`lastPage.nextPage` is `undefined`, so `nextPage || 0` is always **`0`**. Every
`fetchNextPage()` therefore re-requests rows `0–499` — the same first page — and
`useInfiniteQuery` appends it as a new page. `flatSales` flattens all pages
(`data.pages.flatMap(...)`), so after N "Load more" clicks the list holds N
copies of the first 500 rows.

The Grouped view aggregates that duplicated list client-side
(`POSSales.tsx` `groupedSales`), summing `total_revenue`, `total_quantity`, and
`sale_count`. Each duplicate copy inflates all three in lockstep → the observed
symptom. The header total cards are unaffected because they come from a separate
server-side aggregation hook (`useUnifiedSalesTotals`), which is why the header
is correct while the grouped cards are not — the exact discrepancy reported.

## Fix

Derive the next offset from the number of pages already loaded, so it advances
`PAGE_SIZE` per page and stops when a short page returns:

```js
getNextPageParam: (lastPage: any, allPages: any[]) =>
  lastPage?.hasMore ? allPages.length * PAGE_SIZE : undefined,
```

- After page 1 (offset 0): `allPages.length === 1` → next offset `500`.
- After page 2 (offset 500): `allPages.length === 2` → next offset `1000`.
- `hasMore` is `data.length === PAGE_SIZE`, so a final short page (including an
  empty page) ends paging.

No change to the fetcher's return shape; `nextPage` is removed from the mental
model entirely (it never existed on the object).

**Invariant relied upon:** `allPages.length * PAGE_SIZE` is correct only because
React Query fetches infinite-query pages **sequentially, in order** — never page
N+1 before page N settles. This is guaranteed by TanStack Query's infinite-query
design, and the hook already disables `refetchOnMount/WindowFocus/Reconnect`, so
no background refetch races a `fetchNextPage()`. We depend on that invariant
rather than an explicit server cursor.

**Determinism tiebreaker (folded in from Supabase design review).** The query
currently orders by `sale_date DESC, created_at DESC` — no unique final
tiebreaker. Under OFFSET pagination (`.range(from, to)`), rows tying on **both**
columns have an unspecified relative order that Postgres may return differently
across two separate `.range()` calls, allowing a rare row skip/duplication at a
page boundary — which would corrupt Grouped totals in the same way as the bug
we're fixing. Add `.order('id', { ascending: false })` as a final tiebreaker to
make the sort fully deterministic. (Full keyset/seek pagination on
`(sale_date, created_at, id)` — which also avoids OFFSET's O(offset) re-scan cost
when paging deep into history — is a larger change left as a future option.)

**No interaction with virtualizer or child-split reconstruction.** The
`salesVirtualizer` in `POSSales.tsx` is keyed off `dateFilteredSales.length`
(derived from the hook's `flatSales`) with stable `key={sale.id}`; once duplicate
pages stop appending, it simply sees a smaller `count`. The cross-page
`childrenByParent` reduction in `flatSales` already scans the full flattened list
regardless of page boundaries, so it is unaffected. Both are fixed transitively;
neither needs a code change.

## Testing

There is no existing unit test for this hook's pagination (only
`useUnifiedSalesTotals` is tested). This is precisely the
[2026-05-03 lesson](../../../memory/lessons.md) trap — *"tests existed for the
math but not for the contract."* Add a contract test
(`tests/unit/useUnifiedSales.pagination.test.ts`):

1. Mock the Supabase query builder so `.range(from, to)` returns a **distinct,
   non-overlapping** slice of rows per offset (unique IDs per page).
2. Render the hook via `renderHook`, wait for the first page, call
   `loadMoreSales()`.
3. Assert:
   - The second fetch requested offset **`PAGE_SIZE` (500)**, not `0`.
   - `sales` contains **no duplicate `id`s** across pages.
   - `sales.length` equals the sum of the two distinct page sizes.
4. **Short-first-page case (common path):** mock the first page to return fewer
   than `PAGE_SIZE` rows (e.g. 12). Assert `hasMore` is `false`, so the
   `POSSales.tsx` "Load more" buttons (three of them, all gated on `hasMore`)
   never render — no dead-end button for the majority of restaurants that have
   under 500 sales rows.

The "requested offset" assertion is the regression guard: it fails on the
current `|| 0` behavior and passes with the fix. The tiebreaker is verified
implicitly by asserting the `.order` chain includes an `id` ordering call.

## Scope / decided trade-offs

- **In scope:** the pagination-offset fix, the `id` sort tiebreaker, and their
  regression test.
- **Out of scope (follow-up):** the Grouped view aggregates only the pages
  currently loaded, so its totals are *partial* until the user pages through the
  entire range. Making Grouped totals complete-and-accurate regardless of paging
  would require a server-side group-by RPC (mirroring `useUnifiedSalesTotals`).
  That is a larger enhancement and is intentionally deferred — the reported bug
  is the duplication/inflation, which this fix resolves. Noted here so the
  follow-up isn't lost. Constraints for that future RPC, captured now so it
  isn't re-derived (from Supabase design review):
  - Mirror `get_unified_sales_totals`: `SECURITY DEFINER`, `SET search_path =
    public` pinned, marked `STABLE`.
  - Because `SECURITY DEFINER` bypasses RLS, do an explicit `restaurant_id` +
    caller-membership check inside the function body.
  - `GROUP BY item_name` filtered by `restaurant_id`/`sale_date` is a `HashAgg`
    over the restaurant's date-filtered rows — covered by
    `idx_unified_sales_restaurant_date` for the scan, but `item_name` grouping
    is not separately indexed; fine at current scale, not "free."

## Rollout note

After deploy, Grouped totals will **drop** immediately (the duplicate copies of
page 1 vanish), then grow back as a user pages through with "Load more." A
support report of "the numbers went down!" on day one is expected behavior, not
a regression — call this out in the PR description / release note.

## Verification

`npm run test` (targeted + full), `npm run typecheck`, `npm run lint`,
`npm run build`, then the standard Phase 7–9 review/CI pipeline.
