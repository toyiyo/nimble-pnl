-- Tests get_expense_health_metrics (cluster 6 special aggregate: six sums
-- in one call).
-- SECURITY INVOKER: RLS on bank_transactions and chart_of_accounts scopes
-- the caller, so a non-member sees an all-zero row rather than an error.
--
-- One fixture, one date range (2026-05-01..2026-05-10), restaurant
-- 00000000-0000-0000-0000-000000000400:
--   05-01  Sales Deposit           1000.00  posted  no category
--   05-02  Food Vendor Payment     -200.00  posted  Food Supplies (cost_of_goods_sold)
--   05-03  Payroll Run             -300.00  posted  Payroll Expense (payroll)
--   05-04  STRIPE FEE               -15.00  posted  Card Processing Fees (operating_expenses)
--   05-05  Misc Purchase            -50.00  posted  no category, not split
--   05-06  Voided Transaction     -9999.00  void    no category (must be excluded)
--   05-07  STRIPE MONTHLY FEE       -25.00  posted  no category, not split
--
-- The 05-04 fee row carries its own category, so it lands only in
-- processing_fees. The 05-07 fee row carries NO category, so it lands in
-- BOTH processing_fees and uncategorized_spend at once — the two columns
-- are independent FILTER predicates, not mutually exclusive, and this
-- row pins that overlap as intended behavior.
--
-- Assertions:
--   1. revenue sums the one positive row (1000.00).
--   2. food_cost sums the cost_of_goods_sold-category outflow (200.00).
--   3. labor_cost sums the payroll-category outflow (300.00).
--   4. processing_fees sums both outflows matching '%stripe%'
--      (15 + 25 = 40.00), case-insensitively.
--   5. total_outflows sums every posted/pending negative row
--      (200 + 300 + 15 + 50 + 25 = 590.00); the void row is excluded.
--   6. uncategorized_spend sums both uncategorized, non-split outflows
--      (50 + 25 = 75.00) — including the fee-matched 05-07 row.
--   7. Tenancy: a non-member gets an all-zero row for a foreign
--      restaurant that holds a real transaction.

BEGIN;
SELECT plan(7);

-- Fixtures insert as the session role (postgres, BYPASSRLS). RLS stays on.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000402'::uuid, 'expense-health-member@example.com')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-000000000400'::uuid, 'Expense Health Test Restaurant'),
  ('00000000-0000-0000-0000-000000000401'::uuid, 'Expense Health Foreign Restaurant')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- The member belongs only to the primary restaurant, not the foreign one.
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000402'::uuid,
   '00000000-0000-0000-0000-000000000400'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO connected_banks (id, restaurant_id, stripe_financial_account_id, institution_name) VALUES
  ('00000000-0000-0000-0000-000000000403'::uuid,
   '00000000-0000-0000-0000-000000000400'::uuid, 'fca_expense_health_test', 'Expense Health Test Bank'),
  ('00000000-0000-0000-0000-000000000404'::uuid,
   '00000000-0000-0000-0000-000000000401'::uuid, 'fca_expense_health_foreign', 'Expense Health Foreign Bank')
ON CONFLICT (id) DO UPDATE SET institution_name = EXCLUDED.institution_name;

-- Three categories on the primary restaurant: one matches the food
-- keyword rule, one matches the labor keyword rule, one is a plain
-- operating expense so the fee row does not also count as uncategorized.
INSERT INTO chart_of_accounts
  (id, restaurant_id, account_code, account_name, account_type, account_subtype, normal_balance)
VALUES
  ('00000000-0000-0000-0000-000000000405'::uuid,
   '00000000-0000-0000-0000-000000000400'::uuid, '5100', 'Food Supplies', 'expense', 'cost_of_goods_sold', 'debit'),
  ('00000000-0000-0000-0000-000000000406'::uuid,
   '00000000-0000-0000-0000-000000000400'::uuid, '6100', 'Payroll Expense', 'expense', 'payroll', 'debit'),
  ('00000000-0000-0000-0000-000000000407'::uuid,
   '00000000-0000-0000-0000-000000000400'::uuid, '6200', 'Card Processing Fees', 'expense', 'operating_expenses', 'debit')
ON CONFLICT (id) DO UPDATE SET account_name = EXCLUDED.account_name;

INSERT INTO bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date,
   description, amount, status, category_id, is_split)
VALUES
  ('00000000-0000-0000-0000-000000000408'::uuid,
   '00000000-0000-0000-0000-000000000400'::uuid, '00000000-0000-0000-0000-000000000403'::uuid,
   'expense-health-test-408', '2026-05-01', 'Sales Deposit', 1000.00, 'posted', NULL, FALSE),
  ('00000000-0000-0000-0000-000000000409'::uuid,
   '00000000-0000-0000-0000-000000000400'::uuid, '00000000-0000-0000-0000-000000000403'::uuid,
   'expense-health-test-409', '2026-05-02', 'Food Vendor Payment', -200.00, 'posted',
   '00000000-0000-0000-0000-000000000405'::uuid, FALSE),
  ('00000000-0000-0000-0000-000000000410'::uuid,
   '00000000-0000-0000-0000-000000000400'::uuid, '00000000-0000-0000-0000-000000000403'::uuid,
   'expense-health-test-410', '2026-05-03', 'Payroll Run', -300.00, 'posted',
   '00000000-0000-0000-0000-000000000406'::uuid, FALSE),
  ('00000000-0000-0000-0000-000000000411'::uuid,
   '00000000-0000-0000-0000-000000000400'::uuid, '00000000-0000-0000-0000-000000000403'::uuid,
   'expense-health-test-411', '2026-05-04', 'STRIPE FEE', -15.00, 'posted',
   '00000000-0000-0000-0000-000000000407'::uuid, FALSE),
  ('00000000-0000-0000-0000-000000000412'::uuid,
   '00000000-0000-0000-0000-000000000400'::uuid, '00000000-0000-0000-0000-000000000403'::uuid,
   'expense-health-test-412', '2026-05-05', 'Misc Purchase', -50.00, 'posted', NULL, FALSE),
  ('00000000-0000-0000-0000-000000000413'::uuid,
   '00000000-0000-0000-0000-000000000400'::uuid, '00000000-0000-0000-0000-000000000403'::uuid,
   'expense-health-test-413', '2026-05-06', 'Voided Transaction', -9999.00, 'void', NULL, FALSE),
  -- Overlap row: matches the '%stripe%' fee pattern AND has no category
  -- and is not split. This is intended behavior — processing_fees and
  -- uncategorized_spend are independent FILTER predicates over the same
  -- rows, not mutually exclusive buckets. This row must count in both.
  ('00000000-0000-0000-0000-000000000415'::uuid,
   '00000000-0000-0000-0000-000000000400'::uuid, '00000000-0000-0000-0000-000000000403'::uuid,
   'expense-health-test-415', '2026-05-07', 'STRIPE MONTHLY FEE', -25.00, 'posted', NULL, FALSE),
  ('00000000-0000-0000-0000-000000000414'::uuid,
   '00000000-0000-0000-0000-000000000401'::uuid, '00000000-0000-0000-0000-000000000404'::uuid,
   'expense-health-test-414', '2026-05-01', 'Foreign Restaurant Deposit', 777.00, 'posted', NULL, FALSE)
ON CONFLICT (id) DO UPDATE SET
  amount = EXCLUDED.amount,
  status = EXCLUDED.status,
  category_id = EXCLUDED.category_id;

-- Run as the real caller role, authenticated, with RLS active.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000402","role":"authenticated"}';

-- Test 1: revenue sums the one positive row.
SELECT is(
  (SELECT revenue FROM get_expense_health_metrics(
     '00000000-0000-0000-0000-000000000400'::uuid,
     '2026-05-01'::date, '2026-05-10'::date, ARRAY['%stripe%'])),
  1000.00::numeric,
  'revenue sums the one positive row (1000.00)'
);

-- Test 2: food_cost sums the cost_of_goods_sold-category outflow.
SELECT is(
  (SELECT food_cost FROM get_expense_health_metrics(
     '00000000-0000-0000-0000-000000000400'::uuid,
     '2026-05-01'::date, '2026-05-10'::date, ARRAY['%stripe%'])),
  200.00::numeric,
  'food_cost sums the cost_of_goods_sold-category outflow (200.00)'
);

-- Test 3: labor_cost sums the payroll-category outflow.
SELECT is(
  (SELECT labor_cost FROM get_expense_health_metrics(
     '00000000-0000-0000-0000-000000000400'::uuid,
     '2026-05-01'::date, '2026-05-10'::date, ARRAY['%stripe%'])),
  300.00::numeric,
  'labor_cost sums the payroll-category outflow (300.00)'
);

-- Test 4: processing_fees matches '%stripe%' case-insensitively against
-- both fee rows: the categorized 'STRIPE FEE' (15.00) and the
-- uncategorized 'STRIPE MONTHLY FEE' (25.00). processing_fees does not
-- care about category_id, so both count.
SELECT is(
  (SELECT processing_fees FROM get_expense_health_metrics(
     '00000000-0000-0000-0000-000000000400'::uuid,
     '2026-05-01'::date, '2026-05-10'::date, ARRAY['%stripe%'])),
  40.00::numeric,
  'processing_fees matches ''%stripe%'' case-insensitively over both fee rows (40.00)'
);

-- Test 5: total_outflows sums every posted/pending negative row
-- (200 + 300 + 15 + 50 + 25); the void row (9999.00) is excluded.
SELECT is(
  (SELECT total_outflows FROM get_expense_health_metrics(
     '00000000-0000-0000-0000-000000000400'::uuid,
     '2026-05-01'::date, '2026-05-10'::date, ARRAY['%stripe%'])),
  590.00::numeric,
  'total_outflows sums posted/pending outflows and excludes the void row (590.00)'
);

-- Test 6: uncategorized_spend sums both uncategorized, non-split
-- outflows (Misc Purchase 50.00 and STRIPE MONTHLY FEE 25.00). The
-- categorized 'STRIPE FEE' row does not count here, but the
-- uncategorized 'STRIPE MONTHLY FEE' row counts in BOTH this column
-- and processing_fees — the two columns are not mutually exclusive.
SELECT is(
  (SELECT uncategorized_spend FROM get_expense_health_metrics(
     '00000000-0000-0000-0000-000000000400'::uuid,
     '2026-05-01'::date, '2026-05-10'::date, ARRAY['%stripe%'])),
  75.00::numeric,
  'uncategorized_spend sums both uncategorized, non-split outflows, including the fee-matched row (75.00)'
);

-- Test 7: tenancy. A non-member gets an all-zero row for the foreign
-- restaurant even though it holds a real transaction (777.00) — RLS
-- hides it.
SELECT results_eq(
  $$ SELECT revenue, food_cost, labor_cost, processing_fees, total_outflows, uncategorized_spend
     FROM get_expense_health_metrics(
       '00000000-0000-0000-0000-000000000401'::uuid,
       '2026-05-01'::date, '2026-05-10'::date, ARRAY['%stripe%']) $$,
  $$ VALUES (0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric) $$,
  'A non-member gets an all-zero row for a foreign restaurant with real transaction data'
);

RESET ROLE;
RESET request.jwt.claims;

SELECT * FROM finish();
ROLLBACK;
