-- supabase: no-transaction
-- CONCURRENTLY cannot run inside a transaction. No BEGIN in this file.
-- One index per file: see 20260830184218 for the reason.
--
-- Partial index for get_inventory_usage_by_day, branch 2: rows with
-- transaction_date NULL, where the function falls back to created_at
-- (UTC) for the day bucket and the date range filter.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_transactions_usage_created
  ON public.inventory_transactions (restaurant_id, created_at)
  WHERE transaction_type = 'usage' AND transaction_date IS NULL;
