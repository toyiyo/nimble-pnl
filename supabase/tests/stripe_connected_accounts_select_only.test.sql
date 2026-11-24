-- stripe_connected_accounts is read-only for the authenticated role.
-- Only the service role writes this table.
BEGIN;
SELECT plan(10);

SET LOCAL row_security = on;

INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-0000000CAAAA'::uuid, 'Connected Test Resto A'),
  ('00000000-0000-0000-0000-0000000CBBBB'::uuid, 'Connected Test Resto B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000CA001'::uuid, 'ca-owner@test.com'),
  ('00000000-0000-0000-0000-0000000CA002'::uuid, 'ca-manager@test.com'),
  ('00000000-0000-0000-0000-0000000CA003'::uuid, 'ca-staff@test.com'),
  ('00000000-0000-0000-0000-0000000CB001'::uuid, 'cb-owner@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-0000000CA001'::uuid, '00000000-0000-0000-0000-0000000CAAAA'::uuid, 'owner'),
  ('00000000-0000-0000-0000-0000000CA002'::uuid, '00000000-0000-0000-0000-0000000CAAAA'::uuid, 'manager'),
  ('00000000-0000-0000-0000-0000000CA003'::uuid, '00000000-0000-0000-0000-0000000CAAAA'::uuid, 'staff'),
  ('00000000-0000-0000-0000-0000000CB001'::uuid, '00000000-0000-0000-0000-0000000CBBBB'::uuid, 'owner')
ON CONFLICT DO NOTHING;

-- Seed one row as the postgres role.
INSERT INTO stripe_connected_accounts (id, restaurant_id, stripe_account_id, account_type)
VALUES ('00000000-0000-0000-0000-0000000CA101', '00000000-0000-0000-0000-0000000CAAAA', 'acct_select_only_1', 'standard');

-- Owner
SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000CA001","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000CA001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT is(
  (SELECT count(*)::int FROM stripe_connected_accounts WHERE restaurant_id = '00000000-0000-0000-0000-0000000CAAAA'),
  1,
  'Owner can SELECT the connected account of the restaurant'
);

SELECT throws_ok(
  $$UPDATE stripe_connected_accounts SET charges_enabled = true WHERE id = '00000000-0000-0000-0000-0000000CA101'$$,
  '42501',
  NULL,
  'Owner UPDATE of charges_enabled is denied'
);

SELECT throws_ok(
  $$INSERT INTO stripe_connected_accounts (restaurant_id, stripe_account_id, account_type) VALUES ('00000000-0000-0000-0000-0000000CAAAA', 'acct_select_only_2', 'standard')$$,
  '42501',
  NULL,
  'Owner INSERT is denied'
);

SELECT throws_ok(
  $$DELETE FROM stripe_connected_accounts WHERE id = '00000000-0000-0000-0000-0000000CA101'$$,
  '42501',
  NULL,
  'Owner DELETE is denied'
);

-- Manager
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000CA002","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000CA002', true);
SELECT is(
  (SELECT count(*)::int FROM stripe_connected_accounts WHERE restaurant_id = '00000000-0000-0000-0000-0000000CAAAA'),
  1,
  'Manager can SELECT the connected account of the restaurant'
);

-- Staff
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000CA003","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000CA003', true);
SELECT is(
  (SELECT count(*)::int FROM stripe_connected_accounts WHERE restaurant_id = '00000000-0000-0000-0000-0000000CAAAA'),
  1,
  'Staff can SELECT the connected account of the restaurant'
);

-- Member of a different restaurant
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000CB001","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000CB001', true);
SELECT is(
  (SELECT count(*)::int FROM stripe_connected_accounts WHERE restaurant_id = '00000000-0000-0000-0000-0000000CAAAA'),
  0,
  'Member of a different restaurant sees 0 rows'
);

RESET role;

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'stripe_connected_accounts'
      AND policyname = 'Owners can manage connected accounts'),
  0,
  'Policy "Owners can manage connected accounts" does not exist'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.stripe_connected_accounts', 'INSERT, UPDATE, DELETE'),
  'authenticated has no INSERT, UPDATE or DELETE privilege'
);

-- The service role still writes this table.
SET LOCAL role TO service_role;

SELECT lives_ok(
  $$UPDATE stripe_connected_accounts SET charges_enabled = true WHERE id = '00000000-0000-0000-0000-0000000CA101'$$,
  'service_role can UPDATE the connected account'
);

RESET role;

SELECT * FROM finish();
ROLLBACK;
