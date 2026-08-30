-- Partial index for get_inventory_usage_by_day.
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction, so this
-- migration contains only this statement (precedent: 20260708193107).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_transactions_usage_date
  ON public.inventory_transactions (restaurant_id, transaction_date)
  WHERE transaction_type = 'usage';
