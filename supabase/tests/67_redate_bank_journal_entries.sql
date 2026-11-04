-- File: supabase/tests/67_redate_bank_journal_entries.sql
-- Description: proves the one-time re-date statement shape used by
-- migration 20260820210500_redate_bank_journal_entries.sql. Seeds a
-- wrong-day bank entry, a wrong-day reclass entry, a date-anchored entry,
-- and two closed-period collisions (one on the new day, one on the old
-- day); runs the same UPDATEs; asserts the moves and the skips. Also
-- proves the report-level effect: a mid-window as-of balance changes
-- after the re-date.

BEGIN;
SELECT plan(9);

SET LOCAL role TO postgres;
SET LOCAL timezone TO 'Asia/Tokyo';

-- Fixtures -----------------------------------------------------------------
INSERT INTO restaurants (id, name, timezone) VALUES
  ('00000000-0000-0000-0000-000000006710'::uuid, 'Redate Restaurant', 'America/Chicago')
ON CONFLICT (id) DO UPDATE SET timezone = 'America/Chicago';

INSERT INTO chart_of_accounts (id, restaurant_id, account_code, account_name, account_type, account_subtype, normal_balance, is_active) VALUES
  ('00000000-0000-0000-0000-000000006711'::uuid, '00000000-0000-0000-0000-000000006710'::uuid, '1000', 'Cash', 'asset', 'cash', 'debit', true),
  ('00000000-0000-0000-0000-000000006712'::uuid, '00000000-0000-0000-0000-000000006710'::uuid, '6000', 'Supplies Expense', 'expense', 'operating_expenses', 'debit', true)
ON CONFLICT (id) DO UPDATE SET is_active = true;

INSERT INTO connected_banks (id, restaurant_id, stripe_financial_account_id, institution_name, status) VALUES
  ('00000000-0000-0000-0000-000000006715'::uuid, '00000000-0000-0000-0000-000000006710'::uuid, 'fa_test_redate_001', 'Test Bank', 'connected')
ON CONFLICT (id) DO NOTHING;

-- Closed period that must protect entry 6904 below.
INSERT INTO fiscal_periods (id, restaurant_id, period_start, period_end, is_closed, closed_at) VALUES
  ('00000000-0000-0000-0000-000000006740'::uuid, '00000000-0000-0000-0000-000000006710'::uuid,
   DATE '2026-03-01', DATE '2026-03-31', true, now())
ON CONFLICT (id) DO UPDATE SET is_closed = true;

INSERT INTO bank_transactions (
  id, restaurant_id, connected_bank_id, stripe_transaction_id,
  transaction_date, amount, description, status, is_categorized, is_transfer, is_reconciled
) VALUES
  -- 6801: evening instant, entry on the wrong UTC day.
  ('00000000-0000-0000-0000-000000006801'::uuid, '00000000-0000-0000-0000-000000006710'::uuid,
   '00000000-0000-0000-0000-000000006715'::uuid, 'txn-redate-evening-1',
   TIMESTAMPTZ '2026-02-02 03:30:00+00', -50.00, 'Evening instant', 'posted', true, false, false),
  -- 6802: date anchor, entry already right.
  ('00000000-0000-0000-0000-000000006802'::uuid, '00000000-0000-0000-0000-000000006710'::uuid,
   '00000000-0000-0000-0000-000000006715'::uuid, 'txn-redate-anchor-1',
   TIMESTAMPTZ '2026-02-10 00:00:00+00', -20.00, 'Date anchor', 'posted', true, false, false),
  -- 6803: evening instant with a reclass entry.
  ('00000000-0000-0000-0000-000000006803'::uuid, '00000000-0000-0000-0000-000000006710'::uuid,
   '00000000-0000-0000-0000-000000006715'::uuid, 'txn-redate-reclass-1',
   TIMESTAMPTZ '2026-02-16 02:15:00+00', -30.00, 'Reclassed instant', 'posted', true, false, false),
  -- 6804: the new day (2026-03-31) falls inside the closed period; the
  -- old day (2026-04-01, UTC) does not. The re-date must skip it.
  ('00000000-0000-0000-0000-000000006804'::uuid, '00000000-0000-0000-0000-000000006710'::uuid,
   '00000000-0000-0000-0000-000000006715'::uuid, 'txn-redate-closed-1',
   TIMESTAMPTZ '2026-04-01 03:30:00+00', -40.00, 'Closed-period collision', 'posted', true, false, false),
  -- 6805: the mirror case. The old day (2026-03-01, UTC) sits inside the
  -- closed period; the new day (2026-02-28, local) does not. A move
  -- would pull activity out of the closed period. The re-date must skip
  -- it too.
  ('00000000-0000-0000-0000-000000006805'::uuid, '00000000-0000-0000-0000-000000006710'::uuid,
   '00000000-0000-0000-0000-000000006715'::uuid, 'txn-redate-closed-2',
   TIMESTAMPTZ '2026-03-01 03:30:00+00', -45.00, 'Closed-period source collision', 'posted', true, false, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO journal_entries (
  id, restaurant_id, entry_date, entry_number, description,
  reference_type, reference_id, total_debit, total_credit
) VALUES
  ('00000000-0000-0000-0000-000000006901'::uuid, '00000000-0000-0000-0000-000000006710'::uuid,
   DATE '2026-02-02', 'BANK-txn-redate-evening-1-SEED', 'Evening instant',
   'bank_transaction', '00000000-0000-0000-0000-000000006801'::uuid, 50.00, 50.00),
  ('00000000-0000-0000-0000-000000006902'::uuid, '00000000-0000-0000-0000-000000006710'::uuid,
   DATE '2026-02-10', 'BANK-txn-redate-anchor-1-SEED', 'Date anchor',
   'bank_transaction', '00000000-0000-0000-0000-000000006802'::uuid, 20.00, 20.00),
  ('00000000-0000-0000-0000-000000006903'::uuid, '00000000-0000-0000-0000-000000006710'::uuid,
   DATE '2026-02-16', 'RECLASS-txn-redate-reclass-1-SEED', 'Reclassed instant',
   'reclassification', gen_random_uuid(), 30.00, 30.00),
  ('00000000-0000-0000-0000-000000006904'::uuid, '00000000-0000-0000-0000-000000006710'::uuid,
   DATE '2026-04-01', 'BANK-txn-redate-closed-1-SEED', 'Closed-period collision',
   'bank_transaction', '00000000-0000-0000-0000-000000006804'::uuid, 40.00, 40.00),
  ('00000000-0000-0000-0000-000000006905'::uuid, '00000000-0000-0000-0000-000000006710'::uuid,
   DATE '2026-03-01', 'BANK-txn-redate-closed-2-SEED', 'Closed-period source collision',
   'bank_transaction', '00000000-0000-0000-0000-000000006805'::uuid, 45.00, 45.00);

-- Lines for 6901 so the report-effect assertion has an amount to sum.
INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES
  ('00000000-0000-0000-0000-000000006901'::uuid, '00000000-0000-0000-0000-000000006712'::uuid, 50.00, 0, 'Supplies'),
  ('00000000-0000-0000-0000-000000006901'::uuid, '00000000-0000-0000-0000-000000006711'::uuid, 0, 50.00, 'Cash payment');

INSERT INTO transaction_reclassifications (
  restaurant_id, bank_transaction_id, original_category_id,
  new_category_id, reclass_journal_entry_id, reason
) VALUES (
  '00000000-0000-0000-0000-000000006710'::uuid,
  '00000000-0000-0000-0000-000000006803'::uuid,
  '00000000-0000-0000-0000-000000006712'::uuid,
  '00000000-0000-0000-0000-000000006712'::uuid,
  '00000000-0000-0000-0000-000000006903'::uuid,
  'redate test');

-- Report-level effect, BEFORE: the mid-window as-of day (2026-02-01) sees
-- no expense yet, because the entry still sits on 2026-02-02.
SELECT is(
  compute_account_balance('00000000-0000-0000-0000-000000006712'::uuid, DATE '2026-02-01'),
  0.00::numeric,
  'before the re-date, the mid-window balance excludes the entry');

-- The migration statements ---------------------------------------------------
-- Keep these two UPDATEs byte-identical to
-- supabase/migrations/20260820210500_redate_bank_journal_entries.sql.

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
      AND fp.is_closed = true
      AND (
        bank_txn_entry_day(bt.transaction_date, r.timezone)
          BETWEEN fp.period_start AND fp.period_end
        OR je.entry_date BETWEEN fp.period_start AND fp.period_end
      )
  );

UPDATE journal_entries je
SET entry_date = bank_txn_entry_day(bt.transaction_date, r.timezone),
    updated_at = now()
FROM transaction_reclassifications tr
JOIN bank_transactions bt ON bt.id = tr.bank_transaction_id
JOIN restaurants r ON r.id = bt.restaurant_id
WHERE je.id = tr.reclass_journal_entry_id
  AND je.reference_type = 'reclassification'
  AND je.restaurant_id = bt.restaurant_id
  AND je.entry_date IS DISTINCT FROM bank_txn_entry_day(bt.transaction_date, r.timezone)
  AND NOT EXISTS (
    SELECT 1 FROM fiscal_periods fp
    WHERE fp.restaurant_id = je.restaurant_id
      AND fp.is_closed = true
      AND (
        bank_txn_entry_day(bt.transaction_date, r.timezone)
          BETWEEN fp.period_start AND fp.period_end
        OR je.entry_date BETWEEN fp.period_start AND fp.period_end
      )
  );

-- Assertions -----------------------------------------------------------------
SELECT is(
  (SELECT entry_date FROM journal_entries WHERE id = '00000000-0000-0000-0000-000000006901'::uuid),
  DATE '2026-02-01',
  'bank entry moves to the restaurant-local day');

SELECT is(
  (SELECT entry_date FROM journal_entries WHERE id = '00000000-0000-0000-0000-000000006902'::uuid),
  DATE '2026-02-10',
  'date-anchored entry does not move');

SELECT is(
  (SELECT entry_date FROM journal_entries WHERE id = '00000000-0000-0000-0000-000000006903'::uuid),
  DATE '2026-02-15',
  'reclass entry moves via transaction_reclassifications');

SELECT is(
  (SELECT entry_date FROM journal_entries WHERE id = '00000000-0000-0000-0000-000000006904'::uuid),
  DATE '2026-04-01',
  'closed-period collision keeps its old day');

SELECT is(
  (SELECT entry_date FROM journal_entries WHERE id = '00000000-0000-0000-0000-000000006905'::uuid),
  DATE '2026-03-01',
  'an entry inside a closed period does not move out of it');

-- Report-level effect, AFTER: the same as-of day now includes the entry.
SELECT is(
  compute_account_balance('00000000-0000-0000-0000-000000006712'::uuid, DATE '2026-02-01'),
  50.00::numeric,
  'after the re-date, the mid-window balance includes the entry');

-- Idempotence: a second run changes no row.
CREATE TEMP TABLE redate_before AS
  SELECT id, entry_date FROM journal_entries
  WHERE restaurant_id = '00000000-0000-0000-0000-000000006710'::uuid;

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
      AND fp.is_closed = true
      AND (
        bank_txn_entry_day(bt.transaction_date, r.timezone)
          BETWEEN fp.period_start AND fp.period_end
        OR je.entry_date BETWEEN fp.period_start AND fp.period_end
      )
  );

SELECT is(
  (SELECT count(*)::int FROM journal_entries je
   JOIN redate_before b ON b.id = je.id
   WHERE je.entry_date IS DISTINCT FROM b.entry_date),
  0,
  'a second run is a no-op');

-- Compute_account_balance signature check (guards a signature drift that
-- would break the report assertions silently).
SELECT ok(
  has_function_privilege('postgres', 'compute_account_balance(uuid, date)', 'EXECUTE'),
  'compute_account_balance(uuid, date) exists');

SELECT * FROM finish();
ROLLBACK;
