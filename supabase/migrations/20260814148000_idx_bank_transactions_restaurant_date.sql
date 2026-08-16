-- supabase: no-transaction
-- CONCURRENTLY cannot run inside a transaction. No BEGIN in this file.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_transactions_restaurant_date
  ON bank_transactions(restaurant_id, transaction_date);
