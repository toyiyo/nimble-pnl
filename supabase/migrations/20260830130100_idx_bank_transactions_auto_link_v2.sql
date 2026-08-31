-- supabase: no-transaction
-- CONCURRENTLY cannot run inside a transaction. No BEGIN in this file.
--
-- CREATE INDEX CONCURRENTLY and DROP INDEX CONCURRENTLY cannot share a
-- migration file: the Supabase migration runner sends a file's
-- statements as one pipeline, and CONCURRENTLY refuses to run inside a
-- pipeline once it is not the pipeline's sole statement (SQLSTATE
-- 25001). The paired drop moves to 20260830130200 (see the comment
-- there, and 20260804090500 for the same rule stated at the drop
-- side).
--
-- Replaces idx_bank_transactions_auto_link (20260830100300) now that
-- auto_link_pending_outflows_internal (20260830130000) accepts
-- categorized transactions too. The predicate drops is_categorized =
-- false so the index covers both the uncategorized and the categorized
-- eligible rows, and adds amount < 0 to match the sign check in
-- eligible_transactions.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_transactions_auto_link_v2
  ON bank_transactions (restaurant_id, amount, transaction_date)
  WHERE amount < 0
    AND is_split = false
    AND is_transfer = false
    AND excluded_reason IS NULL
    AND is_reconciled = false;
