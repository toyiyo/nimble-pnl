-- supabase: no-transaction
-- CONCURRENTLY cannot run inside a transaction. No BEGIN in this file.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_transactions_auto_link
  ON bank_transactions (restaurant_id, amount, transaction_date)
  WHERE is_categorized = false
    AND is_split = false
    AND is_transfer = false
    AND excluded_reason IS NULL
    AND is_reconciled = false;
