-- pgTAP coverage for Phase 4 Task 1 of the bank re-authentication flow
-- (docs/superpowers/specs/2026-07-23-bank-reauth-flow-design.md §3.1).
--
-- Migration under test: 20260723130000_connected_banks_reauth_columns.sql
--
-- Covers:
--   1. connected_banks gains account_mask/deactivated_at/data_current_through,
--      correctly typed (timestamptz, not date).
--   2. connected_banks_identity_uniq rejects a second *live* row sharing
--      (restaurant_id, institution_name, account_mask).
--   3. That index does NOT block multiple 'disconnected' rows on the same
--      tuple (the predicate excludes them).
--   4. NULL account_mask rows never conflict (NULLs are distinct in a unique
--      index) — the legacy/unknown-mask path.
--   5. idx_bank_transactions_bank_date exists, supporting the
--      data_current_through recompute in Task 6.

BEGIN;

SELECT plan(15);

SET LOCAL role TO postgres;

ALTER TABLE public.restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.connected_banks DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- Column existence + types
-- ============================================================

SELECT has_column(
  'public', 'connected_banks', 'account_mask',
  'connected_banks should have account_mask column'
);

SELECT col_type_is(
  'public', 'connected_banks', 'account_mask', 'text',
  'account_mask should be TEXT'
);

SELECT has_column(
  'public', 'connected_banks', 'deactivated_at',
  'connected_banks should have deactivated_at column'
);

SELECT col_type_is(
  'public', 'connected_banks', 'deactivated_at', 'timestamp with time zone',
  'deactivated_at should be TIMESTAMPTZ'
);

SELECT has_column(
  'public', 'connected_banks', 'data_current_through',
  'connected_banks should have data_current_through column'
);

SELECT col_type_is(
  'public', 'connected_banks', 'data_current_through', 'timestamp with time zone',
  'data_current_through should be TIMESTAMPTZ, not DATE (design §3.1 correction)'
);

-- ============================================================
-- Indexes
-- ============================================================

SELECT has_index(
  'public', 'connected_banks', 'connected_banks_identity_uniq',
  'connected_banks should have the connected_banks_identity_uniq partial unique index'
);

SELECT has_index(
  'public', 'bank_transactions', 'idx_bank_transactions_bank_date',
  'bank_transactions should have idx_bank_transactions_bank_date for the data_current_through recompute'
);

-- ============================================================
-- Behavioral coverage of the partial unique index
-- ============================================================

CREATE TEMP TABLE _ids AS
SELECT '00000000-0000-0000-0000-0000d0000001'::uuid AS r_one;

DELETE FROM public.connected_banks WHERE restaurant_id = (SELECT r_one FROM _ids);
DELETE FROM public.restaurants WHERE id = (SELECT r_one FROM _ids);

INSERT INTO public.restaurants (id, name, address, phone)
SELECT r_one, 'Reauth Identity Test', '1 Test Way', '555-0100' FROM _ids;

-- First live row inserts cleanly.
SELECT lives_ok(
  $$
    INSERT INTO public.connected_banks
      (restaurant_id, stripe_financial_account_id, institution_name, status, account_mask)
    SELECT r_one, 'fca_reauth_test_001', 'Chase', 'connected', '1234' FROM _ids
  $$,
  'first live row with (restaurant, institution, mask) inserts cleanly'
);

-- A second, distinct fca_ id with the same (restaurant, institution, mask)
-- tuple while still 'connected' must violate the partial unique index.
SELECT throws_ok(
  $$
    INSERT INTO public.connected_banks
      (restaurant_id, stripe_financial_account_id, institution_name, status, account_mask)
    SELECT r_one, 'fca_reauth_test_002', 'Chase', 'connected', '1234' FROM _ids
  $$,
  '23505',
  NULL,
  'a second live row on the same (restaurant, institution, mask) tuple raises unique_violation'
);

-- Same tuple, but 'requires_reauth' status — also live, must also conflict.
SELECT throws_ok(
  $$
    INSERT INTO public.connected_banks
      (restaurant_id, stripe_financial_account_id, institution_name, status, account_mask)
    SELECT r_one, 'fca_reauth_test_003', 'Chase', 'requires_reauth', '1234' FROM _ids
  $$,
  '23505',
  NULL,
  'a live requires_reauth row on the same tuple also raises unique_violation'
);

-- Any number of 'disconnected' rows on the same tuple are permitted — the
-- partial index predicate excludes status = 'disconnected'.
SELECT lives_ok(
  $$
    INSERT INTO public.connected_banks
      (restaurant_id, stripe_financial_account_id, institution_name, status, account_mask)
    SELECT r_one, 'fca_reauth_test_004', 'Chase', 'disconnected', '1234' FROM _ids
  $$,
  'first disconnected row on the same tuple inserts cleanly'
);

SELECT lives_ok(
  $$
    INSERT INTO public.connected_banks
      (restaurant_id, stripe_financial_account_id, institution_name, status, account_mask)
    SELECT r_one, 'fca_reauth_test_005', 'Chase', 'disconnected', '1234' FROM _ids
  $$,
  'a second disconnected row on the same tuple also inserts cleanly (index predicate excludes disconnected)'
);

-- Two rows with NULL account_mask at the same institution both insert —
-- NULLs are distinct in a unique index, so this never conflicts. This is the
-- legacy/unknown-mask path.
SELECT lives_ok(
  $$
    INSERT INTO public.connected_banks
      (restaurant_id, stripe_financial_account_id, institution_name, status, account_mask)
    SELECT r_one, 'fca_reauth_test_006', 'Wells Fargo', 'connected', NULL FROM _ids
  $$,
  'first NULL-mask row inserts cleanly'
);

SELECT lives_ok(
  $$
    INSERT INTO public.connected_banks
      (restaurant_id, stripe_financial_account_id, institution_name, status, account_mask)
    SELECT r_one, 'fca_reauth_test_007', 'Wells Fargo', 'connected', NULL FROM _ids
  $$,
  'second NULL-mask row at the same institution also inserts cleanly (NULLs are distinct)'
);

-- Cleanup
DELETE FROM public.connected_banks WHERE restaurant_id = (SELECT r_one FROM _ids);
DELETE FROM public.restaurants WHERE id = (SELECT r_one FROM _ids);

SELECT * FROM finish();
ROLLBACK;
