-- Tests the tenancy guard on get_monthly_sales_metrics.
-- Migration 20260814120000 restores SECURITY INVOKER + a user_restaurants
-- membership guard and revokes EXECUTE from anon. These tests confirm:
--   1. A member can call the function.
--   2. A non-member gets an access-denied error (SQLSTATE P0001).
--   3. The function runs as SECURITY INVOKER (prosecdef = false).
--   4. The anon role cannot EXECUTE the function.

BEGIN;
SELECT plan(4);

SET LOCAL role TO postgres;

ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;

-- A member and a non-member.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000230'::uuid, 'metrics-member@example.com'),
  ('00000000-0000-0000-0000-000000000231'::uuid, 'metrics-nonmember@example.com')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-000000000232'::uuid, 'Tenancy Guard Test')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Only user ...230 belongs to restaurant ...232.
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000230'::uuid,
   '00000000-0000-0000-0000-000000000232'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- Test 1: the member can call the function.
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000230"}';
SELECT lives_ok(
  $$ SELECT * FROM get_monthly_sales_metrics(
       '00000000-0000-0000-0000-000000000232'::uuid,
       '2026-04-01'::date, '2026-04-30'::date) $$,
  'A member can call get_monthly_sales_metrics'
);

-- Test 2: the non-member gets an access-denied error.
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000231"}';
SELECT throws_ok(
  $$ SELECT * FROM get_monthly_sales_metrics(
       '00000000-0000-0000-0000-000000000232'::uuid,
       '2026-04-01'::date, '2026-04-30'::date) $$,
  'P0001',
  NULL,
  'A non-member cannot call get_monthly_sales_metrics'
);

-- Test 3: the function runs as SECURITY INVOKER, so RLS applies to the caller.
SELECT is(
  (SELECT prosecdef FROM pg_proc
   WHERE proname = 'get_monthly_sales_metrics' AND pronargs = 3),
  false,
  'get_monthly_sales_metrics runs as SECURITY INVOKER'
);

-- Test 4: the anon role cannot EXECUTE the function.
SELECT is(
  has_function_privilege(
    'anon',
    'public.get_monthly_sales_metrics(uuid,date,date)',
    'EXECUTE'),
  false,
  'anon cannot EXECUTE get_monthly_sales_metrics'
);

SELECT * FROM finish();
ROLLBACK;
