-- Partial index on pending_outflows.category_id.
--
-- Aggregation reads (expenseDataFetcher, useMonthlyMetrics, useExpenseHealth)
-- already join chart_of_accounts via category_id. Historically most rows are
-- NULL; with the optional category picker on check creation, a meaningful
-- fraction will now be populated. The partial index keeps cost down by only
-- indexing the populated rows.

CREATE INDEX IF NOT EXISTS idx_pending_outflows_category
  ON public.pending_outflows(category_id)
  WHERE category_id IS NOT NULL;

COMMENT ON INDEX public.idx_pending_outflows_category IS
  'Partial index supporting category-keyed reads on pending_outflows. Excludes NULL category_id rows (the historical majority).';
