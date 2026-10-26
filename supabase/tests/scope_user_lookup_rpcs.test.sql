-- ============================================================================
-- scope_user_lookup_rpcs.test.sql
--
-- pgTAP coverage for 20261026120600_scope_user_lookup_rpcs.sql. See
-- docs/superpowers/specs/2026-10-26-scope-user-lookup-rpcs-design.md.
--
-- get_users_by_ids must return a row only for a user who shares a restaurant
-- with auth.uid(). verify_employee_can_login must not return data for another
-- user. anon must not execute either function.
--
-- The tests run as the real `authenticated` and `anon` roles with JWT claims.
-- All fixture data is fictional and exists only in this transaction.
-- ============================================================================
BEGIN;

SELECT plan(16);

-- ----------------------------------------------------------------------------
-- Fixtures. The `e6000000-…` prefix keeps the ids apart from other test files.
--
--   restaurant A (...a1)  restaurant B (...b1)
--   MANAGER   (...01) manager of A
--   COWORKER  (...02) staff of A, active employee of A
--   OUTSIDER  (...03) owner of B only
--   INACTIVE  (...04) staff of B, inactive employee of B
--   LONER     (...05) member of no restaurant
-- ----------------------------------------------------------------------------
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e6000000-0000-0000-0000-000000000001', 'sulr-manager@example.test',  '{"full_name":"Manager A"}'),
  ('e6000000-0000-0000-0000-000000000002', 'sulr-coworker@example.test', '{"full_name":"Coworker A"}'),
  ('e6000000-0000-0000-0000-000000000003', 'sulr-outsider@example.test', '{"full_name":"Outsider B"}'),
  ('e6000000-0000-0000-0000-000000000004', 'sulr-inactive@example.test', '{"full_name":"Inactive B"}'),
  ('e6000000-0000-0000-0000-000000000005', 'sulr-loner@example.test',    '{}');

INSERT INTO public.restaurants (id, name) VALUES
  ('e6000000-0000-0000-0000-0000000000a1', 'User Lookup Test Restaurant A'),
  ('e6000000-0000-0000-0000-0000000000b1', 'User Lookup Test Restaurant B');

INSERT INTO public.user_restaurants (user_id, restaurant_id, role) VALUES
  ('e6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-0000000000a1', 'manager'),
  ('e6000000-0000-0000-0000-000000000002', 'e6000000-0000-0000-0000-0000000000a1', 'staff'),
  ('e6000000-0000-0000-0000-000000000003', 'e6000000-0000-0000-0000-0000000000b1', 'owner'),
  ('e6000000-0000-0000-0000-000000000004', 'e6000000-0000-0000-0000-0000000000b1', 'staff');

INSERT INTO public.employees (
  id, restaurant_id, name, position, hourly_rate, status, is_active, compensation_type, user_id
) VALUES
  ('e6000000-0000-0000-0000-000000000202', 'e6000000-0000-0000-0000-0000000000a1',
   'Coworker A', 'Server', 1500, 'active', true, 'hourly', 'e6000000-0000-0000-0000-000000000002'),
  ('e6000000-0000-0000-0000-000000000204', 'e6000000-0000-0000-0000-0000000000b1',
   'Inactive B', 'Cook', 1500, 'inactive', false, 'hourly', 'e6000000-0000-0000-0000-000000000004');

-- ============================================================================
-- 1-4. Grants. anon and PUBLIC must not have EXECUTE. authenticated must.
-- ============================================================================
SELECT ok(
  NOT has_function_privilege('anon', 'public.get_users_by_ids(uuid[])', 'EXECUTE'),
  'anon cannot execute get_users_by_ids'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.verify_employee_can_login(uuid)', 'EXECUTE'),
  'anon cannot execute verify_employee_can_login'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.get_users_by_ids(uuid[])', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.verify_employee_can_login(uuid)', 'EXECUTE'),
  'authenticated can execute both functions'
);

SELECT ok(
  (SELECT bool_and(p.proconfig @> ARRAY['search_path=""'])
   FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('get_users_by_ids', 'verify_employee_can_login')),
  'both functions pin search_path to an empty value'
);

-- ============================================================================
-- 5. anon call fails with insufficient_privilege.
-- ============================================================================
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims = '{"role":"anon"}';

SELECT throws_ok(
  $$SELECT * FROM public.get_users_by_ids(ARRAY['e6000000-0000-0000-0000-000000000002']::uuid[])$$,
  '42501',
  NULL,
  'anon call to get_users_by_ids is denied'
);

RESET ROLE;

-- ============================================================================
-- 6-9. get_users_by_ids as MANAGER of restaurant A.
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e6000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT results_eq(
  $$SELECT id, email, full_name FROM public.get_users_by_ids(
      ARRAY['e6000000-0000-0000-0000-000000000002']::uuid[])$$,
  $$VALUES ('e6000000-0000-0000-0000-000000000002'::uuid,
            'sulr-coworker@example.test'::text, 'Coworker A'::text)$$,
  'a user gets the row for a coworker'
);

SELECT is_empty(
  $$SELECT 1 FROM public.get_users_by_ids(
      ARRAY['e6000000-0000-0000-0000-000000000003']::uuid[])$$,
  'a user gets no row for a user of another restaurant'
);

SELECT results_eq(
  $$SELECT id FROM public.get_users_by_ids(ARRAY[
      'e6000000-0000-0000-0000-000000000002',
      'e6000000-0000-0000-0000-000000000003',
      'e6000000-0000-0000-0000-000000000004']::uuid[]) ORDER BY id$$,
  $$VALUES ('e6000000-0000-0000-0000-000000000002'::uuid)$$,
  'a mixed list returns only the coworker'
);

-- LONER is signed in but has no restaurant, so LONER gets no rows.
SET LOCAL request.jwt.claims = '{"sub":"e6000000-0000-0000-0000-000000000005","role":"authenticated"}';

SELECT is_empty(
  $$SELECT 1 FROM public.get_users_by_ids(ARRAY[
      'e6000000-0000-0000-0000-000000000001',
      'e6000000-0000-0000-0000-000000000003']::uuid[])$$,
  'a user with no restaurant gets no rows'
);

-- ============================================================================
-- 10-14. verify_employee_can_login as COWORKER (active employee of A).
-- ============================================================================
SET LOCAL request.jwt.claims = '{"sub":"e6000000-0000-0000-0000-000000000002","role":"authenticated"}';

SELECT results_eq(
  $$SELECT can_login, employee_name, is_active FROM public.verify_employee_can_login()$$,
  $$VALUES (true, 'Coworker A'::text, true)$$,
  'a user gets their own data with no argument'
);

SELECT results_eq(
  $$SELECT can_login, employee_name FROM public.verify_employee_can_login(
      'e6000000-0000-0000-0000-000000000002'::uuid)$$,
  $$VALUES (true, 'Coworker A'::text)$$,
  'a user gets their own data when p_user_id equals auth.uid()'
);

SELECT throws_ok(
  $$SELECT * FROM public.verify_employee_can_login('e6000000-0000-0000-0000-000000000004'::uuid)$$,
  '42501',
  'Cannot check another user',
  'verify_employee_can_login does not return data for another user'
);

SELECT throws_ok(
  $$SELECT * FROM public.verify_employee_can_login('e6000000-0000-0000-0000-000000000003'::uuid)$$,
  '42501',
  'Cannot check another user',
  'verify_employee_can_login rejects a non-employee user of another restaurant'
);

RESET ROLE;

SELECT is_empty(
  $$SELECT 1 FROM public.auth_audit_log
    WHERE user_id = 'e6000000-0000-0000-0000-000000000004'$$,
  'a rejected call for another user writes no audit row'
);

-- ============================================================================
-- 15. INACTIVE checks their own account: blocked, and one audit row.
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e6000000-0000-0000-0000-000000000004","role":"authenticated"}';

SELECT results_eq(
  $$SELECT can_login, is_active FROM public.verify_employee_can_login()$$,
  $$VALUES (false, false)$$,
  'an inactive employee is blocked'
);

RESET ROLE;

-- ============================================================================
-- 16. A caller with no JWT is rejected.
-- ============================================================================
SET LOCAL request.jwt.claims = '{}';

SELECT throws_ok(
  $$SELECT * FROM public.verify_employee_can_login('e6000000-0000-0000-0000-000000000004'::uuid)$$,
  '42501',
  'Not authenticated',
  'a caller with no JWT is rejected'
);

SELECT * FROM finish();
ROLLBACK;
