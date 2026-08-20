-- One-time re-date of existing bank journal entries to the restaurant-local
-- day.
--
-- Tasks 1-5 in this series make new journal entries use
-- bank_txn_entry_day(transaction_date, timezone): a date-anchored
-- transaction_date (00:00:00 or 12:00:00 UTC) keeps its UTC day; a real
-- instant takes the restaurant-local day. This migration moves the entries
-- that already exist so they follow the same rule.
--
-- Production expectation (measured 2026-08-20, read-only): 179 bank-entry
-- rows and 2 reclassification-entry rows move; 0 rows are skipped for a
-- closed period. These counts drift with the sync cron between the
-- measurement and the deploy — the two UPDATE statements below compute
-- their own row set at run time, so a drifted count is not a bug.
--
-- The two UPDATE statements are byte-identical to the ones proven in
-- supabase/tests/67_redate_bank_journal_entries.sql. Keep them in sync.
--
-- No call to rebuild_account_balances(): that function walks forward from
-- a restaurant's earliest entry and stops at CURRENT_DATE. A backward move
-- (an entry re-dated to a day before its old day) is already inside that
-- walk and needs no rebuild trigger; a forward move past CURRENT_DATE
-- cannot happen here because bank_txn_entry_day never produces a future
-- day for an already-posted transaction. See the design doc, section
-- "Re-date migration", for the full argument.

SET statement_timeout = 0;

DO $$
DECLARE
  v_bank_entries_moved int := 0;
  v_reclass_entries_moved int := 0;
BEGIN
  -- Statement 1: bank-transaction entries.
  UPDATE journal_entries je
  SET entry_date = bank_txn_entry_day(bt.transaction_date, r.timezone),
      updated_at = now()
  FROM bank_transactions bt
  JOIN restaurants r ON r.id = bt.restaurant_id
  WHERE je.reference_type = 'bank_transaction'
    AND je.reference_id = bt.id
    AND je.restaurant_id = bt.restaurant_id
    AND je.entry_date IS DISTINCT FROM bank_txn_entry_day(bt.transaction_date, r.timezone)
    AND NOT EXISTS (
      SELECT 1 FROM fiscal_periods fp
      WHERE fp.restaurant_id = je.restaurant_id
        AND bank_txn_entry_day(bt.transaction_date, r.timezone) >= fp.period_start
        AND bank_txn_entry_day(bt.transaction_date, r.timezone) <= fp.period_end
        AND fp.is_closed = true
    );

  GET DIAGNOSTICS v_bank_entries_moved = ROW_COUNT;
  RAISE NOTICE 'redate_bank_journal_entries: bank-transaction entries moved = %', v_bank_entries_moved;

  -- Statement 2: reclassification entries.
  UPDATE journal_entries je
  SET entry_date = bank_txn_entry_day(bt.transaction_date, r.timezone),
      updated_at = now()
  FROM transaction_reclassifications tr
  JOIN bank_transactions bt ON bt.id = tr.bank_transaction_id
  JOIN restaurants r ON r.id = bt.restaurant_id
  WHERE je.id = tr.reclass_journal_entry_id
    AND je.reference_type = 'reclassification'
    AND je.entry_date IS DISTINCT FROM bank_txn_entry_day(bt.transaction_date, r.timezone)
    AND NOT EXISTS (
      SELECT 1 FROM fiscal_periods fp
      WHERE fp.restaurant_id = je.restaurant_id
        AND bank_txn_entry_day(bt.transaction_date, r.timezone) >= fp.period_start
        AND bank_txn_entry_day(bt.transaction_date, r.timezone) <= fp.period_end
        AND fp.is_closed = true
    );

  GET DIAGNOSTICS v_reclass_entries_moved = ROW_COUNT;
  RAISE NOTICE 'redate_bank_journal_entries: reclassification entries moved = %', v_reclass_entries_moved;
END $$;

RESET statement_timeout;
