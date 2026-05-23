-- Composite partial index on pending_outflows for tenant-scoped category reads.
--
-- All consumers (useMonthlyMetrics, useLaborCostsFromTransactions, useLiquidityMetrics,
-- usePendingOutflows, useTopVendors, useCOGSFromFinancials, expenseDataFetcher) lead
-- with `.eq('restaurant_id', ...)` then filter or aggregate by category_id. A
-- single-column index on category_id alone would rarely be chosen by the planner
-- because restaurant_id narrows the rowset first. The composite (restaurant_id,
-- category_id) lets the planner satisfy both predicates from one index scan.
--
-- Historically most rows have NULL category_id; the partial WHERE clause keeps
-- the index small by only covering rows the new picker will populate.

CREATE INDEX IF NOT EXISTS idx_pending_outflows_category
  ON public.pending_outflows(restaurant_id, category_id)
  WHERE category_id IS NOT NULL;

COMMENT ON INDEX public.idx_pending_outflows_category IS
  'Composite partial index supporting tenant-scoped category reads on pending_outflows. Covers (restaurant_id, category_id) for rows where category_id IS NOT NULL.';
