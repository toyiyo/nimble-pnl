-- File: supabase/tests/66_categorize_local_entry_day.sql
-- Description: categorize_bank_transaction derives entry_date with
-- bank_txn_entry_day. Covers: evening-instant bank entry, reclass entry,
-- the heal of an existing entry, and the closed-period guard on the
-- helper basis. See
-- docs/superpowers/specs/2026-08-20-journal-entry-date-timezone-design.md.

BEGIN;
SELECT plan(6);

SET LOCAL role TO postgres;
SET LOCAL timezone TO 'Asia/Tokyo';  -- session TZ must not leak into dates

-- Fixtures -----------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000006601'::uuid, 'entry-day-test@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO restaurants (id, name, timezone) VALUES
  ('00000000-0000-0000-0000-000000006610'::uuid, 'Entry Day Restaurant', 'America/Chicago')
ON CONFLICT (id) DO UPDATE SET timezone = 'America/Chicago';

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000006601'::uuid, '00000000-0000-0000-0000-000000006610'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

INSERT INTO chart_of_accounts (id, restaurant_id, account_code, account_name, account_type, account_subtype, normal_balance, is_active) VALUES
  ('00000000-0000-0000-0000-000000006611'::uuid, '00000000-0000-0000-0000-000000006610'::uuid, '1000', 'Cash', 'asset', 'cash', 'debit', true),
  ('00000000-0000-0000-0000-000000006612'::uuid, '00000000-0000-0000-0000-000000006610'::uuid, '6000', 'Supplies Expense', 'expense', 'operating_expenses', 'debit', true),
  ('00000000-0000-0000-0000-000000006613'::uuid, '00000000-0000-0000-0000-000000006610'::uuid, '6010', 'Repairs Expense', 'expense', 'operating_expenses', 'debit', true)
ON CONFLICT (id) DO UPDATE SET account_name = EXCLUDED.account_name, is_active = true;

INSERT INTO connected_banks (id, restaurant_id, stripe_financial_account_id, institution_name, status) VALUES
  ('00000000-0000-0000-0000-000000006615'::uuid, '00000000-0000-0000-0000-000000006610'::uuid, 'fa_test_entry_day_001', 'Test Bank', 'connected')
ON CONFLICT (id) DO NOTHING;

-- Closed period for the guard test below.
INSERT INTO fiscal_periods (id, restaurant_id, period_start, period_end, is_closed, closed_at) VALUES
  ('00000000-0000-0000-0000-000000006640'::uuid, '00000000-0000-0000-0000-000000006610'::uuid,
   DATE '2026-01-01', DATE '2026-01-31', true, now())
ON CONFLICT (id) DO UPDATE SET is_closed = true;

INSERT INTO bank_transactions (
  id, restaurant_id, connected_bank_id, stripe_transaction_id,
  transaction_date, amount, description, status, is_categorized, is_transfer, is_reconciled
) VALUES
  -- Evening instant: 03:30Z on Feb 2 = 21:30 CST on Feb 1.
  ('00000000-0000-0000-0000-000000006701'::uuid, '00000000-0000-0000-0000-000000006610'::uuid,
   '00000000-0000-0000-0000-000000006615'::uuid, 'txn-entry-day-evening-1',
   TIMESTAMPTZ '2026-02-02 03:30:00+00', -50.00, 'Evening purchase', 'posted', false, false, false),
  -- Heal case: entry-less flag off; a wrong-day entry exists (seeded below).
  ('00000000-0000-0000-0000-000000006702'::uuid, '00000000-0000-0000-0000-000000006610'::uuid,
   '00000000-0000-0000-0000-000000006615'::uuid, 'txn-entry-day-heal-1',
   TIMESTAMPTZ '2026-02-05 03:30:00+00', -60.00, 'Heal me', 'posted', false, false, false),
  -- Closed-period boundary: 23:30Z on Jan 31 = 17:30 CST on Jan 31, inside
  -- the closed period. The old raw-timestamptz guard let this row through.
  ('00000000-0000-0000-0000-000000006703'::uuid, '00000000-0000-0000-0000-000000006610'::uuid,
   '00000000-0000-0000-0000-000000006615'::uuid, 'txn-entry-day-closed-1',
   TIMESTAMPTZ '2026-01-31 23:30:00+00', -70.00, 'Late on closed last day', 'posted', false, false, false)
ON CONFLICT (id) DO UPDATE SET is_categorized = false, category_id = NULL;

-- Wrong-day entry for the heal case (UTC day 2026-02-05; local day is 02-04).
INSERT INTO journal_entries (
  restaurant_id, entry_date, entry_number, description,
  reference_type, reference_id, total_debit, total_credit
) VALUES (
  '00000000-0000-0000-0000-000000006610'::uuid, DATE '2026-02-05',
  'BANK-txn-entry-day-heal-1-SEED', 'Heal me',
  'bank_transaction', '00000000-0000-0000-0000-000000006702'::uuid,
  60.00, 60.00
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000006601","role":"authenticated"}', true);

-- Tests --------------------------------------------------------------------

-- 1. Categorize the evening instant: entry lands on the local day.
SELECT lives_ok(
  $$SELECT categorize_bank_transaction(
      '00000000-0000-0000-0000-000000006701'::uuid,
      '00000000-0000-0000-0000-000000006612'::uuid)$$,
  'categorize succeeds for the evening instant');

SELECT is(
  (SELECT entry_date FROM journal_entries
   WHERE reference_type = 'bank_transaction'
     AND reference_id = '00000000-0000-0000-0000-000000006701'::uuid),
  DATE '2026-02-01',
  'bank entry lands on the restaurant-local day');

-- 2. Reclassify the same transaction: the reclass entry uses the same day.
SELECT lives_ok(
  $$SELECT categorize_bank_transaction(
      '00000000-0000-0000-0000-000000006701'::uuid,
      '00000000-0000-0000-0000-000000006613'::uuid)$$,
  'reclassification succeeds');

SELECT is(
  (SELECT je.entry_date
   FROM journal_entries je
   JOIN transaction_reclassifications tr ON tr.reclass_journal_entry_id = je.id
   WHERE tr.bank_transaction_id = '00000000-0000-0000-0000-000000006701'::uuid
   ORDER BY je.created_at DESC LIMIT 1),
  DATE '2026-02-01',
  'reclass entry lands on the restaurant-local day');

-- 3. Heal: categorize with an existing wrong-day entry updates entry_date.
SELECT categorize_bank_transaction(
  '00000000-0000-0000-0000-000000006702'::uuid,
  '00000000-0000-0000-0000-000000006612'::uuid);

SELECT is(
  (SELECT entry_date FROM journal_entries
   WHERE reference_type = 'bank_transaction'
     AND reference_id = '00000000-0000-0000-0000-000000006702'::uuid),
  DATE '2026-02-04',
  'existing entry heals to the restaurant-local day');

-- 4. Closed-period guard fires on the helper day, not the raw timestamptz.
SELECT throws_like(
  $$SELECT categorize_bank_transaction(
      '00000000-0000-0000-0000-000000006703'::uuid,
      '00000000-0000-0000-0000-000000006612'::uuid)$$,
  'Cannot categorize transaction in closed fiscal period%',
  'guard blocks a late instant on the closed period''s last day');

SELECT * FROM finish();
ROLLBACK;
