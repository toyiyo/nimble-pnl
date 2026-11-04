-- Tests get_journal_expense_total (cluster 4, OpEx aggregate).
-- The RPC runs as SECURITY INVOKER: RLS on journal_entries,
-- journal_entry_lines, and chart_of_accounts scopes the caller, so a
-- non-member sees a zero total rather than an error (no explicit guard).
--
-- Assertions:
--   1. Two expense-account lines net to SUM(debit_amount - credit_amount).
--   2. A revenue-account line does not contribute to the expense total.
--   3. An empty date range (no journal entries at all) returns 0, not NULL.
--   4. Tenancy: a non-member gets 0 for a restaurant with real expense
--      data — RLS hides the joined rows.

BEGIN;
SELECT plan(4);

-- Fixtures insert as the session role (postgres, BYPASSRLS). RLS stays on.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000261'::uuid, 'journal-expense-member@example.com')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-000000000260'::uuid, 'Journal Expense Total Test'),
  ('00000000-0000-0000-0000-000000000262'::uuid, 'Journal Expense Total Foreign Restaurant')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- The member belongs only to the primary restaurant, not the foreign one.
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000261'::uuid,
   '00000000-0000-0000-0000-000000000260'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- Chart of accounts: an expense and a revenue account for the primary
-- restaurant, and an expense account for the foreign restaurant.
INSERT INTO chart_of_accounts
  (id, restaurant_id, account_code, account_name, account_type, account_subtype, normal_balance)
VALUES
  ('00000000-0000-0000-0000-000000000263'::uuid,
   '00000000-0000-0000-0000-000000000260'::uuid, '5000', 'Rent Expense', 'expense', 'rent', 'debit'),
  ('00000000-0000-0000-0000-000000000264'::uuid,
   '00000000-0000-0000-0000-000000000260'::uuid, '4000', 'Food Sales', 'revenue', 'food_sales', 'credit'),
  ('00000000-0000-0000-0000-000000000270'::uuid,
   '00000000-0000-0000-0000-000000000262'::uuid, '5000', 'Rent Expense', 'expense', 'rent', 'debit')
ON CONFLICT (id) DO UPDATE SET account_name = EXCLUDED.account_name;

-- Journal entries:
--   JE 265 (primary restaurant, April) — two expense lines, assertion 1.
--   JE 268 (primary restaurant, May)   — one revenue line only, assertion 2.
--   JE 271 (foreign restaurant, April) — one expense line, real data that
--     RLS must hide from a non-member, assertion 4.
INSERT INTO journal_entries
  (id, restaurant_id, entry_number, entry_date, description, total_debit, total_credit)
VALUES
  ('00000000-0000-0000-0000-000000000265'::uuid,
   '00000000-0000-0000-0000-000000000260'::uuid, 'JE-260-001', '2026-04-15',
   'Two expense lines', 500, 200),
  ('00000000-0000-0000-0000-000000000268'::uuid,
   '00000000-0000-0000-0000-000000000260'::uuid, 'JE-260-002', '2026-05-15',
   'Revenue only, no expense lines', 0, 1000),
  ('00000000-0000-0000-0000-000000000271'::uuid,
   '00000000-0000-0000-0000-000000000262'::uuid, 'JE-262-001', '2026-04-15',
   'Foreign restaurant expense', 400, 0)
ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO journal_entry_lines
  (id, journal_entry_id, account_id, debit_amount, credit_amount)
VALUES
  ('00000000-0000-0000-0000-000000000266'::uuid,
   '00000000-0000-0000-0000-000000000265'::uuid,
   '00000000-0000-0000-0000-000000000263'::uuid, 500, 0),
  ('00000000-0000-0000-0000-000000000267'::uuid,
   '00000000-0000-0000-0000-000000000265'::uuid,
   '00000000-0000-0000-0000-000000000263'::uuid, 0, 200),
  ('00000000-0000-0000-0000-000000000269'::uuid,
   '00000000-0000-0000-0000-000000000268'::uuid,
   '00000000-0000-0000-0000-000000000264'::uuid, 0, 1000),
  ('00000000-0000-0000-0000-000000000272'::uuid,
   '00000000-0000-0000-0000-000000000271'::uuid,
   '00000000-0000-0000-0000-000000000270'::uuid, 400, 0)
ON CONFLICT (id) DO UPDATE SET
  debit_amount = EXCLUDED.debit_amount,
  credit_amount = EXCLUDED.credit_amount;

-- Run as the real caller role, authenticated, with RLS active.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000261","role":"authenticated"}';

-- Test 1: two expense-account lines net to SUM(debit_amount - credit_amount).
SELECT is(
  get_journal_expense_total(
    '00000000-0000-0000-0000-000000000260'::uuid,
    '2026-04-01'::date, '2026-04-30'::date),
  300::numeric,
  'Two expense lines net to debit minus credit: 500 - 200 = 300'
);

-- Test 2: a revenue-account line does not contribute to the expense total.
SELECT is(
  get_journal_expense_total(
    '00000000-0000-0000-0000-000000000260'::uuid,
    '2026-05-01'::date, '2026-05-31'::date),
  0::numeric,
  'A revenue-account line is excluded from the expense total'
);

-- Test 3: an empty date range (no journal entries at all) returns 0, not NULL.
SELECT is(
  get_journal_expense_total(
    '00000000-0000-0000-0000-000000000260'::uuid,
    '2026-06-01'::date, '2026-06-30'::date),
  0::numeric,
  'An empty date range returns 0, not NULL'
);

-- Test 4: tenancy. A non-member gets 0 for the foreign restaurant even
-- though it has real expense data ($400) — RLS hides the joined rows.
SELECT is(
  get_journal_expense_total(
    '00000000-0000-0000-0000-000000000262'::uuid,
    '2026-04-01'::date, '2026-04-30'::date),
  0::numeric,
  'A non-member gets 0 for a foreign restaurant with real expense data'
);

RESET ROLE;
RESET request.jwt.claims;

SELECT * FROM finish();
ROLLBACK;
