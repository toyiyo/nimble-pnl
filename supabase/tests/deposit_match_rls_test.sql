BEGIN;
SELECT plan(9);

-- Fixture: two restaurants. Owner (view:banking + view:pos_sales) and chef
-- (view:pos_sales only, no view:banking at all) both in restaurant A.
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-1000-0000-0000-000000000001', 'dm-owner-a@test.local'),
  ('aaaaaaaa-1000-0000-0000-000000000002', 'dm-chef-a@test.local');

INSERT INTO public.restaurants (id, name) VALUES
  ('11111111-1000-0000-0000-000000000001', 'Deposit Match A'),
  ('11111111-1000-0000-0000-000000000002', 'Deposit Match B');

INSERT INTO public.user_restaurants (user_id, restaurant_id, role, role_id) VALUES
  ('aaaaaaaa-1000-0000-0000-000000000001', '11111111-1000-0000-0000-000000000001',
   'owner', 'b0000000-0000-0000-0000-000000000001'),
  ('aaaaaaaa-1000-0000-0000-000000000002', '11111111-1000-0000-0000-000000000001',
   'chef',  'b0000000-0000-0000-0000-000000000004');

INSERT INTO public.connected_banks (id, restaurant_id, stripe_financial_account_id, institution_name) VALUES
  ('22222222-1000-0000-0000-000000000001', '11111111-1000-0000-0000-000000000001',
   'fca_dm_a_1', 'Test Bank A'),
  ('22222222-1000-0000-0000-000000000002', '11111111-1000-0000-0000-000000000002',
   'fca_dm_b_1', 'Test Bank B');

-- Seed one rule per restaurant as the service role (bypasses RLS), so the
-- SELECT tests below exercise only the SELECT policy, not INSERT too.
SET LOCAL role TO postgres;
INSERT INTO public.deposit_match_rules
  (id, restaurant_id, pos_source, rail, connected_bank_id, settlement, lag_days_min, lag_days_max)
VALUES
  ('33333333-1000-0000-0000-000000000001', '11111111-1000-0000-0000-000000000001',
   'square', 'card', '22222222-1000-0000-0000-000000000001', 'gross', 1, 3),
  ('33333333-1000-0000-0000-000000000002', '11111111-1000-0000-0000-000000000002',
   'square', 'card', '22222222-1000-0000-0000-000000000002', 'gross', 1, 3);

-- Fixture for the deposit_match_links cross-tenant tests below: one item
-- that belongs to A's own rule, and one bank transaction that belongs to
-- B, so a link between the two is a cross-tenant allocation.
INSERT INTO public.deposit_match_items
  (id, restaurant_id, rule_id, business_date, expected_amount, received_amount, fee_amount, status)
VALUES
  ('44444444-1000-0000-0000-000000000001', '11111111-1000-0000-0000-000000000001',
   '33333333-1000-0000-0000-000000000001', '2026-08-25', 100, 0, 0, 'pending');

INSERT INTO public.bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount)
VALUES
  ('55555555-1000-0000-0000-000000000001', '11111111-1000-0000-0000-000000000001',
   '22222222-1000-0000-0000-000000000001', 'dm_rls_txn_a_1', '2026-08-26', 'Test deposit A', 100),
  ('55555555-1000-0000-0000-000000000002', '11111111-1000-0000-0000-000000000002',
   '22222222-1000-0000-0000-000000000002', 'dm_rls_txn_b_1', '2026-08-26', 'Test deposit B', 100);
RESET role;

SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-1000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-1000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

-- Owner of A has both view:banking and view:pos_sales: sees only A's rule.
SELECT is(
  (SELECT array_agg(id ORDER BY id) FROM public.deposit_match_rules),
  ARRAY['33333333-1000-0000-0000-000000000001'::uuid],
  'owner of A sees only restaurant A''s rule, not B''s (cross-restaurant denial)'
);

-- Owner of A has edit:banking: can insert a second rule for A.
SELECT lives_ok(
  $$INSERT INTO public.deposit_match_rules
      (id, restaurant_id, pos_source, rail, connected_bank_id, settlement, lag_days_min, lag_days_max)
    VALUES ('33333333-1000-0000-0000-000000000003', '11111111-1000-0000-0000-000000000001',
            'toast', 'card', '22222222-1000-0000-0000-000000000001', 'net', 1, 3)$$,
  'owner with edit:banking can insert a rule for their own restaurant'
);

SELECT throws_like(
  $$INSERT INTO public.deposit_match_rules
      (id, restaurant_id, pos_source, rail, connected_bank_id, settlement, lag_days_min, lag_days_max)
    VALUES ('33333333-1000-0000-0000-000000000004', '11111111-1000-0000-0000-000000000002',
            'toast', 'card', '22222222-1000-0000-0000-000000000002', 'net', 1, 3)$$,
  '%row-level security policy%',
  'owner of A cannot insert a rule for restaurant B'
);

-- deposit_match_links cross-tenant checks: the FK on bank_transaction_id
-- only requires the row to exist in ANY tenant, so the policy's own
-- same-tenant check must be what blocks a same-tenant item paired with
-- another tenant's bank transaction.
SELECT throws_like(
  $$INSERT INTO public.deposit_match_links
      (id, restaurant_id, item_id, bank_transaction_id, allocated_amount, method)
    VALUES ('66666666-1000-0000-0000-000000000001', '11111111-1000-0000-0000-000000000001',
            '44444444-1000-0000-0000-000000000001', '55555555-1000-0000-0000-000000000002',
            100, 'manual')$$,
  '%row-level security policy%',
  'owner of A cannot link A''s own item to restaurant B''s bank transaction'
);

-- Same-tenant link is allowed, and doubles as the UPDATE test's fixture.
SELECT lives_ok(
  $$INSERT INTO public.deposit_match_links
      (id, restaurant_id, item_id, bank_transaction_id, allocated_amount, method)
    VALUES ('66666666-1000-0000-0000-000000000002', '11111111-1000-0000-0000-000000000001',
            '44444444-1000-0000-0000-000000000001', '55555555-1000-0000-0000-000000000001',
            100, 'manual')$$,
  'owner of A can link A''s own item to A''s own bank transaction'
);

SELECT throws_like(
  $$UPDATE public.deposit_match_links
    SET bank_transaction_id = '55555555-1000-0000-0000-000000000002'
    WHERE id = '66666666-1000-0000-0000-000000000002'$$,
  '%row-level security policy%',
  'owner of A cannot re-point an existing link to restaurant B''s bank transaction'
);

-- Switch to the chef: view:pos_sales only, no view:banking at all. The
-- SELECT policy ANDs both capabilities, so having one is not enough
-- (memory/lessons.md:848 — two OR'd policies would have let this through).
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-1000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-1000-0000-0000-000000000002', true);

SELECT is(
  (SELECT count(*)::int FROM public.deposit_match_rules),
  0,
  'chef with view:pos_sales but no view:banking sees no rules at all'
);

-- An UPDATE the policy filters out is not an error: Postgres evaluates the
-- USING clause as a row filter, so the statement succeeds having touched
-- nothing. The unchanged-row check below is what actually proves the denial.
SELECT lives_ok(
  $$UPDATE public.deposit_match_rules SET active = false
    WHERE id = '33333333-1000-0000-0000-000000000001'$$,
  'chef UPDATE raises no error — RLS filters the row out instead'
);

-- Verify as postgres (bypasses RLS): the chef has no SELECT visibility at
-- all on this row, so checking it back as the chef would just compare
-- against zero rows rather than proving the value is unchanged.
RESET role;
SELECT is(
  (SELECT active FROM public.deposit_match_rules
   WHERE id = '33333333-1000-0000-0000-000000000001'),
  true,
  'and the chef UPDATE changed nothing: the rule is still active'
);

SELECT * FROM finish();
ROLLBACK;
