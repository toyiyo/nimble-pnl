-- supabase: no-transaction
-- CONCURRENTLY cannot run inside a transaction. No BEGIN in this file.
--
-- Performance review finding on 20260830130000: the linkable_pairs CTE
-- in auto_link_pending_outflows_internal runs
--   EXISTS (SELECT 1 FROM journal_entries je
--           WHERE je.reference_type = 'bank_transaction'
--             AND je.reference_id = up.bank_transaction_id
--             AND je.restaurant_id = p_restaurant_id)
-- for every unique candidate pair, before LIMIT p_batch_limit applies.
-- journal_entries carries no index on (reference_type, reference_id), so
-- each lookup falls back to a restaurant-scoped scan. The same
-- reference_type/reference_id lookup pattern already exists at several
-- other call sites (20260209000000, 20260703090000, 20260709120000,
-- 20260804090300); this index speeds up all of them, not only the new
-- query.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_journal_entries_reference
  ON journal_entries (restaurant_id, reference_type, reference_id);
