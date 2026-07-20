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

- **Function boilerplate (mirror the totals RPC exactly):** `LANGUAGE
  plpgsql`, `SECURITY DEFINER`, `SET search_path = public` (pins schema
  resolution — the security control that stops a `SECURITY DEFINER` function
  from being hijacked via a mutable search_path), and mark it `STABLE` (pure
  read aggregate — a fresh function, so we fix the totals RPC's `VOLATILE`
  default here rather than propagate it). End with `GRANT EXECUTE ON FUNCTION
  public.get_unified_sales_grouped_by_item(UUID, DATE, DATE, TEXT, TEXT, TEXT,
  TEXT, TEXT) TO authenticated;`.
- **Auth:** the same `user_restaurants`/`auth.uid()` membership guard used by
  the totals RPC (required because `SECURITY DEFINER` bypasses `unified_sales`
  RLS). `RAISE EXCEPTION 'Access denied to restaurant'` on failure.
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
- **Aggregate:** `GROUP BY item_name`, and **COALESCE every SUM** to match
  the totals RPC — `COALESCE(SUM(us.total_price), 0)::NUMERIC AS
  total_revenue`, `COALESCE(SUM(us.quantity), 0)::NUMERIC AS total_quantity`,
  `COUNT(*)::BIGINT AS sale_count`. `total_price` is **nullable** (manual
  sales insert it optionally), so an all-NULL group would otherwise return
  NULL revenue — breaking the `RETURNS TABLE` numeric contract (blank/NaN
  client-side) and making `ORDER BY total_revenue` non-deterministic
  (NULLS FIRST/LAST flips by direction).
- **Sort:** whitelist via a **static `CASE` expression**, never dynamic SQL —
  `ORDER BY CASE p_sort_by WHEN 'revenue' THEN COALESCE(SUM(us.total_price),0)
  WHEN 'quantity' THEN COALESCE(SUM(us.quantity),0) WHEN 'sales' THEN
  COUNT(*) END <resolved dir>, item_name ASC` for numeric fields, with a
  parallel text branch for `name`. **Do NOT use `EXECUTE`/`format('... ORDER
  BY %I %s', ...)`** — the whole point is to keep sort injection-proof.
  `p_sort_direction` is likewise resolved to `ASC`/`DESC` via a `CASE`, not
  interpolated. `item_name ASC` is always the final tiebreak for determinism.
  Sorting the aggregate in SQL is what actually fixes bug #1.
- **Distinct item count** is bounded by menu size, but can exceed the
  CLAUDE.md 100-item virtualization threshold for large menus (modifiers,
  combos), so the RPC returns all groups (no pagination) and **the client
  virtualizes** the grouped grid (see §4).
- **Indexes:** the `restaurant_id = ... AND sale_date BETWEEN ...` predicate
  is served by `idx_unified_sales_restaurant_date (restaurant_id,
  sale_date)`. The `GROUP BY item_name` is a hash-aggregate over the already
  filtered rowset (not an index scan), and the `ILIKE '%term%'` search is
  non-sargable regardless — so `idx_unified_sales_item_name` is **not**
  relied upon. No new index required (same access path as the proven totals
  RPC). Follow-up only if slow-query logs show it: a
  `(restaurant_id, sale_date, item_name)` covering index for the GROUP BY,
  and `CREATE INDEX CONCURRENTLY idx_recipes_restaurant_pos_item_lower ON
  recipes (restaurant_id, LOWER(pos_item_name))` for the recipe-filter
  `EXISTS` correlated subquery.

### 2. New hook: `useUnifiedSalesGrouped`

Mirror `useUnifiedSalesTotals.tsx`: a plain `useQuery` that calls the RPC,
keyed on `[restaurantId, startDate, endDate, searchTerm,
categorizationFilter, recipeFilter, groupedSortBy, sortDirection]`,
`staleTime` 30s, **`refetchOnWindowFocus: true`** (aligned with
`useUnifiedSalesTotals` so the Grouped breakdown and the header "Collected at
POS" total refresh together on tab refocus and don't drift for a staleTime
window). Returns `{ groups, isLoading, error, refetch }`.

### 3. Sales-list auto-load (opt-in) in `useUnifiedSales`

The cap applies **only to the raw individual-row list**. Header totals and
the Grouped view are server-aggregated and always complete regardless of the
cap.

- Add option `autoLoadAll?: boolean` (default **false** — Index/Recipes keep
  single-page behavior, no dashboard regression).
- Internal constant `MAX_AUTO_ROWS = 20000` (generous safety valve covering a
  ~3-month window for typical restaurants; tunable).
- **Auto-load effect (retry-storm-safe).** When `autoLoadAll` is true, a
  `useEffect` calls `fetchNextPage()` only when **all** of:
  `hasNextPage && !isFetching && !error && !reachedCap && consecutiveFailures
  < MAX_AUTO_RETRIES`. Explicit dependency array: `[hasNextPage, isFetching,
  error, reachedCap, fetchNextPage]` (+ the failure counter). The `!error`
  gate is essential: on a failed page fetch React Query keeps `hasNextPage`
  at the last *successful* value (`true`), so without gating on `error` the
  effect would re-fire immediately in a tight loop hammering the RPC. Track
  `consecutiveFailures` (reset to 0 on any successful page, incremented in an
  error effect) and stop after `MAX_AUTO_RETRIES = 3`, surfacing the existing
  error toast rather than looping. React Query dedups in-flight calls.
- **Escape hatch (no dead end):** expose `reachedCap: boolean` and a
  `loadAllRemaining()` callback. `effectiveCap` starts at `MAX_AUTO_ROWS`;
  `loadAllRemaining()` sets an internal "uncapped" flag (`effectiveCap =
  Infinity`) so the auto-load effect resumes and drains the rest of the
  window. The flag resets whenever the query key changes (new date range /
  restaurant / filter), so an expensive uncapped load never silently persists
  across filters.
- **`reachedCap` must not flicker on stale placeholder data.** Because the
  hook keeps the previous filter's rows visible via `placeholderData` while a
  new query key loads, `flatSales.length` can momentarily reflect the *old*
  filter's (possibly at-cap) row count. Compute `reachedCap` with the same
  `canLoadMore`-style guard the hook already uses for `hasMore`
  (`hasNextPage && flatSales.length >= effectiveCap && !(isFetching &&
  !isFetchingNextPage)`), so the cap notice/"Load all" button never shows for
  a filter whose real fetch hasn't started.
- Keep returning `loading`/`isFetchingMore` for the inline progress state so
  the page can show a "Loading more…" affordance while auto-loading (see §4).
- Remove `hasMore`/`loadMoreSales` from the page's usage (the hook can keep
  them for backward-compat but the page stops rendering the button).

### 4. `POSSales.tsx` wiring

- Pass `autoLoadAll: true` to `useUnifiedSales`.
- **Cap notice — single location.** Remove all three "Load more" buttons. The
  cap notice + **"Load all rows"** button live in **exactly one** place: the
  Sales-list results header bar (the `selectedView === 'sales'` header that
  today shows "X of Y sales"). Not in the below-list footer, not in the
  Grouped header (Grouped is server-side and always complete). When
  `reachedCap`: a subtle *"Showing the first 20,000 rows in this range"*
  (`text-[13px] text-muted-foreground`) + a ghost **"Load all rows"** button
  wired to `loadAllRemaining()`. Wrap the notice in a container with
  `aria-live="polite"` so screen-reader users are told the list paused. At
  375px the header must wrap cleanly (stack notice under the count) rather
  than overflow.
- **Provisional-count affordance.** While the auto-load walk is still in
  flight (`isFetchingMore && !reachedCap`), show a subtle "Loading more…"
  (`text-[13px] text-muted-foreground`, same `aria-live` region) next to the
  "X of Y sales" count so a manager never mistakes a still-growing count for
  the final total. Data-accuracy is a first-class concern in this app.
- **Grouped view** renders `useUnifiedSalesGrouped()` instead of the local
  `groupedSales` memo (delete the memo). It must render **its own three
  states** keyed off the grouped hook, independent of the Sales-list
  `loading`: `isLoading → Skeleton`, `error → ErrorMessage`, `groups.length
  === 0 → "No items found"`, else the grid. Without this, when `loading`
  (Sales list) flips false while the grouped RPC is still fetching, the view
  would flash "No items found" over `groups === []`.
- **Virtualize the Grouped grid.** The grid was implicitly bounded by loaded
  pages; server aggregation returns the true distinct-item count, which can
  exceed the CLAUDE.md 100-item threshold. Virtualize with
  `@tanstack/react-virtual` using a **row-based virtualizer with a responsive
  lane/column count** (measure container width → 1 col < 640px, 2 cols
  < 1024px, 3 cols otherwise) so the existing multi-column card layout is
  preserved. Stable key = `item_name`.
- Fix the O(n²) `maxRevenue` recompute → compute once via `useMemo`, and use
  a **`reduce`-based max** (not `Math.max(...groups.map())`, which can blow
  the call-stack arg limit for very large group counts).
- **Sort control is view-aware:** when `selectedView === 'grouped'`, the
  dropdown offers **Revenue / Quantity / Sales / Name** (mapped to the RPC's
  `p_sort_by`); the Sales list keeps **Date / Name / Quantity / Amount**.
  Use a separate `groupedSortBy` state (default `revenue`) so switching views
  doesn't carry a nonsensical field. `sortDirection` is **intentionally
  shared** across both views (switching from Grouped "Name, desc" to the list
  carries "desc" onto `sortBy` — acceptable and expected).
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

- RPC access-denied → grouped hook surfaces error; Grouped view renders its
  own error branch (not the Sales-list error path).
- Empty window → RPC returns 0 rows → Grouped "No items found" empty state
  (only after `isLoading` is false — see §4).
- Auto-load page fetch fails → effect gated on `!error` + a
  `MAX_AUTO_RETRIES = 3` consecutive-failure stop → no retry storm; existing
  error toast surfaces.
- `reachedCap` → notice + "Load all rows" shown; guarded against stale
  placeholder so it doesn't flicker across filter changes; aggregates still
  correct.
- Restaurant switch mid-load → existing `placeholderData` guard drops other
  tenants' rows; auto-load effect keyed on restaurantId re-runs cleanly; the
  uncapped flag resets on the query-key change.
- Sort params sanitized server-side via static `CASE` whitelist — no SQL
  injection via `p_sort_by`/`p_sort_direction` (never string-interpolated).

## Testing

- **pgTAP** (`supabase/tests/`): seed a restaurant with multiple items,
  split parent/child rows, adjustment rows, categorized/uncategorized rows,
  recipe mappings, and **at least one row with NULL `total_price`** (assert
  its group's `total_revenue` is `0`, not NULL). Assert: grouping sums,
  `parent_sale_id IS NULL` exclusion, each categorization filter, each recipe
  filter (case-insensitive), each sort field + direction with deterministic
  `item_name` tiebreak, and the auth guard (`throws_ok` for a non-member).
- **Unit** (`tests/unit/`):
  - `useUnifiedSalesGrouped` — mocks `supabase.rpc`, asserts params mapping
    + return shape.
  - `useUnifiedSales` auto-load — asserts it advances pages while under cap,
    stops at `MAX_AUTO_ROWS` + sets `reachedCap`, that `loadAllRemaining()`
    resumes draining past the cap, that the uncap flag resets on query-key
    change, that a failed page fetch does **not** retry-storm (stops after
    `MAX_AUTO_RETRIES`, effect gated on `error`), and that `autoLoadAll:false`
    does **not** auto-advance (dashboard-safety regression test).
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
