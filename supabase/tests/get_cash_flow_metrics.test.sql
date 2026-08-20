BEGIN;
SELECT plan(10);

-- Fixed identities for this test.
-- restaurant:            c1000000-0000-0000-0000-000000000001
-- staff (denied):        c1000000-0000-0000-0000-000000000002
-- collaborator_accountant: c1000000-0000-0000-0000-000000000003
-- non-member (denied):   c1000000-0000-0000-0000-000000000099
-- bank account A:        c1000000-0000-0000-0000-0000000000a1
-- bank account B:        c1000000-0000-0000-0000-0000000000a2

-- Seed as postgres so the fixture INSERTs bypass RLS.
SET LOCAL role TO postgres;

INSERT INTO auth.users (id, email)
VALUES
  ('c1000000-0000-0000-0000-000000000002', 'cf-rpc-staff@example.com'),
  ('c1000000-0000-0000-0000-000000000003', 'cf-rpc-accountant@example.com')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO restaurants (id, name)
VALUES ('c1000000-0000-0000-0000-000000000001', 'Cash Flow RPC Test Diner')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO user_restaurants (user_id, restaurant_id, role)
VALUES
  ('c1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'staff'),
  ('c1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000001', 'collaborator_accountant')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO connected_banks (id, restaurant_id, stripe_financial_account_id, institution_name)
VALUES
  ('c1000000-0000-0000-0000-0000000000a1', 'c1000000-0000-0000-0000-000000000001', 'cf-rpc-fca-a', 'Test Bank A'),
  ('c1000000-0000-0000-0000-0000000000a2', 'c1000000-0000-0000-0000-000000000001', 'cf-rpc-fca-b', 'Test Bank B')
ON CONFLICT (id) DO NOTHING;

-- Case 4 fixture: a transfer-only day. Must not appear in `daily`.
INSERT INTO bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount, status, is_transfer)
VALUES
  ('c1000000-0000-0000-0000-00000000a401', 'c1000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-0000000000a1', 'cf-rpc-txn-transfer', '2026-06-10T12:00:00Z',
   'Internal transfer', 500.00, 'posted', TRUE);

-- Case 5 fixture: a pending-only day. Must not appear in `daily`.
INSERT INTO bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount, status, is_transfer)
VALUES
  ('c1000000-0000-0000-0000-00000000a501', 'c1000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-0000000000a1', 'cf-rpc-txn-pending', '2026-06-11T08:00:00Z',
   'Pending charge', 200.00, 'pending', FALSE);

-- Case 6 fixture: a row at 23:30 UTC on the end date. Must count (end-of-day bound).
INSERT INTO bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount, status, is_transfer)
VALUES
  ('c1000000-0000-0000-0000-00000000a601', 'c1000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-0000000000a1', 'cf-rpc-txn-eod', '2026-06-12T23:30:00Z',
   'Late deposit', 75.00, 'posted', FALSE);

-- Case 7 fixture: a row the day before p_start_date. Must count in `comparison`, not `daily`.
INSERT INTO bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount, status, is_transfer)
VALUES
  ('c1000000-0000-0000-0000-00000000a701', 'c1000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-0000000000a1', 'cf-rpc-txn-priorday', '2026-06-14T10:00:00Z',
   'Prior-window deposit', 60.00, 'posted', FALSE);

-- Case 8 fixture: two rows on the same day, two different bank accounts.
INSERT INTO bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount, status, is_transfer)
VALUES
  ('c1000000-0000-0000-0000-00000000a801', 'c1000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-0000000000a1', 'cf-rpc-txn-bank-a', '2026-06-20T09:00:00Z',
   'Bank A deposit', 30.00, 'posted', FALSE),
  ('c1000000-0000-0000-0000-00000000a802', 'c1000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-0000000000a2', 'cf-rpc-txn-bank-b', '2026-06-20T09:00:00Z',
   'Bank B deposit', 40.00, 'posted', FALSE);

-- Case 9 fixture: one inflow and one outflow on the same day.
INSERT INTO bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount, status, is_transfer)
VALUES
  ('c1000000-0000-0000-0000-00000000a901', 'c1000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-0000000000a1', 'cf-rpc-txn-inflow', '2026-06-25T09:00:00Z',
   'Deposit', 25.00, 'posted', FALSE),
  ('c1000000-0000-0000-0000-00000000a902', 'c1000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-0000000000a1', 'cf-rpc-txn-outflow', '2026-06-25T09:00:00Z',
   'Withdrawal', -15.00, 'posted', FALSE);

-- Case 10 has no fixture: it is a truly empty window, 2030-01-01..2030-01-02.

-- Auth.uid() reads the JWT claims GUC directly and needs no role switch
-- (memory/lessons.md:1406). Stay as postgres so RLS never interferes; the
-- RPC is SECURITY DEFINER and performs its own capability gate.

-- Case 1: a non-member caller is denied.
SELECT set_config('request.jwt.claims', '{"sub":"c1000000-0000-0000-0000-000000000099","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT get_cash_flow_metrics('c1000000-0000-0000-0000-000000000001'::uuid, '2026-06-01'::date, '2026-06-01'::date, NULL) $$,
  'Access denied to restaurant',
  'non-member caller is denied'
);

-- Case 2: a member with role staff (outside {owner, manager, collaborator_accountant}) is denied.
SELECT set_config('request.jwt.claims', '{"sub":"c1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT get_cash_flow_metrics('c1000000-0000-0000-0000-000000000001'::uuid, '2026-06-01'::date, '2026-06-01'::date, NULL) $$,
  'Access denied to restaurant',
  'staff member is denied (no view:transactions capability)'
);

-- Case 3: a member with role collaborator_accountant gets a result.
SELECT set_config('request.jwt.claims', '{"sub":"c1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT lives_ok(
  $$ SELECT get_cash_flow_metrics('c1000000-0000-0000-0000-000000000001'::uuid, '2026-06-30'::date, '2026-06-30'::date, NULL) $$,
  'collaborator_accountant caller gets a result, not Access denied'
);

-- The remaining cases all act as the collaborator_accountant caller.

-- Case 4: a transfer row does not count.
SELECT is(
  get_cash_flow_metrics('c1000000-0000-0000-0000-000000000001'::uuid, '2026-06-10'::date, '2026-06-10'::date, NULL)->'daily',
  '[]'::jsonb,
  'a transfer-only day produces no daily entry'
);

-- Case 5: a pending row does not count.
SELECT is(
  get_cash_flow_metrics('c1000000-0000-0000-0000-000000000001'::uuid, '2026-06-11'::date, '2026-06-11'::date, NULL)->'daily',
  '[]'::jsonb,
  'a pending-only day produces no daily entry'
);

-- Case 6: a row at 23:30 UTC on p_end_date counts (end-of-day bound).
SELECT is(
  get_cash_flow_metrics('c1000000-0000-0000-0000-000000000001'::uuid, '2026-06-12'::date, '2026-06-12'::date, NULL)->'daily',
  '[{"day": "2026-06-12", "inflow": 75.00, "outflow": 0}]'::jsonb,
  'a row at 23:30 UTC on the end date counts (half-open end bound)'
);

-- Case 7: a row on the day before p_start_date counts in comparison, not daily.
SELECT is(
  get_cash_flow_metrics('c1000000-0000-0000-0000-000000000001'::uuid, '2026-06-15'::date, '2026-06-17'::date, NULL),
  '{"daily": [], "comparison": {"inflow": 60.00, "outflow": 0}}'::jsonb,
  'a row the day before p_start_date lands in comparison, not daily'
);

-- Case 8: the p_bank_account_id filter keeps only the matching account.
SELECT is(
  get_cash_flow_metrics('c1000000-0000-0000-0000-000000000001'::uuid, '2026-06-20'::date, '2026-06-20'::date,
    'c1000000-0000-0000-0000-0000000000a1'::uuid)->'daily',
  '[{"day": "2026-06-20", "inflow": 30.00, "outflow": 0}]'::jsonb,
  'p_bank_account_id filters out the other account''s rows'
);

-- Case 9: inflow and outflow split by sign; outflow is positive.
SELECT is(
  get_cash_flow_metrics('c1000000-0000-0000-0000-000000000001'::uuid, '2026-06-25'::date, '2026-06-25'::date, NULL)->'daily',
  '[{"day": "2026-06-25", "inflow": 25.00, "outflow": 15.00}]'::jsonb,
  'inflow and outflow split by sign; outflow is a positive number'
);

-- Case 10: an empty window returns zero totals, not NULL.
SELECT is(
  get_cash_flow_metrics('c1000000-0000-0000-0000-000000000001'::uuid, '2030-01-01'::date, '2030-01-02'::date, NULL),
  '{"daily": [], "comparison": {"inflow": 0, "outflow": 0}}'::jsonb,
  'an empty window returns zero totals, not NULL'
);

SELECT * FROM finish();
ROLLBACK;
