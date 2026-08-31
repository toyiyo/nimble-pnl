-- Partial indexes for get_inventory_usage_by_day, one per WHERE branch.
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction, so this
-- migration contains only these statements (precedent: 20260708193107).

-- Branch 1: rows with transaction_date set. Bounds the day column the
-- function's date range filters on.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_transactions_usage_date
  ON public.inventory_transactions (restaurant_id, transaction_date)
  WHERE transaction_type = 'usage';

-- Branch 2: rows with transaction_date NULL, where the function falls back
-- to created_at (UTC) for the day bucket and the date range filter.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_transactions_usage_created
  ON public.inventory_transactions (restaurant_id, created_at)
  WHERE transaction_type = 'usage' AND transaction_date IS NULL;
