-- Minimum entry day across a restaurant's bank transactions.
--
-- The opening-balance hook needs the earliest journal-entry day. The
-- minimum raw transaction_date does not give it. An anchor at
-- 2026-02-01 00:00Z keeps February 1. A later instant at
-- 2026-02-01 03:30Z takes January 31 in America/Chicago. The minimum
-- must range over the derived days, not the raw timestamps. This
-- function computes that minimum on the server. The client never
-- derives a day itself (PR #772 review, codex P1).
--
-- SECURITY INVOKER: RLS on bank_transactions limits the scan to
-- restaurants the caller can read. An unauthorized caller gets NULL,
-- not an error.

CREATE OR REPLACE FUNCTION public.min_bank_txn_entry_day(p_restaurant_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT MIN(public.bank_txn_entry_day(bt.transaction_date, r.timezone))
  FROM public.bank_transactions bt
  JOIN public.restaurants r ON r.id = bt.restaurant_id
  WHERE bt.restaurant_id = p_restaurant_id;
$$;

COMMENT ON FUNCTION public.min_bank_txn_entry_day(uuid) IS
  'Minimum bank_txn_entry_day across a restaurant''s bank transactions. NULL when the caller can read none.';

-- The opening-balance hook calls this through PostgREST.
GRANT EXECUTE ON FUNCTION public.min_bank_txn_entry_day(uuid) TO authenticated;
