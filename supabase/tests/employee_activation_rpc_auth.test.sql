-- pgTAP: tenant check on deactivate_employee and reactivate_employee, from
-- supabase/migrations/20261026120500_secure_employee_activation_rpcs.sql.
--
-- Both functions are SECURITY DEFINER, so RLS does not stop them. Before the
-- fix, any caller with an employee UUID (the anon key included) could
-- deactivate or reactivate an employee in any restaurant.
--
-- What makes this suite non-vacuous:
--   * The manager of restaurant A is a real manager. The capability exists for
--     A, so only the employee -> restaurant lookup stops the cross-tenant call.
--   * Each denied call is followed by a read of the row and the shift. A
--     denied call that wrote first and raised later would fail those reads.
--   * The custom role holds employees:manage with no view:pay_rates flag. It
--     passes the manage:employees gate, so only the pay-rate gate stops it.
--   * The success path passes a spoofed p_deactivated_by. The audit column must
--     hold auth.uid(), not the parameter.
--
-- Auth context: user_has_capability reads auth.uid(), which reads
-- request.jwt.claims. The suite stays as postgres and changes only the claims.

BEGIN;

SELECT plan(25);

-- ============================================
-- Setup
-- ============================================

SET LOCAL role TO postgres;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('ea000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ea-mgr-a@example.com',    crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('ea000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ea-mgr-b@example.com',    crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('ea000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ea-staff-b@example.com',  crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('ea000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ea-custom-b@example.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO restaurants (id, name) VALUES
  ('ea000000-0000-0000-0000-00000000000a', 'Activation Auth A'),
  ('ea000000-0000-0000-0000-00000000000b', 'Activation Auth B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO employees (id, restaurant_id, name, position, hourly_rate, status, is_active, compensation_type)
VALUES
  ('ea000000-0000-0000-0000-0000000000e1', 'ea000000-0000-0000-0000-00000000000b', 'Bea Target', 'Server', 1500, 'active', true, 'hourly')
ON CONFLICT (id) DO UPDATE SET
  restaurant_id = EXCLUDED.restaurant_id, hourly_rate = 1500, status = 'active', is_active = true,
  termination_date = NULL, deactivated_at = NULL, deactivated_by = NULL, deactivation_reason = NULL;

-- A future scheduled shift. deactivate_employee cancels it on success only.
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, status)
VALUES
  ('ea000000-0000-0000-0000-0000000005f1', 'ea000000-0000-0000-0000-00000000000b', 'ea000000-0000-0000-0000-0000000000e1',
   now() + interval '2 days', now() + interval '2 days 8 hours', 'Server', 'scheduled')
ON CONFLICT (id) DO UPDATE SET status = 'scheduled';

-- Custom role: employees at manage level, no view:pay_rates flag.
INSERT INTO public.roles (id, restaurant_id, name, description, flavor, builtin) VALUES
  ('ea000000-0000-0000-0000-0000000000c1', 'ea000000-0000-0000-0000-00000000000b', 'Roster No Pay', 'pgTAP fixture: employees:manage, no pay rates', 'platform', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.role_areas (role_id, area_key, level) VALUES
  ('ea000000-0000-0000-0000-0000000000c1', 'employees', 'manage')
ON CONFLICT (role_id, area_key) DO UPDATE SET level = EXCLUDED.level;

-- Manager A is a member of A only. Legacy roles keep role_id NULL.
INSERT INTO user_restaurants (user_id, restaurant_id, role, role_id) VALUES
  ('ea000000-0000-0000-0000-0000000000a1', 'ea000000-0000-0000-0000-00000000000a', 'manager',             NULL),
  ('ea000000-0000-0000-0000-0000000000b1', 'ea000000-0000-0000-0000-00000000000b', 'manager',             NULL),
  ('ea000000-0000-0000-0000-0000000000b2', 'ea000000-0000-0000-0000-00000000000b', 'staff',               NULL),
  ('ea000000-0000-0000-0000-0000000000b3', 'ea000000-0000-0000-0000-00000000000b', 'collaborator_custom', 'ea000000-0000-0000-0000-0000000000c1')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role, role_id = EXCLUDED.role_id;

-- ============================================
-- 1-6: grants and function attributes
-- ============================================

SELECT ok(
  NOT has_function_privilege('anon', 'public.deactivate_employee(uuid, uuid, text, boolean, date)', 'EXECUTE'),
  'anon cannot execute deactivate_employee'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.reactivate_employee(uuid, uuid, integer)', 'EXECUTE'),
  'anon cannot execute reactivate_employee'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.deactivate_employee(uuid, uuid, text, boolean, date)', 'EXECUTE'),
  'authenticated can execute deactivate_employee'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.reactivate_employee(uuid, uuid, integer)', 'EXECUTE'),
  'authenticated can execute reactivate_employee'
);

-- grantee 0 is PUBLIC. A NULL proacl means the default ACL, which grants
-- EXECUTE to PUBLIC, so read the default when proacl is NULL.
SELECT is(
  (SELECT count(*)::int
     FROM pg_proc p,
          aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.oid IN ('public.deactivate_employee(uuid, uuid, text, boolean, date)'::regprocedure,
                    'public.reactivate_employee(uuid, uuid, integer)'::regprocedure)
      AND a.grantee = 0
      AND a.privilege_type = 'EXECUTE'),
  0,
  'PUBLIC has no EXECUTE on deactivate_employee or reactivate_employee'
);

SELECT is(
  (SELECT count(*)::int
     FROM pg_proc p
    WHERE p.oid IN ('public.deactivate_employee(uuid, uuid, text, boolean, date)'::regprocedure,
                    'public.reactivate_employee(uuid, uuid, integer)'::regprocedure)
      AND p.prosecdef
      AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')),
  2,
  'both functions are SECURITY DEFINER with a fixed search_path'
);

-- ============================================
-- 7-12: denied calls do not write
-- ============================================

-- No JWT: auth.uid() is NULL.
SELECT set_config('request.jwt.claims', '', true);

SELECT throws_ok(
  $$SELECT deactivate_employee('ea000000-0000-0000-0000-0000000000e1'::uuid, 'ea000000-0000-0000-0000-0000000000a1'::uuid, 'x', true, CURRENT_DATE)$$,
  '42501',
  'Access denied: you cannot manage employees for this restaurant',
  'a caller with no JWT cannot deactivate an employee'
);

-- Manager of restaurant A targets the employee of restaurant B.
SELECT set_config('request.jwt.claims', '{"sub":"ea000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT throws_ok(
  $$SELECT deactivate_employee('ea000000-0000-0000-0000-0000000000e1'::uuid, 'ea000000-0000-0000-0000-0000000000a1'::uuid, 'x', true, CURRENT_DATE)$$,
  '42501',
  'Access denied: you cannot manage employees for this restaurant',
  'a manager of restaurant A cannot deactivate an employee of restaurant B'
);

SELECT ok(
  (SELECT is_active AND status = 'active' AND termination_date IS NULL AND deactivated_by IS NULL
     FROM employees WHERE id = 'ea000000-0000-0000-0000-0000000000e1'),
  'the denied cross-tenant call does not change the employee row'
);

SELECT is(
  (SELECT status FROM shifts WHERE id = 'ea000000-0000-0000-0000-0000000005f1'),
  'scheduled',
  'the denied cross-tenant call does not cancel the future shift'
);

-- Staff of restaurant B: a member, but no manage:employees.
SELECT set_config('request.jwt.claims', '{"sub":"ea000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);

SELECT throws_ok(
  $$SELECT deactivate_employee('ea000000-0000-0000-0000-0000000000e1'::uuid, 'ea000000-0000-0000-0000-0000000000b2'::uuid, 'x', true, CURRENT_DATE)$$,
  '42501',
  'Access denied: you cannot manage employees for this restaurant',
  'a staff member of restaurant B cannot deactivate an employee'
);

-- Unknown employee id: same error as a foreign one, so ids cannot be probed.
SELECT set_config('request.jwt.claims', '{"sub":"ea000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);

SELECT throws_ok(
  $$SELECT deactivate_employee('ea000000-0000-0000-0000-0000000000ff'::uuid, 'ea000000-0000-0000-0000-0000000000b1'::uuid, 'x', true, CURRENT_DATE)$$,
  '42501',
  'Access denied: you cannot manage employees for this restaurant',
  'an unknown employee id gives the same access-denied error'
);

-- ============================================
-- 13-16: manager of restaurant B deactivates
-- ============================================

-- p_deactivated_by is spoofed to manager A. The audit column must hold B.
SELECT lives_ok(
  $$SELECT deactivate_employee('ea000000-0000-0000-0000-0000000000e1'::uuid, 'ea000000-0000-0000-0000-0000000000a1'::uuid, 'seasonal', true, CURRENT_DATE)$$,
  'a manager of restaurant B can deactivate the employee of restaurant B'
);

SELECT ok(
  (SELECT NOT is_active AND status = 'inactive' AND termination_date = CURRENT_DATE
     FROM employees WHERE id = 'ea000000-0000-0000-0000-0000000000e1'),
  'deactivate sets is_active, status and termination_date'
);

SELECT is(
  (SELECT deactivated_by FROM employees WHERE id = 'ea000000-0000-0000-0000-0000000000e1'),
  'ea000000-0000-0000-0000-0000000000b1'::uuid,
  'deactivated_by holds auth.uid(), not the p_deactivated_by parameter'
);

SELECT is(
  (SELECT status FROM shifts WHERE id = 'ea000000-0000-0000-0000-0000000005f1'),
  'cancelled',
  'deactivate cancels the future scheduled shift'
);

-- ============================================
-- 17-18: manager of restaurant A cannot reactivate
-- ============================================

SELECT set_config('request.jwt.claims', '{"sub":"ea000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT throws_ok(
  $$SELECT reactivate_employee('ea000000-0000-0000-0000-0000000000e1'::uuid, 'ea000000-0000-0000-0000-0000000000a1'::uuid, NULL)$$,
  '42501',
  'Access denied: you cannot manage employees for this restaurant',
  'a manager of restaurant A cannot reactivate an employee of restaurant B'
);

SELECT ok(
  (SELECT NOT is_active FROM employees WHERE id = 'ea000000-0000-0000-0000-0000000000e1'),
  'the denied cross-tenant reactivate does not change the employee row'
);

-- ============================================
-- 19-23: custom role with employees:manage and no pay-rate flag
-- ============================================

SELECT set_config('request.jwt.claims', '{"sub":"ea000000-0000-0000-0000-0000000000b3","role":"authenticated"}', true);

SELECT throws_ok(
  $$SELECT reactivate_employee('ea000000-0000-0000-0000-0000000000e1'::uuid, 'ea000000-0000-0000-0000-0000000000b3'::uuid, 9999)$$,
  '42501',
  'Access denied: you cannot set pay rates for this restaurant',
  'a caller with no view:pay_rates cannot set a rate on reactivate'
);

SELECT ok(
  (SELECT NOT is_active AND hourly_rate = 1500 FROM employees WHERE id = 'ea000000-0000-0000-0000-0000000000e1'),
  'the denied rate change does not reactivate or change the rate'
);

SELECT lives_ok(
  $$SELECT reactivate_employee('ea000000-0000-0000-0000-0000000000e1'::uuid, 'ea000000-0000-0000-0000-0000000000a1'::uuid, NULL)$$,
  'a caller with employees:manage can reactivate with no rate'
);

SELECT ok(
  (SELECT is_active AND status = 'active' AND hourly_rate = 1500
          AND reactivated_by = 'ea000000-0000-0000-0000-0000000000b3'::uuid
     FROM employees WHERE id = 'ea000000-0000-0000-0000-0000000000e1'),
  'reactivate sets the row active and reactivated_by holds auth.uid()'
);

SELECT lives_ok(
  $$SELECT deactivate_employee('ea000000-0000-0000-0000-0000000000e1'::uuid, 'ea000000-0000-0000-0000-0000000000b3'::uuid, NULL, false, CURRENT_DATE)$$,
  'a caller with employees:manage can deactivate'
);

-- ============================================
-- 24-25: manager of restaurant B reactivates with a new rate
-- ============================================

SELECT set_config('request.jwt.claims', '{"sub":"ea000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);

SELECT lives_ok(
  $$SELECT reactivate_employee('ea000000-0000-0000-0000-0000000000e1'::uuid, 'ea000000-0000-0000-0000-0000000000b1'::uuid, 2000)$$,
  'a manager of restaurant B can reactivate with a new rate'
);

SELECT ok(
  (SELECT is_active AND hourly_rate = 2000 FROM employees WHERE id = 'ea000000-0000-0000-0000-0000000000e1'),
  'reactivate with a rate sets the new rate'
);

SELECT * FROM finish();

ROLLBACK;
