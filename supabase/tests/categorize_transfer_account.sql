-- File: supabase/tests/categorize_transfer_account.sql
-- Description: Pins write-time contract that categorize_bank_transaction does
-- NOT touch is_transfer when assigning an asset/equity category. The dashboard
-- read-path (expenseDataFetcher / useExpenseHealth / Index daily-spending)
-- relies on this — if the RPC starts setting is_transfer automatically, both
-- this test and the read-path filter need to be revisited together.

BEGIN;
SELECT plan(4);

SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000201"}';

-- Fixture: user, restaurant, membership
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000201'::uuid, 'transfer-test@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-000000000299'::uuid, 'Transfer Test Restaurant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000201'::uuid, '00000000-0000-0000-0000-000000000299'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

-- Chart of accounts:
--   1000 = Cash (required by categorize_bank_transaction as the offsetting account)
--   1050 = Transfer Clearing Account (asset; the category under test)
INSERT INTO chart_of_accounts (id, restaurant_id, account_code, account_name, account_type, account_subtype, normal_balance) VALUES
  ('00000000-0000-0000-0000-000000000250'::uuid, '00000000-0000-0000-0000-000000000299'::uuid, '1000', 'Cash', 'asset', 'cash', 'debit'),
  ('00000000-0000-0000-0000-000000000252'::uuid, '00000000-0000-0000-0000-000000000299'::uuid, '1050', 'Transfer Clearing Account', 'asset', 'cash', 'debit')
ON CONFLICT (id) DO UPDATE SET account_name = EXCLUDED.account_name;

-- Connected bank + bank transaction fixture
INSERT INTO connected_banks (id, restaurant_id, stripe_financial_account_id, institution_name, status) VALUES
  ('00000000-0000-0000-0000-000000000261'::uuid, '00000000-0000-0000-0000-000000000299'::uuid, 'fa_test_xfer_001', 'Test Bank', 'connected')
ON CONFLICT (id) DO NOTHING;

INSERT INTO bank_transactions (
  id, restaurant_id, connected_bank_id, stripe_transaction_id,
  transaction_date, amount, description, status, is_categorized, is_transfer
) VALUES (
  '00000000-0000-0000-0000-000000000271'::uuid,
  '00000000-0000-0000-0000-000000000299'::uuid,
  '00000000-0000-0000-0000-000000000261'::uuid,
  'txn-transfer-test-1',
  '2026-04-15', -500, 'Move to savings', 'posted', false, false
)
ON CONFLICT (id) DO UPDATE SET
  is_categorized = false,
  is_transfer = false,
  category_id = NULL;

-- TEST 1: chart_of_accounts row exposes account_type for joined reads
SELECT is(
  (SELECT account_type::text FROM chart_of_accounts WHERE id = '00000000-0000-0000-0000-000000000252'::uuid),
  'asset',
  'Transfer Clearing Account is account_type=asset (read-path filter relies on this)'
);

-- TEST 2: Calling categorize_bank_transaction on the transfer account does not raise
SELECT lives_ok(
  $$ SELECT categorize_bank_transaction(
       '00000000-0000-0000-0000-000000000271'::uuid,
       '00000000-0000-0000-0000-000000000252'::uuid,
       NULL, NULL, NULL
     ) $$,
  'categorize_bank_transaction succeeds when assigning a Transfer (asset) category'
);

-- TEST 3: After categorization, category_id is set to the transfer-clearing account
SELECT is(
  (SELECT category_id FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000000271'::uuid),
  '00000000-0000-0000-0000-000000000252'::uuid,
  'category_id is updated to the transfer-clearing account'
);

-- TEST 4: is_transfer remains false (the bug surface — RPC does NOT auto-set this)
SELECT is(
  (SELECT is_transfer FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000000271'::uuid),
  false,
  'is_transfer remains false after asset-typed categorization (read-path must filter on account_type)'
);

SELECT * FROM finish();
ROLLBACK;
