-- supabase: no-transaction
-- CONCURRENTLY cannot run inside a transaction. No BEGIN in this file.
-- The Supabase preview runner refuses a second statement after a
-- CONCURRENTLY statement, so each index gets its own migration file
-- (precedent: 20260830100300).
--
-- Partial index for get_inventory_usage_by_day, branch 1: rows with
-- transaction_date set. Bounds the day column the function's date
-- range filters on.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_transactions_usage_date
  ON public.inventory_transactions (restaurant_id, transaction_date)
  WHERE transaction_type = 'usage'
    AND transaction_date IS NOT NULL;
