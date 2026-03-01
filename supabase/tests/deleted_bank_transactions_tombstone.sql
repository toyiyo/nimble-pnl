-- File: supabase/tests/deleted_bank_transactions_tombstone.sql
-- Description: Tests for deleted_bank_transactions tombstone table and
--              compute_transaction_fingerprint function

BEGIN;
SELECT plan(12);

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
-- Cleanup
-- ============================================================
SELECT * FROM finish();
ROLLBACK;
