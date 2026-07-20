# POS Sales — Server-side Grouping/Sort + Remove "Load more"

**Date:** 2026-07-19
**Branch:** `fix/pos-grouped-sort-db`
**Author:** Jose (via /dev)

## Problem

On the POS Sales page (`/pos-sales`, actively used in production — confirmed
via PostHog replays), two related defects:

1. **Grouped view sort is broken.** `POSSales.tsx` builds `groupedSales`
   (line ~395) by iterating the already-sorted `filteredSales` into a `Map`.
   A `Map` preserves *insertion order*, so groups appear in the order each
   item **first appears** in the individually-sorted list — never sorted by
   the group aggregate. Selecting "sort by Amount/Quantity" in Grouped view
   does nothing meaningful.

2. **Grouped totals + sort are computed over partial data.** Both the Sales
   list and the Grouped view aggregate `flatSales`, which is only the
   client-loaded pages of an infinite query (`PAGE_SIZE = 500`). A busy
   restaurant exceeds one page within the default 30-day window, so unless
   the user keeps clicking **"Load more"**, group totals are summed over an
   incomplete dataset. This is the same class of bug as PR #594 (the
   duplicate-page accumulation that inflated per-item revenue) — aggregating
   a client-side, pagination-dependent list is inherently fragile.

The header total cards are already correct because they come from a separate
server-aggregated RPC (`get_unified_sales_totals`). The fix is to give the
Grouped view the same treatment, and to remove the "Load more" affordance in
favor of auto-loading the bounded date window.

## Goals

- Grouped view is **accurate** (aggregates every row in the date window,
  server-side) and **correctly sorted** (sort applied in SQL over the full
  aggregate).
- Remove the manual **"Load more"** button. The Sales list auto-loads all
  rows in the selected date window, with a safety cap + notice to prevent
  unbounded pulls.
- No regression to the dashboard (`Index.tsx`) / `Recipes.tsx`, which reuse
  `useUnifiedSales` only for `unmappedItems`.

## Non-goals

- Changing the default date window (stays 30 days — already a sensible
  filter; the server query already applies `sale_date` bounds).
- Redesigning the Grouped card layout or the categorization workflow.
- Fixing the `unmappedItems` single-page limitation on Index/Recipes
  (pre-existing; out of scope, must not be made worse).

## Design

### 1. New SQL RPC: `get_unified_sales_grouped_by_item`

Mirror the structure, auth check, and filter parity of
`get_unified_sales_totals`
(`supabase/migrations/20260523000000_...sql`).

```
get_unified_sales_grouped_by_item(
  p_restaurant_id        UUID,
  p_start_date           DATE    DEFAULT NULL,
  p_end_date             DATE    DEFAULT NULL,
  p_search_term          TEXT    DEFAULT NULL,
  p_categorization_filter TEXT   DEFAULT 'all',   -- all|uncategorized|pending-review|categorized
  p_recipe_filter        TEXT    DEFAULT 'all',   -- all|with-recipe|without-recipe
  p_sort_by              TEXT    DEFAULT 'revenue', -- revenue|quantity|sales|name
  p_sort_direction       TEXT    DEFAULT 'desc'   -- asc|desc
)
RETURNS TABLE (
  item_name      TEXT,
  total_quantity NUMERIC,
  total_revenue  NUMERIC,
  sale_count     BIGINT
)
```

Semantics:

- **Auth:** `SECURITY DEFINER` + the same `user_restaurants`/`auth.uid()`
  guard used by the totals RPC. `RAISE EXCEPTION 'Access denied to
  restaurant'` on failure.
- **Row population:** `restaurant_id = p_restaurant_id AND parent_sale_id IS
  NULL` — **matches the totals RPC** so grouped revenue reconciles with the
  header "Collected at POS" total. (This is a deliberate correctness change:
  the old client memo included child-split rows, which double-counts split
  sales. Documented as a decided trade-off below.)
- **Filters (parity with the list query + totals RPC):**
  - date: `sale_date >= p_start_date` / `<= p_end_date` when non-null.
  - search: `item_name ILIKE '%' || p_search_term || '%'` when non-empty.
  - categorization (nullable-safe, `IS NOT TRUE` for false-or-null):
    - `uncategorized`  → `is_categorized IS NOT TRUE AND suggested_category_id IS NULL`
    - `pending-review` → `is_categorized IS NOT TRUE AND suggested_category_id IS NOT NULL`
    - `categorized`    → `is_categorized IS TRUE`
  - recipe (case-insensitive match on `recipes.pos_item_name`, mirroring
    `recipeMapping.ts`):
    - `with-recipe`    → `EXISTS (SELECT 1 FROM recipes r WHERE r.restaurant_id = p_restaurant_id AND LOWER(r.pos_item_name) = LOWER(us.item_name))`
    - `without-recipe` → `NOT EXISTS (...)`
- **Aggregate:** `GROUP BY item_name`, `SUM(quantity)`, `SUM(total_price)`,
  `COUNT(*)`.
- **Sort:** whitelist `p_sort_by`/`p_sort_direction` (reject arbitrary input
  → default), `ORDER BY <field> <dir>, item_name ASC` (deterministic
  tiebreak). Sorting the aggregate in SQL is what actually fixes bug #1.
- **Distinct item count** is naturally bounded by menu size (typically <
  few thousand), so the RPC returns all groups — no pagination.
- Uses existing indexes `idx_unified_sales_restaurant_date` +
  `idx_unified_sales_item_name`; no new index required (same as totals RPC).

### 2. New hook: `useUnifiedSalesGrouped`

Mirror `useUnifiedSalesTotals.tsx`: a plain `useQuery` that calls the RPC,
keyed on `[restaurantId, startDate, endDate, searchTerm,
categorizationFilter, recipeFilter, sortBy, sortDirection]`, `staleTime`
30–60s, `refetchOnWindowFocus: false`. Returns
`{ groups, isLoading, error, refetch }`.

### 3. Sales-list auto-load (opt-in) in `useUnifiedSales`

The cap applies **only to the raw individual-row list**. Header totals and
the Grouped view are server-aggregated and always complete regardless of the
cap.

- Add option `autoLoadAll?: boolean` (default **false** — Index/Recipes keep
  single-page behavior, no dashboard regression).
- Internal constant `MAX_AUTO_ROWS = 20000` (generous safety valve covering a
  ~3-month window for typical restaurants; tunable).
- When `autoLoadAll` is true: a `useEffect` calls `fetchNextPage()` whenever
  `hasNextPage && !isFetching && flatSales.length < effectiveCap`. React
  Query dedups; the existing `canLoadMore` guard (isFetching/placeholderData)
  is reused to avoid fetching at a stale offset.
- **Escape hatch (no dead end):** expose `reachedCap: boolean` = `hasNextPage
  && flatSales.length >= effectiveCap` and a `loadAllRemaining()` callback.
  `effectiveCap` starts at `MAX_AUTO_ROWS`; calling `loadAllRemaining()` sets
  an internal "uncapped" flag (`effectiveCap = Infinity`) so the auto-load
  effect resumes and drains the rest of the window. The flag resets whenever
  the query key changes (new date range / restaurant / filter), so an
  expensive uncapped load never silently persists across filters.
- Keep returning `loading`/`isFetchingMore` for the inline progress state.
- Remove `hasMore`/`loadMoreSales` from the page's usage (the hook can keep
  them for backward-compat but the page stops rendering the button).

### 4. `POSSales.tsx` wiring

- Pass `autoLoadAll: true` to `useUnifiedSales`.
- Replace the three "Load more" buttons with: nothing in the normal case;
  when `reachedCap`, a subtle notice — *"Showing the first 20,000 rows in
  this range"* — plus a **"Load all rows"** button wired to
  `loadAllRemaining()`. (semantic tokens, `text-[13px]
  text-muted-foreground`). The Grouped view and header totals remain accurate
  regardless of the cap (server-side).
- **Grouped view** now renders `useUnifiedSalesGrouped().groups` instead of
  the local `groupedSales` memo. Delete the memo. The per-group recipe
  link/"No Recipe" chip keeps using the client `recipeByItemName` map.
- Fix the O(n²) `maxRevenue = Math.max(...groupedSales.map(...))` recomputed
  per card → compute once via `useMemo`.
- **Sort control is view-aware:** when `selectedView === 'grouped'`, the
  dropdown offers **Revenue / Quantity / Sales / Name** (mapped to the RPC's
  `p_sort_by`); the Sales list keeps **Date / Name / Quantity / Amount**.
  Use a separate `groupedSortBy` state (default `revenue`) so switching views
  doesn't carry a nonsensical field. `sortDirection` is shared.
- Remove the now-unused `getSalesGroupedByItem` / `getSalesByDateRange`
  destructuring.

## Data flow

```
date/search/recipe/categorization/sort state (POSSales)
        │
        ├── useUnifiedSalesTotals ──► get_unified_sales_totals ──► header cards (accurate)
        ├── useUnifiedSalesGrouped ──► get_unified_sales_grouped_by_item ──► Grouped cards (accurate + sorted)
        └── useUnifiedSales(autoLoadAll) ──► paginated unified_sales, auto-advanced to cap ──► Sales list (virtualized)
```

## Error / edge handling

- RPC access-denied → hook surfaces error; page shows existing error path.
- Empty window → RPC returns 0 rows → Grouped "No items found" empty state.
- `reachedCap` → notice shown; aggregates still correct.
- Restaurant switch mid-load → existing `placeholderData` guard drops other
  tenants' rows; auto-load effect keyed on restaurantId re-runs cleanly.
- Sort params sanitized server-side (whitelist) — no SQL injection via
  `p_sort_by`/`p_sort_direction` (never string-interpolated raw).

## Testing

- **pgTAP** (`supabase/tests/`): seed a restaurant with multiple items,
  split parent/child rows, adjustment rows, categorized/uncategorized rows,
  and recipe mappings. Assert: grouping sums, `parent_sale_id IS NULL`
  exclusion, each categorization filter, each recipe filter, each sort
  field + direction with deterministic tiebreak, and the auth guard
  (`throws_ok` for a non-member).
- **Unit** (`tests/unit/`):
  - `useUnifiedSalesGrouped` — mocks `supabase.rpc`, asserts params mapping
    + return shape.
  - `useUnifiedSales` auto-load — asserts it advances pages while under cap,
    stops at `MAX_AUTO_ROWS` + sets `reachedCap`, that `loadAllRemaining()`
    resumes draining past the cap, that the uncap flag resets on query-key
    change, and that `autoLoadAll:false` does **not** auto-advance
    (dashboard-safety regression test).
- **Source-text test** for `POSSales.tsx` (per lessons #504): assert the
  "Load more" button text is gone and the grouped view no longer references
  the deleted local memo — avoids mocking ~30 hooks.

## Decided trade-offs

- **Grouped now excludes child-split rows** (`parent_sale_id IS NULL`),
  unlike the old client memo. This is intentional: it prevents double-count
  of split sales and makes grouped revenue reconcile with the header
  "Collected at POS" total. Net effect for non-split restaurants: none.
- **Sales list auto-loads to 20,000 rows** (with a "Load all rows" escape
  hatch) while Grouped/totals are unbounded. Acceptable: the list is for
  row-level review/categorization; all aggregates are server-side and
  accurate. The cap is a generous safety valve with an escape hatch, never a
  silent dead-end truncation.
- **No new index.** The RPC reuses the same access path as the proven totals
  RPC. If EXPLAIN shows a regression under load, a
  `(restaurant_id, sale_date, item_name)` covering index can be added later.
```
