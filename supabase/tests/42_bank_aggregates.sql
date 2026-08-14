-- Tests get_bank_transaction_summary, get_bank_spending_by_category, and
-- get_bank_transactions_daily (cluster 6 bank aggregates).
-- All three RPCs run as SECURITY INVOKER: RLS on bank_transactions scopes
-- the caller, so a non-member sees a zero-value row rather than an error
-- (summary uses aggregates without GROUP BY, which always return one row).
--
-- Assertions:
--   1. Summary splits inflow/outflow/net over a mixed 4-row fixture.
--   2. p_statuses => ARRAY['posted'] excludes a pending row; NULL includes it.
--   3. p_bank_account_id filters on connected_bank_id (spec section 11.1 item 1):
--      two banks on the same restaurant, scoped independently.
--   4. Spending-by-category groups two negative rows under one category;
--      a positive row in the same category is excluded.
--   5. An uncategorized negative row lands in the 'Uncategorized' bucket.
--   6. Daily series has one row per day with the right net; a day with no
--      transactions produces no row (not a zero-filled row).
--   7. Summary returns one all-zero row for an empty range (COALESCE guard).
--   8. Tenancy: a non-member gets a zero-value row for a foreign restaurant
--      that holds real transaction data.

BEGIN;
SELECT plan(8);

-- Fixtures insert as the session role (postgres, BYPASSRLS). RLS stays on.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000292'::uuid, 'bank-aggregates-member@example.com')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-000000000290'::uuid, 'Bank Aggregates Test Restaurant'),
  ('00000000-0000-0000-0000-000000000291'::uuid, 'Bank Aggregates Foreign Restaurant')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- The member belongs only to the primary restaurant, not the foreign one.
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000292'::uuid,
   '00000000-0000-0000-0000-000000000290'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- Two connected banks on the primary restaurant (assertion 3 scopes between
-- them) and one on the foreign restaurant (assertion 8).
INSERT INTO connected_banks (id, restaurant_id, stripe_financial_account_id, institution_name) VALUES
  ('00000000-0000-0000-0000-000000000293'::uuid,
   '00000000-0000-0000-0000-000000000290'::uuid, 'fca_bank_agg_test_a', 'Bank Aggregates Test Bank A'),
  ('00000000-0000-0000-0000-000000000294'::uuid,
   '00000000-0000-0000-0000-000000000290'::uuid, 'fca_bank_agg_test_b', 'Bank Aggregates Test Bank B'),
  ('00000000-0000-0000-0000-000000000295'::uuid,
   '00000000-0000-0000-0000-000000000291'::uuid, 'fca_bank_agg_test_foreign', 'Bank Aggregates Foreign Bank')
ON CONFLICT (id) DO UPDATE SET institution_name = EXCLUDED.institution_name;

-- One expense category for the primary restaurant (assertions 4 and 5).
INSERT INTO chart_of_accounts
  (id, restaurant_id, account_code, account_name, account_type, account_subtype, normal_balance)
VALUES
  ('00000000-0000-0000-0000-000000000296'::uuid,
   '00000000-0000-0000-0000-000000000290'::uuid, '5100', 'Food Supplies', 'expense', 'cost_of_goods_sold', 'debit')
ON CONFLICT (id) DO UPDATE SET account_name = EXCLUDED.account_name;

-- Bank transactions, one isolated date window per assertion so fixtures
-- never bleed into each other:
--   2026-05-01..04 (assertion 1): two inflows (500, 300), two outflows
--     (100, 50), all posted, bank A.
--   2026-05-10 (assertion 2): a posted row (200) and a pending row (300),
--     bank A.
--   2026-05-15 (assertion 3): a row on bank A (1000) and a row on bank B
--     (2000), same restaurant and day.
--   2026-05-20 (assertion 4): two negative rows (-40, -60) and one positive
--     row (500), all under the Food Supplies category.
--   2026-05-21 (assertion 5): one negative row (-75), no category.
--   2026-05-25..26 (assertion 6): day 1 has an inflow (100) and an outflow
--     (30); day 2 has an inflow only (50); day 3 (05-27) has no rows.
--   2026-05-01 on the foreign restaurant (assertion 8): a real inflow (999)
--     the non-member must not see.
INSERT INTO bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date,
   description, amount, status, category_id)
VALUES
  ('00000000-0000-0000-0000-000000000297'::uuid,
   '00000000-0000-0000-0000-000000000290'::uuid, '00000000-0000-0000-0000-000000000293'::uuid,
   'bank-agg-test-297', '2026-05-01', 'Deposit 1', 500.00, 'posted', NULL),
  ('00000000-0000-0000-0000-000000000298'::uuid,
   '00000000-0000-0000-0000-000000000290'::uuid, '00000000-0000-0000-0000-000000000293'::uuid,
   'bank-agg-test-298', '2026-05-02', 'Deposit 2', 300.00, 'posted', NULL),
  ('00000000-0000-0000-0000-000000000299'::uuid,
   '00000000-0000-0000-0000-000000000290'::uuid, '00000000-0000-0000-0000-000000000293'::uuid,
   'bank-agg-test-299', '2026-05-03', 'Payment 1', -100.00, 'posted', NULL),
  ('00000000-0000-0000-0000-000000000300'::uuid,
   '00000000-0000-0000-0000-000000000290'::uuid, '00000000-0000-0000-0000-000000000293'::uuid,
   'bank-agg-test-300', '2026-05-04', 'Payment 2', -50.00, 'posted', NULL),
  ('00000000-0000-0000-0000-000000000301'::uuid,
   '00000000-0000-0000-0000-000000000290'::uuid, '00000000-0000-0000-0000-000000000293'::uuid,
   'bank-agg-test-301', '2026-05-10', 'Posted Deposit', 200.00, 'posted', NULL),
  ('00000000-0000-0000-0000-000000000302'::uuid,
   '00000000-0000-0000-0000-000000000290'::uuid, '00000000-0000-0000-0000-000000000293'::uuid,
   'bank-agg-test-302', '2026-05-10', 'Pending Deposit', 300.00, 'pending', NULL),
  ('00000000-0000-0000-0000-000000000303'::uuid,
   '00000000-0000-0000-0000-000000000290'::uuid, '00000000-0000-0000-0000-000000000293'::uuid,
   'bank-agg-test-303', '2026-05-15', 'Bank A Deposit', 1000.00, 'posted', NULL),
  ('00000000-0000-0000-0000-000000000304'::uuid,
   '00000000-0000-0000-0000-000000000290'::uuid, '00000000-0000-0000-0000-000000000294'::uuid,
   'bank-agg-test-304', '2026-05-15', 'Bank B Deposit', 2000.00, 'posted', NULL),
  ('00000000-0000-0000-0000-000000000305'::uuid,
   '00000000-0000-0000-0000-000000000290'::uuid, '00000000-0000-0000-0000-000000000293'::uuid,
   'bank-agg-test-305', '2026-05-20', 'Food Purchase 1', -40.00, 'posted',
   '00000000-0000-0000-0000-000000000296'::uuid),
  ('00000000-0000-0000-0000-000000000306'::uuid,
   '00000000-0000-0000-0000-000000000290'::uuid, '00000000-0000-0000-0000-000000000293'::uuid,
   'bank-agg-test-306', '2026-05-20', 'Food Purchase 2', -60.00, 'posted',
   '00000000-0000-0000-0000-000000000296'::uuid),
  ('00000000-0000-0000-0000-000000000307'::uuid,
   '00000000-0000-0000-0000-000000000290'::uuid, '00000000-0000-0000-0000-000000000293'::uuid,
   'bank-agg-test-307', '2026-05-20', 'Food Vendor Refund', 500.00, 'posted',
   '00000000-0000-0000-0000-000000000296'::uuid),
  ('00000000-0000-0000-0000-000000000308'::uuid,
   '00000000-0000-0000-0000-000000000290'::uuid, '00000000-0000-0000-0000-000000000293'::uuid,
   'bank-agg-test-308', '2026-05-21', 'Uncategorized Purchase', -75.00, 'posted', NULL),
  ('00000000-0000-0000-0000-000000000309'::uuid,
   '00000000-0000-0000-0000-000000000290'::uuid, '00000000-0000-0000-0000-000000000293'::uuid,
   'bank-agg-test-309', '2026-05-25', 'Daily Inflow Day 1', 100.00, 'posted', NULL),
  ('00000000-0000-0000-0000-000000000310'::uuid,
   '00000000-0000-0000-0000-000000000290'::uuid, '00000000-0000-0000-0000-000000000293'::uuid,
   'bank-agg-test-310', '2026-05-25', 'Daily Outflow Day 1', -30.00, 'posted', NULL),
  ('00000000-0000-0000-0000-000000000311'::uuid,
   '00000000-0000-0000-0000-000000000290'::uuid, '00000000-0000-0000-0000-000000000293'::uuid,
   'bank-agg-test-311', '2026-05-26', 'Daily Inflow Day 2', 50.00, 'posted', NULL),
  ('00000000-0000-0000-0000-000000000312'::uuid,
   '00000000-0000-0000-0000-000000000291'::uuid, '00000000-0000-0000-0000-000000000295'::uuid,
   'bank-agg-test-312', '2026-05-01', 'Foreign Restaurant Deposit', 999.00, 'posted', NULL)
ON CONFLICT (id) DO UPDATE SET
  amount = EXCLUDED.amount,
  status = EXCLUDED.status,
  category_id = EXCLUDED.category_id;

-- Run as the real caller role, authenticated, with RLS active.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000292","role":"authenticated"}';

-- Test 1: summary splits inflow/outflow/net over a mixed fixture.
-- inflow = 500 + 300 = 800; outflow = |{-100, -50}| = 150; net = 650;
-- tx_count = 4; inflow_count = 2; outflow_count = 2;
-- avg_inflow = 800/2 = 400; max_inflow = 500.
SELECT results_eq(
  $$ SELECT inflow, outflow, net, tx_count, inflow_count, outflow_count, avg_inflow, max_inflow
     FROM get_bank_transaction_summary(
       '00000000-0000-0000-0000-000000000290'::uuid,
       '2026-05-01'::date, '2026-05-04'::date) $$,
  $$ VALUES (800::numeric, 150::numeric, 650::numeric, 4::bigint, 2::bigint, 2::bigint, 400::numeric, 500::numeric) $$,
  'Summary splits inflow/outflow/net over a mixed 4-row fixture'
);

-- Test 2: p_statuses => ARRAY['posted'] excludes the pending row (300);
-- NULL includes it. Posted-only inflow = 200; NULL-status inflow = 500.
SELECT results_eq(
  $$ SELECT
       (SELECT inflow FROM get_bank_transaction_summary(
          '00000000-0000-0000-0000-000000000290'::uuid,
          '2026-05-10'::date, '2026-05-10'::date, NULL, ARRAY['posted'])),
       (SELECT inflow FROM get_bank_transaction_summary(
          '00000000-0000-0000-0000-000000000290'::uuid,
          '2026-05-10'::date, '2026-05-10'::date, NULL, NULL)) $$,
  $$ VALUES (200::numeric, 500::numeric) $$,
  'p_statuses => ARRAY[''posted''] excludes a pending row (200); NULL includes it (500)'
);

-- Test 3: p_bank_account_id filters on connected_bank_id. Two banks, same
-- restaurant and day: bank A has 1000, bank B has 2000.
SELECT results_eq(
  $$ SELECT
       (SELECT inflow FROM get_bank_transaction_summary(
          '00000000-0000-0000-0000-000000000290'::uuid,
          '2026-05-15'::date, '2026-05-15'::date, '00000000-0000-0000-0000-000000000293'::uuid)),
       (SELECT inflow FROM get_bank_transaction_summary(
          '00000000-0000-0000-0000-000000000290'::uuid,
          '2026-05-15'::date, '2026-05-15'::date, '00000000-0000-0000-0000-000000000294'::uuid)) $$,
  $$ VALUES (1000::numeric, 2000::numeric) $$,
  'p_bank_account_id filters on connected_bank_id: bank A (1000) and bank B (2000) scope independently'
);

-- Test 4: spending-by-category groups the two negative Food Supplies rows
-- (-40, -60 -> spend 100, tx_count 2); the positive row (500) in the same
-- category is excluded.
SELECT results_eq(
  $$ SELECT category_id, category_name, spend, tx_count
     FROM get_bank_spending_by_category(
       '00000000-0000-0000-0000-000000000290'::uuid,
       '2026-05-20'::date, '2026-05-20'::date) $$,
  $$ VALUES ('00000000-0000-0000-0000-000000000296'::uuid, 'Food Supplies'::text, 100::numeric, 2::bigint) $$,
  'Spending-by-category groups two negative rows (spend 100); a positive row in the same category is excluded'
);

-- Test 5: an uncategorized negative row lands in the Uncategorized bucket.
SELECT results_eq(
  $$ SELECT category_id, category_name, spend, tx_count
     FROM get_bank_spending_by_category(
       '00000000-0000-0000-0000-000000000290'::uuid,
       '2026-05-21'::date, '2026-05-21'::date) $$,
  $$ VALUES (NULL::uuid, 'Uncategorized'::text, 75::numeric, 1::bigint) $$,
  'An uncategorized negative row lands in the Uncategorized bucket'
);

-- Test 6: daily series has one row per day with the right net; the day
-- with no transactions (05-27) produces no row.
SELECT results_eq(
  $$ SELECT day, inflow, outflow, net
     FROM get_bank_transactions_daily(
       '00000000-0000-0000-0000-000000000290'::uuid,
       '2026-05-25'::date, '2026-05-27'::date) $$,
  $$ VALUES ('2026-05-25'::date, 100::numeric, 30::numeric, 70::numeric),
            ('2026-05-26'::date, 50::numeric, 0::numeric, 50::numeric) $$,
  'Daily series has one row per day with the right net; a day with no rows produces no row'
);

-- Test 7: an empty date range returns one all-zero row, not an empty
-- result (COALESCE guard on an aggregate without GROUP BY).
SELECT results_eq(
  $$ SELECT inflow, outflow, net, tx_count, inflow_count, outflow_count, avg_inflow, max_inflow
     FROM get_bank_transaction_summary(
       '00000000-0000-0000-0000-000000000290'::uuid,
       '2026-06-01'::date, '2026-06-30'::date) $$,
  $$ VALUES (0::numeric, 0::numeric, 0::numeric, 0::bigint, 0::bigint, 0::bigint, 0::numeric, 0::numeric) $$,
  'An empty date range returns one all-zero row, not an empty result'
);

-- Test 8: tenancy. A non-member gets a zero-value row for the foreign
-- restaurant even though it holds a real transaction (999) — RLS hides it.
SELECT results_eq(
  $$ SELECT inflow, outflow, net, tx_count, inflow_count, outflow_count, avg_inflow, max_inflow
     FROM get_bank_transaction_summary(
       '00000000-0000-0000-0000-000000000291'::uuid,
       '2026-05-01'::date, '2026-05-31'::date) $$,
  $$ VALUES (0::numeric, 0::numeric, 0::numeric, 0::bigint, 0::bigint, 0::bigint, 0::numeric, 0::numeric) $$,
  'A non-member gets a zero-value row for a foreign restaurant with real transaction data'
);

RESET ROLE;
RESET request.jwt.claims;

SELECT * FROM finish();
ROLLBACK;
