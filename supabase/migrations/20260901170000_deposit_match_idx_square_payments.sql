-- Deposit Match: index the Square adapter's date-range scan on square_payments.
--
-- deposit_match_source_square (20260901150000_deposit_match_adapters.sql)
-- filters square_payments by (restaurant_id, created_at). The table carries
-- only a restaurant_id index today, so every refresh scans the restaurant's
-- full Square payment history and detoasts raw_json for every row, not only
-- the selected date window. A composite index on (restaurant_id, created_at)
-- lets that adapter's range filter use an index scan instead.
--
-- CONCURRENTLY cannot run inside a transaction, so this lives in its own
-- migration file containing only this statement. square_payments is a
-- live-write target of the Square webhook and sync functions; a plain
-- CREATE INDEX would hold a SHARE lock for the full build and block those
-- writers, so this uses CONCURRENTLY instead.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_square_payments_restaurant_created_at
  ON public.square_payments (restaurant_id, created_at);
