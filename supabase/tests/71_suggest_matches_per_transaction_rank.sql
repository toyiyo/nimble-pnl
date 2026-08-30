-- Tests for suggest_pending_outflow_matches per-transaction ranking.
-- Migration: 20260830100400_suggest_matches_per_transaction_rank.sql
--
-- The old body cut the whole restaurant cross-product at 100 rows. A
-- transaction below the global cut lost every suggestion. The new body
-- keeps the top 3 outflows per transaction. Scenario 2 pins the
-- regression: 101 high-score pairs on one transaction must not starve
-- the single low-score pair on another transaction.

BEGIN;
SELECT plan(10);

SET LOCAL role TO postgres;

-- Fixtures -------------------------------------------------------------------
INSERT INTO restaurants (id, name, timezone) VALUES
  ('00000000-0000-0000-0000-000000071000'::uuid, 'Suggest Rank Restaurant', 'America/Chicago')
ON CONFLICT (id) DO UPDATE SET timezone = 'America/Chicago';

INSERT INTO chart_of_accounts (id, restaurant_id, account_code, account_name, account_type, account_subtype, normal_balance, is_active) VALUES
  ('00000000-0000-0000-0000-000000071002'::uuid, '00000000-0000-0000-0000-000000071000'::uuid, '6000', 'Food Cost', 'expense', 'operating_expenses', 'debit', true)
ON CONFLICT (id) DO UPDATE SET is_active = true;

INSERT INTO connected_banks (id, restaurant_id, stripe_financial_account_id, institution_name, status) VALUES
  ('00000000-0000-0000-0000-000000071010'::uuid, '00000000-0000-0000-0000-000000071000'::uuid, 'fa_test_rank_001', 'Test Bank', 'connected')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000071090'::uuid, 'rank-owner@example.com'),
  ('00000000-0000-0000-0000-000000071093'::uuid, 'rank-outsider@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000071090'::uuid, '00000000-0000-0000-0000-000000071000'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- Scenario 1: per-transaction cap --------------------------------------------
-- One transaction at -500.00 with four candidate outflows. Scores with a
-- same-window date bonus (+15) and no vendor bonus:
--   500.00 -> 75, 500.50 -> 60, 501.00 -> 35, 504.00 -> 35.
-- The 501.00/504.00 tie breaks on the smaller amount delta. The function
-- must keep 500.00, 500.50, 501.00 and drop 504.00.
INSERT INTO pending_outflows (id, restaurant_id, vendor_name, category_id, payment_method, amount, issue_date, status) VALUES
  ('00000000-0000-0000-0000-000000071101'::uuid, '00000000-0000-0000-0000-000000071000'::uuid,
   'Acme Supply', '00000000-0000-0000-0000-000000071002'::uuid, 'ach', 500.00, CURRENT_DATE - 1, 'pending'),
  ('00000000-0000-0000-0000-000000071102'::uuid, '00000000-0000-0000-0000-000000071000'::uuid,
   'Acme Supply', '00000000-0000-0000-0000-000000071002'::uuid, 'ach', 500.50, CURRENT_DATE - 1, 'pending'),
  ('00000000-0000-0000-0000-000000071103'::uuid, '00000000-0000-0000-0000-000000071000'::uuid,
   'Acme Supply', '00000000-0000-0000-0000-000000071002'::uuid, 'ach', 501.00, CURRENT_DATE - 1, 'pending'),
  ('00000000-0000-0000-0000-000000071104'::uuid, '00000000-0000-0000-0000-000000071000'::uuid,
   'Acme Supply', '00000000-0000-0000-0000-000000071002'::uuid, 'ach', 504.00, CURRENT_DATE - 1, 'pending');

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, is_transfer, is_split, is_reconciled) VALUES
  ('00000000-0000-0000-0000-000000071110'::uuid, '00000000-0000-0000-0000-000000071000'::uuid,
   '00000000-0000-0000-0000-000000071010'::uuid, 'txn-rank-cap',
   now(), -500.00, 'CHECK 1234', NULL, 'posted', false, false, false, false);

-- Scenario 2: no starvation across transactions ------------------------------
-- 101 outflows at 600.00 pair with transaction A at -600.00, each with
-- score 75. One outflow at 909.00 pairs with transaction B at -900.00
-- with score 35. The old global LIMIT 100 dropped the transaction-B row.
INSERT INTO pending_outflows (id, restaurant_id, vendor_name, category_id, payment_method, amount, issue_date, status)
SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000071000'::uuid,
       'Bulk Vendor ' || i, '00000000-0000-0000-0000-000000071002'::uuid, 'ach', 600.00, CURRENT_DATE - 1, 'pending'
FROM generate_series(1, 101) AS i;

INSERT INTO pending_outflows (id, restaurant_id, vendor_name, category_id, payment_method, amount, issue_date, status) VALUES
  ('00000000-0000-0000-0000-000000071201'::uuid, '00000000-0000-0000-0000-000000071000'::uuid,
   'Solo Vendor', '00000000-0000-0000-0000-000000071002'::uuid, 'ach', 909.00, CURRENT_DATE - 1, 'pending');

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, is_transfer, is_split, is_reconciled) VALUES
  ('00000000-0000-0000-0000-000000071210'::uuid, '00000000-0000-0000-0000-000000071000'::uuid,
   '00000000-0000-0000-0000-000000071010'::uuid, 'txn-rank-bulk',
   now(), -600.00, 'WIRE OUT 600', NULL, 'posted', false, false, false, false),
  ('00000000-0000-0000-0000-000000071211'::uuid, '00000000-0000-0000-0000-000000071000'::uuid,
   '00000000-0000-0000-0000-000000071010'::uuid, 'txn-rank-solo',
   now(), -900.00, 'WIRE OUT 900', NULL, 'posted', false, false, false, false);

-- Function shape and grants ---------------------------------------------------
SELECT has_function('public', 'suggest_pending_outflow_matches', ARRAY['uuid', 'uuid'],
  'suggest_pending_outflow_matches(uuid, uuid) exists');
SELECT ok(
  has_function_privilege('authenticated', 'public.suggest_pending_outflow_matches(uuid, uuid)', 'EXECUTE'),
  'authenticated can execute suggest_pending_outflow_matches');

-- Authorization ---------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000071093","role":"authenticated"}', true);
SELECT throws_like(
  $$ SELECT * FROM suggest_pending_outflow_matches('00000000-0000-0000-0000-000000071000'::uuid) $$,
  '%Access denied%',
  'an outside user gets an access-denied error');

-- Ranked results --------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000071090","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM suggest_pending_outflow_matches('00000000-0000-0000-0000-000000071000'::uuid) m
   WHERE m.bank_transaction_id = '00000000-0000-0000-0000-000000071110'::uuid),
  3, 'scenario 1: the cap keeps 3 rows for the transaction');

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM suggest_pending_outflow_matches('00000000-0000-0000-0000-000000071000'::uuid) m
    WHERE m.bank_transaction_id = '00000000-0000-0000-0000-000000071110'::uuid
      AND m.pending_outflow_id = '00000000-0000-0000-0000-000000071104'::uuid),
  'scenario 1: the lowest-ranked outflow (504.00) is dropped');

SELECT ok(
  EXISTS (
    SELECT 1 FROM suggest_pending_outflow_matches('00000000-0000-0000-0000-000000071000'::uuid) m
    WHERE m.bank_transaction_id = '00000000-0000-0000-0000-000000071110'::uuid
      AND m.pending_outflow_id = '00000000-0000-0000-0000-000000071101'::uuid),
  'scenario 1: the exact-amount outflow (500.00) is kept');

SELECT is(
  (SELECT count(*)::int FROM suggest_pending_outflow_matches('00000000-0000-0000-0000-000000071000'::uuid) m
   WHERE m.bank_transaction_id = '00000000-0000-0000-0000-000000071210'::uuid),
  3, 'scenario 2: 101 candidates cap at 3 rows for the bulk transaction');

SELECT is(
  (SELECT count(*)::int FROM suggest_pending_outflow_matches('00000000-0000-0000-0000-000000071000'::uuid) m
   WHERE m.bank_transaction_id = '00000000-0000-0000-0000-000000071211'::uuid),
  1, 'scenario 2: the low-score pair on the other transaction survives');

-- Per-outflow path ------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM suggest_pending_outflow_matches(
     '00000000-0000-0000-0000-000000071000'::uuid,
     '00000000-0000-0000-0000-000000071201'::uuid)),
  1, 'per-outflow path: one row for the requested outflow');

SELECT is(
  (SELECT m.bank_transaction_id FROM suggest_pending_outflow_matches(
     '00000000-0000-0000-0000-000000071000'::uuid,
     '00000000-0000-0000-0000-000000071201'::uuid) m),
  '00000000-0000-0000-0000-000000071211'::uuid,
  'per-outflow path: the row points at the matching transaction');

SELECT * FROM finish();
ROLLBACK;
