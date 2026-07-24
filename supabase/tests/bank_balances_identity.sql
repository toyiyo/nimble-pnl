-- pgTAP coverage for the bank_account_balances identity fix
-- (migration 20260724180200_bank_balances_rekey_connected_bank.sql).
--
-- ROOT CAUSE this migration fixes (production incident 2026-07-24):
--   bank_account_balances was unique on stripe_financial_account_id. Stripe
--   mints a NEW fca_ id per account on every reconnect, so the fca-keyed
--   upserts INSERTED a second row instead of updating the first. Two accounts
--   became four rows, and the orphaned old-fca row then re-flagged the bank
--   requires_reauth. The real key is connected_bank_id (1:1 with an account).
--
-- Covers:
--   1. The new UNIQUE index on connected_bank_id exists.
--   2. The old fca uniqueness is gone (fca is now a mutable attribute).
--   3. A second balance row for the same connected_bank_id raises 23505 —
--      the duplicate a reconnect used to create is now structurally impossible.
--   4. An upsert keyed on connected_bank_id ROTATES the fca in place across a
--      reconnect, leaving exactly one row (the fix the edge functions now use).
--   5. A plain (non-unique) index on stripe_financial_account_id survives for
--      lookups.

BEGIN;

SELECT plan(7);

SET LOCAL role TO postgres;

ALTER TABLE public.restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.connected_banks DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_account_balances DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- Index shape
-- ============================================================

SELECT has_index(
  'public', 'bank_account_balances', 'bank_account_balances_connected_bank_uniq',
  'bank_account_balances should have the connected_bank_id unique index (the 1:1 key)'
);

SELECT hasnt_index(
  'public', 'bank_account_balances', 'bank_account_balances_stripe_account_unique',
  'the old fca uniqueness index should be dropped — fca is now a mutable attribute'
);

SELECT has_index(
  'public', 'bank_account_balances', 'idx_bank_account_balances_stripe_account',
  'a plain (non-unique) index on stripe_financial_account_id should survive for lookups'
);

-- ============================================================
-- Behavioral coverage
-- ============================================================

CREATE TEMP TABLE _ids AS
SELECT '00000000-0000-0000-0000-0000b0000001'::uuid AS r_one;

DELETE FROM public.bank_account_balances
 WHERE connected_bank_id IN (
   SELECT id FROM public.connected_banks WHERE restaurant_id = (SELECT r_one FROM _ids)
 );
DELETE FROM public.connected_banks WHERE restaurant_id = (SELECT r_one FROM _ids);
DELETE FROM public.restaurants WHERE id = (SELECT r_one FROM _ids);

INSERT INTO public.restaurants (id, name, address, phone)
SELECT r_one, 'Balance Identity Test', '1 Test Way', '555-0100' FROM _ids;

INSERT INTO public.connected_banks
  (restaurant_id, stripe_financial_account_id, institution_name, status, account_mask)
SELECT r_one, 'fca_bal_test_new', 'Huntington', 'connected', '2589' FROM _ids;

CREATE TEMP TABLE _bank AS
SELECT id AS bank_id FROM public.connected_banks
 WHERE restaurant_id = (SELECT r_one FROM _ids) AND account_mask = '2589';

-- First balance row inserts cleanly.
SELECT lives_ok(
  $$
    INSERT INTO public.bank_account_balances
      (connected_bank_id, account_name, stripe_financial_account_id, current_balance)
    SELECT bank_id, 'Huntington Business Checking 100', 'fca_bal_test_old', 48679.81 FROM _bank
  $$,
  'first balance row for a connected bank inserts cleanly'
);

-- A second row for the SAME connected_bank_id with a DIFFERENT fca — exactly
-- the duplicate the pre-fix reconnect created — must now violate the unique
-- index.
SELECT throws_ok(
  $$
    INSERT INTO public.bank_account_balances
      (connected_bank_id, account_name, stripe_financial_account_id, current_balance)
    SELECT bank_id, 'Huntington Business Checking 100', 'fca_bal_test_new', 39218.59 FROM _bank
  $$,
  '23505',
  NULL,
  'a second balance row for the same connected bank (new fca_) raises unique_violation — the reconnect duplicate is now impossible'
);

-- The fix the edge functions use: upsert keyed on connected_bank_id rotates
-- the fca in place instead of inserting. One row survives, tracking the new
-- fca and the fresh balance.
SELECT lives_ok(
  $$
    INSERT INTO public.bank_account_balances
      (connected_bank_id, account_name, stripe_financial_account_id, current_balance)
    SELECT bank_id, 'Huntington Business Checking 100', 'fca_bal_test_new', 39218.59 FROM _bank
    ON CONFLICT (connected_bank_id) DO UPDATE
      SET stripe_financial_account_id = EXCLUDED.stripe_financial_account_id,
          current_balance = EXCLUDED.current_balance
  $$,
  'a reconnect upsert keyed on connected_bank_id rotates the fca in place (no 23505)'
);

SELECT is(
  (SELECT count(*)::int FROM public.bank_account_balances b
     JOIN _bank ON b.connected_bank_id = _bank.bank_id),
  1,
  'after the reconnect upsert exactly one balance row remains for the connected bank (1:1 restored)'
);

-- Cleanup
DELETE FROM public.bank_account_balances
 WHERE connected_bank_id IN (SELECT bank_id FROM _bank);
DELETE FROM public.connected_banks WHERE restaurant_id = (SELECT r_one FROM _ids);
DELETE FROM public.restaurants WHERE id = (SELECT r_one FROM _ids);

SELECT * FROM finish();
ROLLBACK;
