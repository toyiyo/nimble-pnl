-- pgTAP tests for link_invited_employee, the service-role-only RPC that
-- accept-invitation calls to link an accountless employee record
-- (employees.user_id IS NULL) to the account created/joined at invite-accept
-- time.
--
-- Design: docs/superpowers/specs/2026-07-23-accountless-employee-invites-design.md #4
--
-- Coverage:
--   1. resolve by p_employee_id -> linked
--   2. resolve by p_email (trim/lower) -> linked
--   3. no_match (neither id nor email resolves a target)
--   4. user_already_linked guard: p_user_id already owns a DIFFERENT employee
--      row in the same restaurant -> denied, no row touched
--   5 & 6. idempotent re-link: calling again for a user already linked to the
--      resolved target returns linked=true, reason='already_linked'
--   7. conflict: target employee is already linked to a DIFFERENT user
--   9 & 10. authenticated role has no EXECUTE privilege (service_role only)
--
-- Fixture note: unlike link_employee_to_user (caller-authorized via
-- auth.uid()), this function has no in-function caller check — it is
-- reachable only via REVOKE/GRANT (service_role only), so these tests call
-- it directly as the transaction's superuser role (no auth.uid() setup
-- needed) and separately assert the privilege boundary with
-- has_function_privilege.

BEGIN;
SELECT plan(10);

-- ---------- Fixture setup ----------
INSERT INTO restaurants (id, name) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Link Invited Employee Test Restaurant')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO auth.users (id, email, encrypted_password, aud, role) VALUES
  ('a1111111-1111-1111-1111-111111111101', 'new-hire-by-id@test.com', '', 'authenticated', 'authenticated'),
  ('a1111111-1111-1111-1111-111111111102', 'new-hire-by-email@test.com', '', 'authenticated', 'authenticated'),
  ('a1111111-1111-1111-1111-111111111103', 'no-match-user@test.com', '', 'authenticated', 'authenticated'),
  ('a1111111-1111-1111-1111-111111111104', 'already-has-employee@test.com', '', 'authenticated', 'authenticated'),
  ('a1111111-1111-1111-1111-111111111105', 'conflict-user@test.com', '', 'authenticated', 'authenticated'),
  ('a1111111-1111-1111-1111-111111111106', 'other-account@test.com', '', 'authenticated', 'authenticated')
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  encrypted_password = EXCLUDED.encrypted_password,
  aud = EXCLUDED.aud,
  role = EXCLUDED.role;

-- Accountless (user_id NULL) active employees used as link targets.
-- Explicit user_id = NULL in the DO UPDATE keeps re-runs deterministic.
INSERT INTO employees (id, restaurant_id, name, email, position, status, user_id) VALUES
  ('a2222222-2222-2222-2222-222222222201', 'a0000000-0000-0000-0000-000000000001', 'Resolve By Id',    'resolve-by-id@test.com',    'Server',    'active', NULL),
  ('a2222222-2222-2222-2222-222222222202', 'a0000000-0000-0000-0000-000000000001', 'Resolve By Email', 'RESOLVE-BY-EMAIL@Test.com', 'Cook',      'active', NULL),
  ('a2222222-2222-2222-2222-222222222203', 'a0000000-0000-0000-0000-000000000001', 'Already Owned',    'already-owned@test.com',    'Bartender', 'active', 'a1111111-1111-1111-1111-111111111104'),
  ('a2222222-2222-2222-2222-222222222204', 'a0000000-0000-0000-0000-000000000001', 'Second Row',       'second-row@test.com',       'Host',      'active', NULL),
  ('a2222222-2222-2222-2222-222222222205', 'a0000000-0000-0000-0000-000000000001', 'Conflict Target',  'conflict-target@test.com',  'Busser',    'active', 'a1111111-1111-1111-1111-111111111106')
ON CONFLICT (id) DO UPDATE SET
  restaurant_id = EXCLUDED.restaurant_id,
  name = EXCLUDED.name,
  email = EXCLUDED.email,
  position = EXCLUDED.position,
  status = EXCLUDED.status,
  user_id = EXCLUDED.user_id;

-- ---------- 1. resolve by p_employee_id -> linked ----------
SELECT results_eq(
  $$ SELECT linked, reason FROM link_invited_employee(
       'a1111111-1111-1111-1111-111111111101'::uuid,
       'a0000000-0000-0000-0000-000000000001'::uuid,
       'a2222222-2222-2222-2222-222222222201'::uuid,
       NULL
     ) $$,
  $$ VALUES (true, 'linked'::text) $$,
  'resolve by p_employee_id links and reports linked'
);

SELECT is(
  (SELECT user_id FROM employees WHERE id = 'a2222222-2222-2222-2222-222222222201'),
  'a1111111-1111-1111-1111-111111111101'::uuid,
  'employee row now carries the resolved user_id'
);

-- ---------- 2. resolve by p_email (trim/lower) -> linked ----------
SELECT results_eq(
  $$ SELECT linked, reason FROM link_invited_employee(
       'a1111111-1111-1111-1111-111111111102'::uuid,
       'a0000000-0000-0000-0000-000000000001'::uuid,
       NULL,
       '  Resolve-By-Email@Test.com  '
     ) $$,
  $$ VALUES (true, 'linked'::text) $$,
  'resolve by p_email is case-insensitive and trimmed'
);

-- ---------- 3. no_match ----------
SELECT results_eq(
  $$ SELECT linked, reason, employee_id FROM link_invited_employee(
       'a1111111-1111-1111-1111-111111111103'::uuid,
       'a0000000-0000-0000-0000-000000000001'::uuid,
       gen_random_uuid(),
       'nobody-with-this-email@test.com'
     ) $$,
  $$ VALUES (false, 'no_match'::text, NULL::uuid) $$,
  'neither id nor email resolves a target -> no_match'
);

-- ---------- 4. user_already_linked guard ----------
-- a1111111...104 already owns employee 203 in this restaurant; linking it to
-- a DIFFERENT accountless employee (204) via email must be denied.
SELECT results_eq(
  $$ SELECT linked, reason, employee_id FROM link_invited_employee(
       'a1111111-1111-1111-1111-111111111104'::uuid,
       'a0000000-0000-0000-0000-000000000001'::uuid,
       NULL,
       'second-row@test.com'
     ) $$,
  $$ VALUES (false, 'user_already_linked'::text, NULL::uuid) $$,
  'a user who already owns a different employee row in this restaurant is denied'
);

SELECT ok(
  (SELECT user_id FROM employees WHERE id = 'a2222222-2222-2222-2222-222222222204') IS NULL,
  'the second employee row is untouched by the denied guard case'
);

-- ---------- 5 & 6. idempotent re-link ----------
-- Employee 201 is already linked to 101 (from test 1). Calling again for the
-- same user, resolved the same way, must be idempotent success, not a
-- generic failure or a second write attempt.
SELECT results_eq(
  $$ SELECT linked, reason, employee_id FROM link_invited_employee(
       'a1111111-1111-1111-1111-111111111101'::uuid,
       'a0000000-0000-0000-0000-000000000001'::uuid,
       'a2222222-2222-2222-2222-222222222201'::uuid,
       NULL
     ) $$,
  $$ VALUES (true, 'already_linked'::text, 'a2222222-2222-2222-2222-222222222201'::uuid) $$,
  'idempotent re-link reports already_linked with the same employee_id'
);

-- ---------- 7. conflict: target already linked to a DIFFERENT user ----------
SELECT results_eq(
  $$ SELECT linked, reason FROM link_invited_employee(
       'a1111111-1111-1111-1111-111111111105'::uuid,
       'a0000000-0000-0000-0000-000000000001'::uuid,
       'a2222222-2222-2222-2222-222222222205'::uuid,
       NULL
     ) $$,
  $$ VALUES (false, 'conflict'::text) $$,
  'linking to a target already owned by a different user is a conflict'
);

-- ---------- 8 & 9. authenticated role lacks EXECUTE (service_role only) ----------
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.link_invited_employee(uuid,uuid,uuid,text)',
    'EXECUTE'
  ),
  'service_role can execute link_invited_employee'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.link_invited_employee(uuid,uuid,uuid,text)',
    'EXECUTE'
  ),
  'authenticated cannot execute link_invited_employee'
);

SELECT * FROM finish();
ROLLBACK;
