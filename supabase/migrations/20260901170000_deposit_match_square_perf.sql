-- Deposit Match: index the Square adapter's date-range scan.
--
-- deposit_match_source_square (20260901150000_deposit_match_adapters.sql)
-- filters square_payments and square_refunds by (restaurant_id,
-- created_at). Both tables carry only a restaurant_id index today, so
-- every refresh scans the restaurant's full Square payment history and
-- detoasts raw_json for every row, not only the selected date window
-- (performance review, 2026-09-02). A composite index on
-- (restaurant_id, created_at) lets that adapter's range filter use an
-- index scan instead.

CREATE INDEX IF NOT EXISTS idx_square_payments_restaurant_created_at
  ON public.square_payments (restaurant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_square_refunds_restaurant_created_at
  ON public.square_refunds (restaurant_id, created_at);
