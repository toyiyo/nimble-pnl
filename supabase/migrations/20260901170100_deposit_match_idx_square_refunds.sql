-- Deposit Match: index the Square adapter's date-range scan on square_refunds.
--
-- Companion to 20260901170000_deposit_match_idx_square_payments.sql. Same
-- reasoning applies to square_refunds: the adapter filters it by
-- (restaurant_id, created_at), the table is a live-write target of the
-- Square webhook and sync functions, and CONCURRENTLY cannot run inside a
-- transaction, so this index gets its own migration file too.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_square_refunds_restaurant_created_at
  ON public.square_refunds (restaurant_id, created_at);
