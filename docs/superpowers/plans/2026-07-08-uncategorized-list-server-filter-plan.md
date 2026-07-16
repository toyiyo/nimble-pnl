# Plan: Server-side Status filter for the POS Sales list

Design: docs/superpowers/specs/2026-07-08-uncategorized-list-server-filter-design.md
Branch: `fix/uncategorized-list-server-filter` (stacked on `fix/unified-sales-pagination-offset`)

Tasks are ordered; each is a small RED→GREEN→REFACTOR→COMMIT unit.

## Task 1 — Failing test: server-side categorization filters (RED)
`tests/unit/useUnifiedSales.categorization.test.ts`, extending the existing
`useUnifiedSales.pagination.test.ts` mock-builder harness (add `is` to the mocked
builder methods; capture `.not`/`.is` calls as `[column, operator, value]`).
Assert, per option:
- `uncategorized` → `.not('is_categorized','is',true)` AND `.is('suggested_category_id', null)`.
- `pending-review` → `.not('is_categorized','is',true)` AND `.not('suggested_category_id','is',null)`.
- `categorized` → `.is('is_categorized', true)` (and no `suggested_category_id` predicate).
- `all` / omitted → none of the above filter calls emitted.
Depends on: nothing. (Test fails until Task 2.)

## Task 2 — Hook: add `categorizationFilter` option + filter chain (GREEN)
`src/hooks/useUnifiedSales.tsx`:
- Extend `UseUnifiedSalesOptions` with
  `categorizationFilter?: 'all' | 'uncategorized' | 'pending-review' | 'categorized'`.
- Normalise + add to `queryKey`.
- In `fetchUnifiedSalesPage`, apply the chain from the design's parity table
  before `.order(...)`. Add a code comment cross-referencing the RPC migration.
Depends on: Task 1.

## Task 3 — Hook: `keepPreviousData` for tab-switch UX (GREEN)
`src/hooks/useUnifiedSales.tsx`:
- Import `keepPreviousData` from `@tanstack/react-query`; set
  `placeholderData: keepPreviousData` on the `useInfiniteQuery`.
- Test: switching the `categorizationFilter` arg keeps `result.current.sales`
  non-empty (previous rows) during the pending refetch rather than dropping to
  `loading`/empty.
Depends on: Task 2.

## Task 4 — Wire the page (GREEN)
`src/pages/POSSales.tsx`:
- Pass `categorizationFilter` into the `useUnifiedSales(...)` options (lines
  ~131-135). Leave the existing client-side filter intact.
Depends on: Task 2.

## Task 5 — Tab-aware empty state + results header (GREEN)
`src/pages/POSSales.tsx`:
- Empty state (lines ~1209-1216): when `categorizationFilter !== 'all'` and no
  search term, show success-oriented copy ("No {label} sales" / "Everything in
  this date range has been reviewed."); keep generic copy otherwise.
- Results header (lines ~1163-1170): when `categorizationFilter !== 'all'`,
  include the status label in the count text.
Depends on: Task 4.

## Task 6 — Migration: partial index for the uncategorized feed
`supabase/migrations/<ts>_idx_unified_sales_uncategorized_feed.sql`:
```sql
-- Serves the POS Sales "Uncategorized" tab feed (server-side filter in
-- useUnifiedSales): WHERE is_categorized IS NOT TRUE AND suggested_category_id
-- IS NULL, ORDER BY sale_date DESC, created_at DESC, id DESC, LIMIT 500.
-- Uncategorized rows are the oldest, so a newest-first scan of
-- idx_unified_sales_restaurant_date reads the whole restaurant partition
-- (measured: 6.6k rows filtered, ~28ms) — this partial index makes it a bounded
-- scan of just the matching rows. Mirrors the get_unified_sales_totals predicate
-- (20260523000000). CONCURRENTLY cannot run inside a transaction, so this lives
-- in its own migration file.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_unified_sales_uncategorized_feed
  ON public.unified_sales (restaurant_id, sale_date DESC, created_at DESC, id DESC)
  WHERE is_categorized IS NOT TRUE AND suggested_category_id IS NULL;
```
Depends on: nothing (independent; can land any time). No pgTAP needed (index
only, no function/logic); correctness is covered by the hook tests + the
existing totals tests.

## Task 7 — Verify
- `npm run test -- useUnifiedSales` (unit), `npm run typecheck`, `npm run lint`.
- Manual/preview: POS Sales → Uncategorized tab shows rows matching the badge.
- Post-merge (noted for retrospective): re-run the prod `EXPLAIN ANALYZE` to
  confirm the new index is used and buffers/time drop.

## Out of scope / follow-ups
- Pruning redundant pre-existing `unified_sales` indexes.
- Exposing `isFetching` for a dedicated "refreshing" indicator.
