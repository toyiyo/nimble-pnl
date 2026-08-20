-- File: supabase/tests/23_backfill_bank_transaction_journal_entries.sql
-- Description: RED-phase pgTAP tests for the kept, rerunnable
-- backfill_bank_transaction_journal_entries() function. The function does
-- not exist yet (it lands in the next task); every assertion below must
-- fail against the current schema. See
-- docs/superpowers/specs/2026-08-19-bulk-categorize-journal-entries-design.md
-- section 7 for the candidate predicate and insert shape this pins.

BEGIN;
SELECT plan(14);

SET LOCAL role TO postgres;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

-- R_BF_MAIN: fully provisioned (cash account 1000, one active category, one
-- inactive category). Carries one row per exclusion rule plus the one row
-- that must gain an entry.
INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-000000000810'::uuid, 'Backfill Main Restaurant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO chart_of_accounts (id, restaurant_id, account_code, account_name, account_type, account_subtype, normal_balance, is_active) VALUES
  ('00000000-0000-0000-0000-000000000811'::uuid, '00000000-0000-0000-0000-000000000810'::uuid, '1000', 'Cash', 'asset', 'cash', 'debit', true),
  ('00000000-0000-0000-0000-000000000812'::uuid, '00000000-0000-0000-0000-000000000810'::uuid, '6000', 'Supplies Expense', 'expense', 'operating_expenses', 'debit', true),
  ('00000000-0000-0000-0000-000000000813'::uuid, '00000000-0000-0000-0000-000000000810'::uuid, '6099', 'Old Category', 'expense', 'operating_expenses', 'debit', false)
ON CONFLICT (id) DO UPDATE SET account_name = EXCLUDED.account_name, is_active = EXCLUDED.is_active;

INSERT INTO connected_banks (id, restaurant_id, stripe_financial_account_id, institution_name, status) VALUES
  ('00000000-0000-0000-0000-000000000815'::uuid, '00000000-0000-0000-0000-000000000810'::uuid, 'fa_test_backfill_main_001', 'Test Bank', 'connected')
ON CONFLICT (id) DO NOTHING;

-- R_BF_NOCASH: has an active category but NO account_code '1000'. Used only
-- by the "restaurant without a cash account" exclusion test.
INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-000000000820'::uuid, 'Backfill No-Cash Restaurant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO chart_of_accounts (id, restaurant_id, account_code, account_name, account_type, account_subtype, normal_balance, is_active) VALUES
  ('00000000-0000-0000-0000-000000000821'::uuid, '00000000-0000-0000-0000-000000000820'::uuid, '6000', 'Supplies Expense', 'expense', 'operating_expenses', 'debit', true)
ON CONFLICT (id) DO UPDATE SET account_name = EXCLUDED.account_name, is_active = EXCLUDED.is_active;

INSERT INTO connected_banks (id, restaurant_id, stripe_financial_account_id, institution_name, status) VALUES
  ('00000000-0000-0000-0000-000000000825'::uuid, '00000000-0000-0000-0000-000000000820'::uuid, 'fa_test_backfill_nocash_001', 'Test Bank', 'connected')
ON CONFLICT (id) DO NOTHING;

-- Closed fiscal period covering the 2020-01-15 transaction below.
INSERT INTO fiscal_periods (id, restaurant_id, period_start, period_end, is_closed, closed_at) VALUES
  ('00000000-0000-0000-0000-000000000840'::uuid, '00000000-0000-0000-0000-000000000810'::uuid,
   DATE '2020-01-01', DATE '2020-01-31', true, now())
ON CONFLICT (id) DO UPDATE SET is_closed = true;

-- Candidate rows: categorized, entry-less, no journal_entries row exists for
-- any of them yet.
INSERT INTO bank_transactions (
  id, restaurant_id, connected_bank_id, stripe_transaction_id,
  transaction_date, amount, description, status, is_categorized, is_transfer, is_reconciled, category_id
) VALUES
  -- Test 1/2/9/10: the one row that must gain an entry, negative amount.
  ('00000000-0000-0000-0000-000000000901'::uuid, '00000000-0000-0000-0000-000000000810'::uuid, '00000000-0000-0000-0000-000000000815'::uuid,
   'txn-backfill-eligible-1', CURRENT_DATE, -55.00, 'Categorized, entry-less', 'posted', true, false, false,
   '00000000-0000-0000-0000-000000000812'::uuid),
  -- Test 3: transfer row -> must gain nothing.
  ('00000000-0000-0000-0000-000000000902'::uuid, '00000000-0000-0000-0000-000000000810'::uuid, '00000000-0000-0000-0000-000000000815'::uuid,
   'txn-backfill-transfer-1', CURRENT_DATE, -20.00, 'Transfer row', 'posted', true, true, false,
   '00000000-0000-0000-0000-000000000812'::uuid),
  -- Test 4: inside a closed fiscal period -> must gain nothing.
  ('00000000-0000-0000-0000-000000000903'::uuid, '00000000-0000-0000-0000-000000000810'::uuid, '00000000-0000-0000-0000-000000000815'::uuid,
   'txn-backfill-closed-period-1', DATE '2020-01-15', -30.00, 'In a closed fiscal period', 'posted', true, false, false,
   '00000000-0000-0000-0000-000000000812'::uuid),
  -- Test 6: inactive category -> must gain nothing.
  ('00000000-0000-0000-0000-000000000904'::uuid, '00000000-0000-0000-0000-000000000810'::uuid, '00000000-0000-0000-0000-000000000815'::uuid,
   'txn-backfill-inactive-cat-1', CURRENT_DATE, -40.00, 'Inactive category', 'posted', true, false, false,
   '00000000-0000-0000-0000-000000000813'::uuid),
  -- Test 5: restaurant with no cash account 1000 -> must gain nothing.
  ('00000000-0000-0000-0000-000000000905'::uuid, '00000000-0000-0000-0000-000000000820'::uuid, '00000000-0000-0000-0000-000000000825'::uuid,
   'txn-backfill-nocash-1', CURRENT_DATE, -25.00, 'No cash account restaurant', 'posted', true, false, false,
   '00000000-0000-0000-0000-000000000821'::uuid)
ON CONFLICT (id) DO UPDATE SET
  is_categorized = EXCLUDED.is_categorized,
  is_transfer = EXCLUDED.is_transfer,
  category_id = EXCLUDED.category_id;

-- ---------------------------------------------------------------------------
-- First call: runs the backfill once against every fixture above.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE backfill_call_1 AS
SELECT backfill_bank_transaction_journal_entries() AS result;

-- ---------------------------------------------------------------------------
-- Test 7: the function returns entries_created, lines_created,
-- restaurants_rebuilt.
-- ---------------------------------------------------------------------------
SELECT ok(
  (SELECT result FROM backfill_call_1) ?& ARRAY['entries_created', 'lines_created', 'restaurants_rebuilt'],
  'Result jsonb has keys entries_created, lines_created, restaurants_rebuilt'
);

SELECT is(
  (SELECT (result ->> 'entries_created')::int FROM backfill_call_1),
  1,
  'First call reports entries_created = 1 (only one fixture row is eligible)'
);

SELECT is(
  (SELECT (result ->> 'lines_created')::int FROM backfill_call_1),
  2,
  'First call reports lines_created = 2 (one entry, two lines)'
);

SELECT is(
  (SELECT (result ->> 'restaurants_rebuilt')::int FROM backfill_call_1),
  1,
  'First call reports restaurants_rebuilt = 1 (only R_BF_MAIN gained an entry)'
);

-- ---------------------------------------------------------------------------
-- Test 1: the eligible row gains one entry and two lines, correct sign
-- convention (negative amount -> debit category, credit cash).
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT COUNT(*)::int FROM journal_entries
     WHERE reference_type = 'bank_transaction' AND reference_id = '00000000-0000-0000-0000-000000000901'::uuid),
  1,
  'Eligible row gains exactly one journal entry'
);

SELECT is(
  (SELECT jel.debit_amount FROM journal_entry_lines jel
     JOIN journal_entries je ON je.id = jel.journal_entry_id
     WHERE je.reference_type = 'bank_transaction' AND je.reference_id = '00000000-0000-0000-0000-000000000901'::uuid
       AND jel.account_id = '00000000-0000-0000-0000-000000000812'::uuid),
  55.00,
  'Negative amount: category line is debited ABS(amount)'
);

SELECT is(
  (SELECT jel.credit_amount FROM journal_entry_lines jel
     JOIN journal_entries je ON je.id = jel.journal_entry_id
     WHERE je.reference_type = 'bank_transaction' AND je.reference_id = '00000000-0000-0000-0000-000000000901'::uuid
       AND jel.account_id = '00000000-0000-0000-0000-000000000811'::uuid),
  55.00,
  'Negative amount: cash line is credited ABS(amount)'
);

-- ---------------------------------------------------------------------------
-- Test 2: a second call creates nothing (idempotent).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE backfill_call_2 AS
SELECT backfill_bank_transaction_journal_entries() AS result;

SELECT is(
  (SELECT (result ->> 'entries_created')::int FROM backfill_call_2),
  0,
  'Second call reports entries_created = 0 (idempotent)'
);

SELECT is(
  (SELECT COUNT(*)::int FROM journal_entries
     WHERE reference_type = 'bank_transaction' AND reference_id = '00000000-0000-0000-0000-000000000901'::uuid),
  1,
  'Second call does not duplicate the entry for the already-backfilled row'
);

-- ---------------------------------------------------------------------------
-- Test 3: a transfer row gains nothing.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT COUNT(*)::int FROM journal_entries
     WHERE reference_type = 'bank_transaction' AND reference_id = '00000000-0000-0000-0000-000000000902'::uuid),
  0,
  'Transfer row gains no journal entry'
);

-- ---------------------------------------------------------------------------
-- Test 4: a row inside a closed fiscal period gains nothing.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT COUNT(*)::int FROM journal_entries
     WHERE reference_type = 'bank_transaction' AND reference_id = '00000000-0000-0000-0000-000000000903'::uuid),
  0,
  'Row inside a closed fiscal period gains no journal entry'
);

-- ---------------------------------------------------------------------------
-- Test 5: a restaurant without a cash account 1000 gains nothing.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT COUNT(*)::int FROM journal_entries
     WHERE reference_type = 'bank_transaction' AND reference_id = '00000000-0000-0000-0000-000000000905'::uuid),
  0,
  'Restaurant without a cash account 1000 gains no journal entry'
);

-- ---------------------------------------------------------------------------
-- Test 6: a row with an inactive category gains nothing.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT COUNT(*)::int FROM journal_entries
     WHERE reference_type = 'bank_transaction' AND reference_id = '00000000-0000-0000-0000-000000000904'::uuid),
  0,
  'Row with an inactive category gains no journal entry'
);

SELECT * FROM finish();
ROLLBACK;
