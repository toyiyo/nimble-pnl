-- File: supabase/tests/65_bank_delete_rpcs_membership_guard.sql
-- Description: RED-phase pgTAP tests for the missing membership guard on the
-- four bank-delete RPCs (delete_bank_transaction, bulk_delete_bank_transactions,
-- restore_deleted_transaction, permanently_delete_tombstone). Today none of
-- these functions check that the caller belongs to p_restaurant_id, so a user
-- from a different restaurant can delete, bulk-delete, restore, or purge
-- another tenant's bank data. Every throws_ok test below must fail against
-- the current schema (the attacker calls succeed today). See
-- docs/superpowers/specs/2026-08-20-bank-delete-rpcs-membership-guard-design.md.

BEGIN;
SELECT plan(15);

SET LOCAL role TO postgres;

-- ---------------------------------------------------------------------------
-- Fixtures (reserved 65... uuid range)
-- ---------------------------------------------------------------------------

-- Member user: belongs to the victim restaurant.
INSERT INTO auth.users (id, email) VALUES
  ('65000000-0000-0000-0000-000000000001'::uuid, 'guard-member@example.com')
ON CONFLICT (id) DO NOTHING;

-- Attacker user: belongs to a different restaurant only.
INSERT INTO auth.users (id, email) VALUES
  ('65000000-0000-0000-0000-000000000002'::uuid, 'guard-attacker@example.com')
ON CONFLICT (id) DO NOTHING;

-- Victim restaurant, owned by the member user.
INSERT INTO restaurants (id, name) VALUES
  ('65000000-0000-0000-0000-000000000010'::uuid, 'Guard Victim Restaurant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('65000000-0000-0000-0000-000000000001'::uuid, '65000000-0000-0000-0000-000000000010'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

-- Attacker restaurant, owned by the attacker user. No membership on the
-- victim restaurant.
INSERT INTO restaurants (id, name) VALUES
  ('65000000-0000-0000-0000-000000000020'::uuid, 'Guard Attacker Restaurant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('65000000-0000-0000-0000-000000000002'::uuid, '65000000-0000-0000-0000-000000000020'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

-- Victim's connected bank.
INSERT INTO connected_banks (id, restaurant_id, stripe_financial_account_id, institution_name) VALUES
  ('65000000-0000-0000-0000-000000000030'::uuid, '65000000-0000-0000-0000-000000000010'::uuid, 'fa_test_guard_030', 'Guard Test Bank')
ON CONFLICT (id) DO NOTHING;

-- Victim category, used by the split fixture below.
INSERT INTO chart_of_accounts (id, restaurant_id, account_code, account_name, account_type, account_subtype, normal_balance, is_active) VALUES
  ('65000000-0000-0000-0000-000000000040'::uuid, '65000000-0000-0000-0000-000000000010'::uuid, '6500', 'Guard Test Expense', 'expense', 'operating_expenses', 'debit', true)
ON CONFLICT (id) DO UPDATE SET account_name = EXCLUDED.account_name;

-- Four victim bank_transactions rows.
INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount, source) VALUES
  ('65000000-0000-0000-0000-000000000101'::uuid, '65000000-0000-0000-0000-000000000010'::uuid, '65000000-0000-0000-0000-000000000030'::uuid, 'guard_txn_101', DATE '2026-02-01', 'Guard Test Txn 101', -10.00, 'bank_integration'),
  ('65000000-0000-0000-0000-000000000102'::uuid, '65000000-0000-0000-0000-000000000010'::uuid, '65000000-0000-0000-0000-000000000030'::uuid, 'guard_txn_102', DATE '2026-02-02', 'Guard Test Txn 102', -20.00, 'bank_integration'),
  ('65000000-0000-0000-0000-000000000103'::uuid, '65000000-0000-0000-0000-000000000010'::uuid, '65000000-0000-0000-0000-000000000030'::uuid, 'guard_txn_103', DATE '2026-02-03', 'Guard Test Txn 103', -30.00, 'bank_integration'),
  ('65000000-0000-0000-0000-000000000104'::uuid, '65000000-0000-0000-0000-000000000010'::uuid, '65000000-0000-0000-0000-000000000030'::uuid, 'guard_txn_104', DATE '2026-02-04', 'Guard Test Txn 104', -40.00, 'bank_integration')
ON CONFLICT (id) DO NOTHING;

-- One split row on transaction 101.
INSERT INTO bank_transaction_splits (id, transaction_id, category_id, amount, description) VALUES
  ('65000000-0000-0000-0000-000000000050'::uuid, '65000000-0000-0000-0000-000000000101'::uuid, '65000000-0000-0000-0000-000000000040'::uuid, -10.00, 'Guard Test Split')
ON CONFLICT (id) DO NOTHING;

-- One tombstone row, inserted directly (not via delete_bank_transaction).
INSERT INTO deleted_bank_transactions (id, restaurant_id, connected_bank_id, source, external_transaction_id, fingerprint, transaction_date, amount, description) VALUES
  ('65000000-0000-0000-0000-000000000060'::uuid, '65000000-0000-0000-0000-000000000010'::uuid, '65000000-0000-0000-0000-000000000030'::uuid, 'bank_integration', 'guard_txn_060', compute_transaction_fingerprint(DATE '2026-02-05', -50.00, 'Guard Test Tombstone 060'), DATE '2026-02-05', -50.00, 'Guard Test Tombstone 060')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Section 1: attacker claims set. Every call must be rejected (4 tests).
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"65000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT delete_bank_transaction(
       '65000000-0000-0000-0000-000000000102'::uuid,
       '65000000-0000-0000-0000-000000000010'::uuid
     ) $$,
  'Unauthorized: user does not have access to this restaurant',
  'Attacker cannot call delete_bank_transaction on the victim restaurant'
);

SELECT throws_ok(
  $$ SELECT bulk_delete_bank_transactions(
       ARRAY['65000000-0000-0000-0000-000000000103'::uuid, '65000000-0000-0000-0000-000000000104'::uuid],
       '65000000-0000-0000-0000-000000000010'::uuid
     ) $$,
  'Unauthorized: user does not have access to this restaurant',
  'Attacker cannot call bulk_delete_bank_transactions on the victim restaurant'
);

SELECT throws_ok(
  $$ SELECT restore_deleted_transaction(
       '65000000-0000-0000-0000-000000000060'::uuid,
       '65000000-0000-0000-0000-000000000010'::uuid
     ) $$,
  'Unauthorized: user does not have access to this restaurant',
  'Attacker cannot call restore_deleted_transaction on the victim restaurant'
);

SELECT throws_ok(
  $$ SELECT permanently_delete_tombstone(
       '65000000-0000-0000-0000-000000000060'::uuid,
       '65000000-0000-0000-0000-000000000010'::uuid
     ) $$,
  'Unauthorized: user does not have access to this restaurant',
  'Attacker cannot call permanently_delete_tombstone on the victim restaurant'
);

-- ---------------------------------------------------------------------------
-- Section 2: victim rows stay intact after the four failed calls (3 tests).
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM bank_transactions WHERE restaurant_id = '65000000-0000-0000-0000-000000000010'::uuid),
  4,
  'Victim bank_transactions count is unchanged after attacker calls'
);

SELECT is(
  (SELECT count(*)::int FROM bank_transaction_splits WHERE transaction_id = '65000000-0000-0000-0000-000000000101'::uuid),
  1,
  'Victim bank_transaction_splits count is unchanged after attacker calls'
);

SELECT is(
  (SELECT count(*)::int FROM deleted_bank_transactions WHERE restaurant_id = '65000000-0000-0000-0000-000000000010'::uuid),
  1,
  'Victim deleted_bank_transactions count is unchanged after attacker calls'
);

-- ---------------------------------------------------------------------------
-- Section 3: no claims set (auth.uid() is NULL). Every call must be
-- rejected (4 tests).
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', NULL, true);

SELECT throws_ok(
  $$ SELECT delete_bank_transaction(
       '65000000-0000-0000-0000-000000000102'::uuid,
       '65000000-0000-0000-0000-000000000010'::uuid
     ) $$,
  'Unauthorized: user does not have access to this restaurant',
  'No claims: delete_bank_transaction is rejected'
);

SELECT throws_ok(
  $$ SELECT bulk_delete_bank_transactions(
       ARRAY['65000000-0000-0000-0000-000000000103'::uuid, '65000000-0000-0000-0000-000000000104'::uuid],
       '65000000-0000-0000-0000-000000000010'::uuid
     ) $$,
  'Unauthorized: user does not have access to this restaurant',
  'No claims: bulk_delete_bank_transactions is rejected'
);

SELECT throws_ok(
  $$ SELECT restore_deleted_transaction(
       '65000000-0000-0000-0000-000000000060'::uuid,
       '65000000-0000-0000-0000-000000000010'::uuid
     ) $$,
  'Unauthorized: user does not have access to this restaurant',
  'No claims: restore_deleted_transaction is rejected'
);

SELECT throws_ok(
  $$ SELECT permanently_delete_tombstone(
       '65000000-0000-0000-0000-000000000060'::uuid,
       '65000000-0000-0000-0000-000000000010'::uuid
     ) $$,
  'Unauthorized: user does not have access to this restaurant',
  'No claims: permanently_delete_tombstone is rejected'
);

-- ---------------------------------------------------------------------------
-- Section 4: member claims set. Every call succeeds (4 tests).
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"65000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

SELECT is(
  (delete_bank_transaction(
    '65000000-0000-0000-0000-000000000102'::uuid,
    '65000000-0000-0000-0000-000000000010'::uuid
  ))->>'success',
  'true',
  'Member: delete_bank_transaction succeeds on the victim restaurant'
);

SELECT is(
  (bulk_delete_bank_transactions(
    ARRAY['65000000-0000-0000-0000-000000000103'::uuid, '65000000-0000-0000-0000-000000000104'::uuid],
    '65000000-0000-0000-0000-000000000010'::uuid
  ))->>'success',
  'true',
  'Member: bulk_delete_bank_transactions succeeds on the victim restaurant'
);

SELECT is(
  (restore_deleted_transaction(
    '65000000-0000-0000-0000-000000000060'::uuid,
    '65000000-0000-0000-0000-000000000010'::uuid
  ))->>'success',
  'true',
  'Member: restore_deleted_transaction succeeds on the victim restaurant'
);

-- Tombstone left behind by the delete_bank_transaction call above, used to
-- exercise the success path for permanently_delete_tombstone.
DO $$
DECLARE
  v_tombstone_id UUID;
BEGIN
  SELECT id INTO v_tombstone_id
  FROM deleted_bank_transactions
  WHERE restaurant_id = '65000000-0000-0000-0000-000000000010'::uuid
  AND external_transaction_id = 'guard_txn_102';

  PERFORM set_config('test.guard_tombstone_id', v_tombstone_id::text, true);
END $$;

SELECT is(
  (permanently_delete_tombstone(
    (current_setting('test.guard_tombstone_id'))::uuid,
    '65000000-0000-0000-0000-000000000010'::uuid
  ))->>'success',
  'true',
  'Member: permanently_delete_tombstone succeeds on the victim restaurant'
);

SELECT * FROM finish();
ROLLBACK;
