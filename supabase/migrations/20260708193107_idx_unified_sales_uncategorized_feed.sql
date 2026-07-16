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
