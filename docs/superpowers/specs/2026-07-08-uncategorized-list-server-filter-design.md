# Design: Server-side Status filter for the POS Sales list

Date: 2026-07-08
Branch: `fix/uncategorized-list-server-filter` (stacked on `fix/unified-sales-pagination-offset`)

## Problem

On the POS Sales page, the "Status" segmented control (All / Uncategorized /
Pending Review / Categorized) shows badge counts sourced from the SQL aggregate
RPC `get_unified_sales_totals` (full-table, correct), but the **list itself**
filters `categorizationFilter` **client-side over only the rows already loaded**
into memory (`useUnifiedSales`, `PAGE_SIZE = 500`, ordered `sale_date DESC`).

When the uncategorized rows are older than the most-recent page, the badge says
"200+" while the list shows ~0 — the reported bug.

### Confirmed against production

Restaurant `Wetzel's - Cold Stone - Alamo Ranch` (`7c0c76e3-…`):

| Metric | Value |
|---|---|
| Parent rows | 6,551 |
| Uncategorized (SQL) | 203 |
| Uncategorized within first 500-row page | **3** |
| Position range of uncategorized rows | 261 → 6,539 |

So ~200 uncategorized rows are unreachable in the loaded window. The sibling
branch `fix/unified-sales-pagination-offset` already repaired the broken
`getNextPageParam` cursor, but paginating through 6.5k rows client-side to reach
203 uncategorized ones is the wrong UX and still diverges from the badge until
everything is loaded.

## Goal

Selecting a Status tab must query the DB for exactly that set, so the list
matches the badge immediately. For "Uncategorized" (203 rows) this fits in the
first page — no pagination needed.

## Approach (chosen)

Push `categorizationFilter` into the `useUnifiedSales` PostgREST query as
additional chained filters, alongside the existing `ilike`/`gte`/`lte`.

### Predicate parity (the correctness contract)

The SQL RPC defines the source of truth. The nullable `is_categorized` column
means `IS NOT TRUE` = `false OR null`. The client JS uses `!sale.is_categorized`
(null → falsy). The PostgREST filters must match both. We use
`.not('is_categorized', 'is', true)` — which serialises to
`is_categorized=not.is.true` = `is_categorized IS NOT TRUE` — for **exact**
parity with the RPC in a single filter (handles `false` and `null` together),
rather than an `.or(...)` construction:

| Tab | RPC predicate | PostgREST filter |
|---|---|---|
| `uncategorized` | `is_categorized IS NOT TRUE AND suggested_category_id IS NULL` | `.not('is_categorized','is',true).is('suggested_category_id', null)` |
| `pending-review` | `is_categorized IS NOT TRUE AND suggested_category_id IS NOT NULL` | `.not('is_categorized','is',true).not('suggested_category_id','is',null)` |
| `categorized` | `is_categorized IS TRUE` | `.is('is_categorized', true)` |
| `all` | (no filter) | (no filter) |

Each chained top-level filter becomes its own query-string parameter and
PostgREST ANDs across them — the same composition the codebase already relies on
(`src/hooks/useConsumptionIntelligence.tsx:106-107`,
`src/hooks/useMonthlyMetrics.tsx:239-240`). RPC source:
`supabase/migrations/20260523000000_unified_sales_totals_categorization_counts.sql:91,95`.

### Performance / indexing (measured, in scope)

`EXPLAIN (ANALYZE, BUFFERS)` on the confirmed prod restaurant for the
`uncategorized` feed (`ORDER BY sale_date DESC, created_at DESC, id DESC LIMIT
500`) shows an **Index Scan Backward on `idx_unified_sales_restaurant_date`**
with **6,630 Rows Removed by Filter, 3,591 buffer hits, 28.5 ms** — effectively a
full per-restaurant partition scan, because uncategorized rows are the *oldest*
while the sort wants newest-first. Table is **145k rows / 535 MB** and actively
written by Toast sync.

- `categorized` and `all` feeds are fine as-is: the newest rows are categorized,
  so `LIMIT 500` short-circuits on `idx_unified_sales_restaurant_date`.
- `pending-review` is tiny (single/double-digit rows) and already has a partial
  index on its `WHERE` (`idx_unified_sales_ai_suggestions`).
- Only the **uncategorized** feed needs a new index. Add one partial index that
  mirrors the predicate exactly and carries the sort keys, built
  `CONCURRENTLY` in its own migration file (repo precedent:
  `20260626120100_idx_shifts_coverage.sql`):

  ```sql
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_unified_sales_uncategorized_feed
    ON public.unified_sales (restaurant_id, sale_date DESC, created_at DESC, id DESC)
    WHERE is_categorized IS NOT TRUE AND suggested_category_id IS NULL;
  ```

### Changes

1. `src/hooks/useUnifiedSales.tsx`
   - Add `categorizationFilter?: 'all' | 'uncategorized' | 'pending-review' | 'categorized'`
     to `UseUnifiedSalesOptions`.
   - Include it in `queryKey` so switching tabs uses a distinct cache entry.
   - Apply the filter chain in `fetchUnifiedSalesPage` (default `'all'` → no-op).
   - Add `placeholderData: keepPreviousData` to the `useInfiniteQuery` so
     switching tabs keeps the prior rows visible during the refetch instead of
     blanking to the full-page "Loading sales…" spinner (addresses the
     tab-switch latency regression from moving the filter server-side).

2. `src/pages/POSSales.tsx`
   - Pass `categorizationFilter` into the `useUnifiedSales(...)` options object.
   - Keep the existing client-side filter (lines 292-298) untouched — it becomes
     a redundant, harmless pass (mirrors how `searchTerm` is already both a
     server `ilike` and a client filter). This preserves combined
     recipe/search filtering and avoids destabilizing the render path.
   - **Empty state:** make the copy tab-aware. When a Status tab legitimately
     returns 0 rows, "No uncategorized sales" / "Everything in this date range
     has been reviewed." is a success state, not a "loosen your filters" state
     (current copy at lines 1213-1215 is misleading for this case).
   - **Results header:** when `categorizationFilter !== 'all'`, name the active
     status in the count text (e.g. "203 uncategorized sales") so the header
     still signals that a filter is narrowing the view (lines 1163-1170).

3. New migration `supabase/migrations/<ts>_idx_unified_sales_uncategorized_feed.sql`
   (see SQL above).

4. Tests (`tests/unit/useUnifiedSales.categorization.test.ts`)
   - Assert the exact PostgREST filter calls emitted per tab value (pin the
     `(column, operator, value)` args, not just that the method was called).
   - Assert `all` emits none of them (backward-compatible for the other three
     consumers — `POSSaleDialog`, `Index`, `Recipes` — which never pass it).
   - Assert `queryKey` distinguishes filter values.

## Non-goals

- No RLS or RPC changes. `get_unified_sales_totals` is already correct and stays
  the badge source. RLS confirmed unaffected: the added filters only narrow the
  client-requested set; the `restaurant_id` RLS `USING` clause is ANDed
  independently and cannot be widened.
- Not removing the client-side filter (deliberate — see above).
- Recipe filter stays client-side (unchanged); out of scope.
- Not pruning the pre-existing redundant `unified_sales` indexes
  (`idx_unified_sales_restaurant_id`, the duplicate `..._restaurant_date`) —
  noted for a follow-up, out of scope here.
- `dashboardMetrics` / badge counts (`useUnifiedSalesTotals`) are verified
  decoupled: their `queryKey` excludes `categorizationFilter`, so they neither
  refetch nor flicker on tab switch.

## Risks / edge cases

- **Predicate drift**: if the RPC predicate ever changes, these filters must
  change in lockstep. Mitigated by a test table mirroring the RPC and a code
  comment cross-referencing the RPC migration.
- **`child` splits**: the query does not filter `parent_sale_id`; children are
  excluded client-side (line 273) and the RPC counts only `parent_sale_id IS
  NULL`. A child split is never uncategorized-relevant in the badge. Left as-is;
  the redundant client filter still drops children from the visible list.

  **Categorized-tab angle (reviewed 2026-07-08, decision: keep as-is).** A
  Phase-7 reviewer (Codex) noted that on the `categorized` tab,
  `is_categorized=true` child-split rows are returned by the server query and
  consume page slots before the client filter drops them, so the *visible* row
  count can trail the badge for split-heavy restaurants. We deliberately do
  **not** add `.is('parent_sale_id', null)` to the categorization filter,
  because it would be a **net regression**: `split_pos_sale`
  (`supabase/migrations/20251122170000_fix_split_pos_sale_cleanup.sql:79-122`)
  marks the split **parent** `is_split=true, is_categorized=true`, and
  `useUnifiedSales` builds each parent's `child_splits` from the children present
  **in the same fetched page** (`src/hooks/useUnifiedSales.tsx:162-166,207-218`).
  Excluding children server-side would therefore leave categorized split parents
  with empty `child_splits`, so they'd render as plain cards instead of
  `SplitSaleView` — losing the split breakdown. The count divergence is (a)
  pre-existing (children always consumed page slots when the filter was
  client-side), (b) cosmetic (visible-count parity, not data correctness), and
  (c) bounded to split-heavy restaurants on one tab. A fully-correct fix
  (exclude children from slot accounting while still co-loading them for visible
  parents) is a separate refactor, filed as a follow-up. **Accepted as-is.**
- **Filter-value injection**: values are static literals, no user input
  interpolated — safe.
- **Cache footprint**: `categorizationFilter` in `queryKey` multiplies cache
  entries (up to 4 tabs × date × search). With 500-row pages and `gcTime` 5 min,
  a user auditing all four tabs holds ~4 page-1 payloads resident — within
  budget, but noted.
- **keepPreviousData flicker**: on tab switch the placeholder briefly shows the
  previous tab's rows (further narrowed by the new client-side filter) for the
  ~30 ms until the server responds. Acceptable, and strictly better than a blank
  full-page spinner.

## Decided trade-offs

- Keeping the client-side categorization filter is intentional redundancy for
  safety and minimal churn, accepted despite the theoretical risk that it could
  mask a server/client predicate mismatch. The parity test table is the guard
  against that.
- Tab switch now costs a network refetch (first visit per tab per session)
  instead of an instant client recompute. Accepted: correctness (list matches
  badge) over false-instant UX. `keepPreviousData` removes the jarring blank so
  the perceived cost is minimal; subsequent visits within `staleTime` (60 s) are
  instant cache hits.
- Only the uncategorized feed gets a new index; pending-review/categorized/all
  are already served acceptably (measured). Keeps write-amplification on the hot
  table minimal.
