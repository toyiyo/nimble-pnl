-- File: supabase/tests/deleted_bank_transactions_tombstone.sql
-- Description: Tests for deleted_bank_transactions tombstone table,
--              compute_transaction_fingerprint function,
--              and delete/restore/permanent-delete functions

BEGIN;
SELECT plan(27);

-- Setup
SET LOCAL role TO postgres;

-- ============================================================
-- TEST: Table exists
-- ============================================================

-- Test 1: Table exists
SELECT has_table('public', 'deleted_bank_transactions', 'deleted_bank_transactions table should exist');

-- ============================================================
-- TEST: Required columns exist
-- ============================================================

-- Test 2: id column
SELECT has_column('public', 'deleted_bank_transactions', 'id', 'should have id column');

-- Test 3: restaurant_id column
SELECT has_column('public', 'deleted_bank_transactions', 'restaurant_id', 'should have restaurant_id column');

-- Test 4: connected_bank_id column
SELECT has_column('public', 'deleted_bank_transactions', 'connected_bank_id', 'should have connected_bank_id column');

-- Test 5: external_transaction_id column
SELECT has_column('public', 'deleted_bank_transactions', 'external_transaction_id', 'should have external_transaction_id column');

-- Test 6: fingerprint column
SELECT has_column('public', 'deleted_bank_transactions', 'fingerprint', 'should have fingerprint column');

-- Test 7: deleted_at column
SELECT has_column('public', 'deleted_bank_transactions', 'deleted_at', 'should have deleted_at column');

-- Test 8: deleted_by column
SELECT has_column('public', 'deleted_bank_transactions', 'deleted_by', 'should have deleted_by column');

-- ============================================================
-- TEST: Fingerprint function
-- ============================================================

-- Test 9: Fingerprint function exists
SELECT has_function('public', 'compute_transaction_fingerprint', 'fingerprint function should exist');

-- Test 10: Fingerprint is deterministic
SELECT is(
  public.compute_transaction_fingerprint('2026-01-15'::date, 42.50, 'RESTAURANT DEPOT #123'),
  public.compute_transaction_fingerprint('2026-01-15'::date, 42.50, 'RESTAURANT DEPOT #123'),
  'fingerprint should be deterministic for same inputs'
);

-- Test 11: Fingerprint differs for different amounts
SELECT isnt(
  public.compute_transaction_fingerprint('2026-01-15'::date, 42.50, 'RESTAURANT DEPOT'),
  public.compute_transaction_fingerprint('2026-01-15'::date, 42.51, 'RESTAURANT DEPOT'),
  'fingerprint should differ for different amounts'
);

-- Test 12: Fingerprint normalizes description (case + punctuation)
SELECT is(
  public.compute_transaction_fingerprint('2026-01-15'::date, 42.50, 'Restaurant Depot #123!'),
  public.compute_transaction_fingerprint('2026-01-15'::date, 42.50, 'restaurant depot 123'),
  'fingerprint should normalize case and punctuation'
);

-- ============================================================
-- TEST: Functional tests for delete/restore/permanent-delete
-- ============================================================

-- Create test data
DO $$
DECLARE
  v_restaurant_id UUID;
  v_bank_id UUID;
BEGIN
  -- Create a test restaurant
  INSERT INTO public.restaurants (id, name)
  VALUES ('a0000000-0000-0000-0000-000000000001'::uuid, 'Test Tombstone Restaurant')
  ON CONFLICT (id) DO NOTHING;

  v_restaurant_id := 'a0000000-0000-0000-0000-000000000001'::uuid;

  -- Create a test connected_banks row
  INSERT INTO public.connected_banks (id, restaurant_id, stripe_financial_account_id, institution_name)
  VALUES (
    'b0000000-0000-0000-0000-000000000001'::uuid,
    v_restaurant_id,
    'test_stripe_fa_tombstone_001',
    'Test Bank for Tombstones'
  )
  ON CONFLICT (id) DO NOTHING;

  v_bank_id := 'b0000000-0000-0000-0000-000000000001'::uuid;

  -- Create test bank transactions
  -- Transaction 1: will be single-deleted
  INSERT INTO public.bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount, source)
  VALUES (
    'c0000000-0000-0000-0000-000000000001'::uuid,
    v_restaurant_id,
    v_bank_id,
    'stripe_txn_tombstone_001',
    '2026-01-15'::timestamptz,
    'RESTAURANT DEPOT #123',
    -42.50,
    'bank_integration'
  );

  -- Transaction 2: will be bulk-deleted
  INSERT INTO public.bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount, source)
  VALUES (
    'c0000000-0000-0000-0000-000000000002'::uuid,
    v_restaurant_id,
    v_bank_id,
    'stripe_txn_tombstone_002',
    '2026-01-16'::timestamptz,
    'SYSCO FOODS #456',
    -125.00,
    'bank_integration'
  );

  -- Transaction 3: will be bulk-deleted
  INSERT INTO public.bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount, source)
  VALUES (
    'c0000000-0000-0000-0000-000000000003'::uuid,
    v_restaurant_id,
    v_bank_id,
    'stripe_txn_tombstone_003',
    '2026-01-17'::timestamptz,
    'US FOODS #789',
    -200.00,
    'bank_integration'
  );

  -- Transaction 4: for restore test
  INSERT INTO public.bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount, source)
  VALUES (
    'c0000000-0000-0000-0000-000000000004'::uuid,
    v_restaurant_id,
    v_bank_id,
    'stripe_txn_tombstone_004',
    '2026-01-18'::timestamptz,
    'COSTCO WHOLESALE',
    -350.00,
    'bank_integration'
  );
END $$;

-- ============================================================
-- Test 13: delete_bank_transaction creates tombstone and removes active row
-- ============================================================
SELECT is(
  (public.delete_bank_transaction(
    'c0000000-0000-0000-0000-000000000001'::uuid,
    'a0000000-0000-0000-0000-000000000001'::uuid
  ))->>'success',
  'true',
  'delete_bank_transaction should return success'
);

-- Test 14: Active row is gone
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.bank_transactions
    WHERE id = 'c0000000-0000-0000-0000-000000000001'::uuid
  ),
  'deleted transaction should no longer exist in bank_transactions'
);

-- Test 15: Tombstone was created
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.deleted_bank_transactions
    WHERE restaurant_id = 'a0000000-0000-0000-0000-000000000001'::uuid
    AND external_transaction_id = 'stripe_txn_tombstone_001'
  ),
  'tombstone should exist in deleted_bank_transactions after delete'
);

-- ============================================================
-- Test 16: Delete is idempotent (calling twice succeeds)
-- ============================================================
SELECT is(
  (public.delete_bank_transaction(
    'c0000000-0000-0000-0000-000000000001'::uuid,
    'a0000000-0000-0000-0000-000000000001'::uuid
  ))->>'success',
  'false',
  'second delete should return false (transaction not found)'
);

-- Only one tombstone should exist for that external_transaction_id
SELECT is(
  (SELECT count(*)::int FROM public.deleted_bank_transactions
   WHERE restaurant_id = 'a0000000-0000-0000-0000-000000000001'::uuid
   AND external_transaction_id = 'stripe_txn_tombstone_001'),
  1,
  'should have exactly one tombstone after double delete (Test 17)'
);

-- ============================================================
-- Test 18: Restore moves back to active and removes tombstone
-- ============================================================

-- First, delete transaction 4 so we have a tombstone to restore
SELECT is(
  (public.delete_bank_transaction(
    'c0000000-0000-0000-0000-000000000004'::uuid,
    'a0000000-0000-0000-0000-000000000001'::uuid
  ))->>'success',
  'true',
  'delete transaction 4 for restore test (Test 18)'
);

-- Get the tombstone ID for transaction 4
DO $$
DECLARE
  v_tombstone_id UUID;
  v_result JSONB;
BEGIN
  SELECT id INTO v_tombstone_id
  FROM public.deleted_bank_transactions
  WHERE external_transaction_id = 'stripe_txn_tombstone_004'
  AND restaurant_id = 'a0000000-0000-0000-0000-000000000001'::uuid;

  -- Store for later tests
  PERFORM set_config('test.tombstone_id_4', v_tombstone_id::text, true);
END $$;

-- Test 19: Restore the transaction
SELECT is(
  (public.restore_deleted_transaction(
    (current_setting('test.tombstone_id_4'))::uuid,
    'a0000000-0000-0000-0000-000000000001'::uuid
  ))->>'success',
  'true',
  'restore_deleted_transaction should return success (Test 19)'
);

-- Test 20: Active row should exist again
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.bank_transactions
    WHERE restaurant_id = 'a0000000-0000-0000-0000-000000000001'::uuid
    AND stripe_transaction_id = 'stripe_txn_tombstone_004'
  ),
  'restored transaction should exist in bank_transactions (Test 20)'
);

-- Test 21: Tombstone should be removed
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.deleted_bank_transactions
    WHERE id = (current_setting('test.tombstone_id_4'))::uuid
  ),
  'tombstone should be removed after restore (Test 21)'
);

-- ============================================================
-- Test 22: Restore is idempotent (second call returns false)
-- ============================================================
SELECT is(
  (public.restore_deleted_transaction(
    (current_setting('test.tombstone_id_4'))::uuid,
    'a0000000-0000-0000-0000-000000000001'::uuid
  ))->>'success',
  'false',
  'second restore should return false (tombstone already removed) (Test 22)'
);

-- ============================================================
-- Test 23: Permanently delete tombstone removes it
-- ============================================================

-- Get tombstone ID for transaction 1 (deleted earlier)
DO $$
DECLARE
  v_tombstone_id UUID;
BEGIN
  SELECT id INTO v_tombstone_id
  FROM public.deleted_bank_transactions
  WHERE external_transaction_id = 'stripe_txn_tombstone_001'
  AND restaurant_id = 'a0000000-0000-0000-0000-000000000001'::uuid;

  PERFORM set_config('test.tombstone_id_1', v_tombstone_id::text, true);
END $$;

SELECT is(
  (public.permanently_delete_tombstone(
    (current_setting('test.tombstone_id_1'))::uuid,
    'a0000000-0000-0000-0000-000000000001'::uuid
  ))->>'success',
  'true',
  'permanently_delete_tombstone should return success (Test 23)'
);

-- Tombstone should be gone
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.deleted_bank_transactions
    WHERE id = (current_setting('test.tombstone_id_1'))::uuid
  ),
  'tombstone should be removed after permanent delete (Test 24 - verify)'
);

-- ============================================================
-- Test 25: Bulk delete creates tombstones for multiple transactions
-- ============================================================
SELECT is(
  (public.bulk_delete_bank_transactions(
    ARRAY['c0000000-0000-0000-0000-000000000002'::uuid, 'c0000000-0000-0000-0000-000000000003'::uuid],
    'a0000000-0000-0000-0000-000000000001'::uuid
  ))->>'success',
  'true',
  'bulk_delete_bank_transactions should return success (Test 25)'
);

-- Test 26: Tombstones exist for bulk-deleted transactions
SELECT is(
  (SELECT count(*)::int FROM public.deleted_bank_transactions
   WHERE restaurant_id = 'a0000000-0000-0000-0000-000000000001'::uuid
   AND external_transaction_id IN ('stripe_txn_tombstone_002', 'stripe_txn_tombstone_003')),
  2,
  'tombstones should exist for both bulk-deleted transactions (Test 26)'
);

-- Test 27: Active rows removed for bulk-deleted transactions
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.bank_transactions
    WHERE id IN ('c0000000-0000-0000-0000-000000000002'::uuid, 'c0000000-0000-0000-0000-000000000003'::uuid)
  ),
  'active rows should be removed after bulk delete (Test 27)'
);

-- ============================================================
-- Cleanup
-- ============================================================
SELECT * FROM finish();
ROLLBACK;
