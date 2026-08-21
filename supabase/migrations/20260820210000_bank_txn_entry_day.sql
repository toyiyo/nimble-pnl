-- One expression for the journal entry day of a bank transaction.
--
-- bank_transactions.transaction_date is timestamptz. journal_entries.entry_date
-- is date. Production holds three value populations (measured 2026-08-20):
-- 3,991 rows at exactly 00:00:00 UTC (date-only statement imports), 2,552 at
-- exactly 12:00:00 UTC (Stripe noon-anchored dates), and ~1,775 real instants.
-- A date-anchored value already names its calendar day; a local cast would
-- move it one day early. A real instant belongs to the restaurant-local day.
-- This function holds that branch. Every entry insert AND every closed-period
-- guard must call it — never write the cast twice (PR #766 lesson).
-- See docs/superpowers/specs/2026-08-20-journal-entry-date-timezone-design.md.

CREATE OR REPLACE FUNCTION public.bank_txn_entry_day(p_ts timestamptz, p_tz text)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_ts IS NULL THEN
    RETURN NULL;
  END IF;

  -- A time of exactly 00:00:00 or 12:00:00 UTC marks a date-only source
  -- value. Keep its UTC day. Misclassification window for a real instant:
  -- one second twice a day, and the result equals the old behavior.
  IF (p_ts AT TIME ZONE 'UTC')::time IN ('00:00:00', '12:00:00') THEN
    RETURN (p_ts AT TIME ZONE 'UTC')::date;
  END IF;

  BEGIN
    RETURN (p_ts AT TIME ZONE COALESCE(p_tz, 'America/Chicago'))::date;
  EXCEPTION WHEN invalid_parameter_value THEN
    -- Garbage timezone string: keep the UTC day (the old behavior). Do not
    -- probe pg_timezone_names per call — the subtransaction guard is ~100x
    -- cheaper and only a bad zone pays for it (check_timeoff_conflict lesson).
    RETURN (p_ts AT TIME ZONE 'UTC')::date;
  END;
END;
$$;

COMMENT ON FUNCTION public.bank_txn_entry_day(timestamptz, text) IS
  'Entry day for a bank transaction. Date anchors (00:00/12:00 UTC) keep the UTC day; real instants take the restaurant-local day.';

-- The opening-balance hook calls this through PostgREST.
GRANT EXECUTE ON FUNCTION public.bank_txn_entry_day(timestamptz, text) TO authenticated;
