-- Test: link_employee_to_user authorization hardening
-- Tests for migration 20260722120000_link_employee_to_user_hardening.sql
--
-- Verifies:
--   1. operations_manager can link an employee to an account that is already a
--      member of the same restaurant (previously excluded from the allowlist)
--   2. chef cannot link
--   3. a caller from another restaurant cannot link
--   4. an unauthorized caller gets one non-committal message whether the
--      employee exists or not (no existence leak)
--   5. relinking to the SAME account is idempotent (success = TRUE) ...
--   6. ... and reports the already-linked state rather than a generic failure
--   7. owner can still link (no regression)
--   8. linking to an account that is NOT a member of the restaurant is denied
--      (the cross-tenant grant this hardening closes) ...
--   9. ... with a message that names the reason
--  10. relinking an already-linked employee to a DIFFERENT account is a conflict
--  11. linking an account that is ALREADY linked to another employee in the
--      same restaurant is denied — a duplicate (user_id, restaurant_id) would
--      break useCurrentEmployee's .single() lookup ...
--  12. ... with a message that names the reason

BEGIN;
SELECT plan(12);

-- ---------- Fixture setup ----------
-- One restaurant holding the unlinked employees under test, plus an
-- outsider restaurant whose member must never be able to link into it.
INSERT INTO restaurants (id, name) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'Link Test Restaurant'),
  ('f0000000-0000-0000-0000-000000000002', 'Outsider Restaurant')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO auth.users (id, email, encrypted_password, aud, role) VALUES
  ('f1111111-1111-1111-1111-111111111101', 'om-caller@test.com', '', 'authenticated', 'authenticated'),
  ('f1111111-1111-1111-1111-111111111102', 'chef-caller@test.com', '', 'authenticated', 'authenticated'),
  ('f1111111-1111-1111-1111-111111111103', 'outsider-caller@test.com', '', 'authenticated', 'authenticated'),
  ('f1111111-1111-1111-1111-111111111104', 'owner-caller@test.com', '', 'authenticated', 'authenticated'),
  ('f1111111-1111-1111-1111-111111111105', 'target-user@test.com', '', 'authenticated', 'authenticated'),
  ('f1111111-1111-1111-1111-111111111106', 'other-member@test.com', '', 'authenticated', 'authenticated'),
  ('f1111111-1111-1111-1111-111111111107', 'nonmember@test.com', '', 'authenticated', 'authenticated')
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  encrypted_password = EXCLUDED.encrypted_password,
  aud = EXCLUDED.aud,
  role = EXCLUDED.role;

-- Callers: operations_manager, chef and owner in the restaurant under test;
-- the outsider is a member of the OTHER restaurant only. The link *targets*
-- (105, 106) are members of the restaurant under test — a precondition the
-- hardened function now enforces. 107 is a real account that is a member of
-- NO restaurant, used to prove the non-member link is denied.
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('f1111111-1111-1111-1111-111111111101', 'f0000000-0000-0000-0000-000000000001', 'operations_manager'),
  ('f1111111-1111-1111-1111-111111111102', 'f0000000-0000-0000-0000-000000000001', 'chef'),
  ('f1111111-1111-1111-1111-111111111103', 'f0000000-0000-0000-0000-000000000002', 'owner'),
  ('f1111111-1111-1111-1111-111111111104', 'f0000000-0000-0000-0000-000000000001', 'owner'),
  ('f1111111-1111-1111-1111-111111111105', 'f0000000-0000-0000-0000-000000000001', 'staff'),
  ('f1111111-1111-1111-1111-111111111106', 'f0000000-0000-0000-0000-000000000001', 'staff')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- Unlinked employees in the restaurant under test. Explicit user_id = NULL
-- in the DO UPDATE keeps re-runs deterministic (a prior run's link must not
-- leak into this one).
INSERT INTO employees (id, restaurant_id, name, email, position, status) VALUES
  ('f2222222-2222-2222-2222-222222222201', 'f0000000-0000-0000-0000-000000000001', 'Employee One', 'employee-one@test.com', 'Server', 'active'),
  ('f2222222-2222-2222-2222-222222222202', 'f0000000-0000-0000-0000-000000000001', 'Employee Two', 'employee-two@test.com', 'Cook', 'active'),
  ('f2222222-2222-2222-2222-222222222203', 'f0000000-0000-0000-0000-000000000001', 'Employee Three', 'employee-three@test.com', 'Bartender', 'active')
ON CONFLICT (id) DO UPDATE SET
  restaurant_id = EXCLUDED.restaurant_id,
  name = EXCLUDED.name,
  email = EXCLUDED.email,
  position = EXCLUDED.position,
  status = EXCLUDED.status,
  user_id = NULL;

-- Helper to impersonate a caller via auth.uid() inside the SECURITY DEFINER
-- function (mirrors the test_set_user precedent in
-- bulk_set_employee_availability.test.sql).
CREATE OR REPLACE FUNCTION test_set_caller(uid UUID) RETURNS VOID
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', uid::text, true);
$$;

-- ---------- 1. operations_manager may link a member account ----------
SELECT test_set_caller('f1111111-1111-1111-1111-111111111101');

SELECT ok(
  (SELECT success FROM link_employee_to_user(
    'f2222222-2222-2222-2222-222222222201',
    'f1111111-1111-1111-1111-111111111105'
  )),
  'operations_manager can link an employee to a member account'
);

-- ---------- 2. chef may not ----------
SELECT test_set_caller('f1111111-1111-1111-1111-111111111102');

SELECT ok(
  NOT (SELECT success FROM link_employee_to_user(
    'f2222222-2222-2222-2222-222222222202',
    'f1111111-1111-1111-1111-111111111105'
  )),
  'chef cannot link'
);

-- ---------- 3. a caller from another restaurant may not ----------
SELECT test_set_caller('f1111111-1111-1111-1111-111111111103');

SELECT ok(
  NOT (SELECT success FROM link_employee_to_user(
    'f2222222-2222-2222-2222-222222222202',
    'f1111111-1111-1111-1111-111111111105'
  )),
  'cross-restaurant caller cannot link'
);

-- ---------- 4. unauthorized callers get one non-committal message for both
--    "no such employee" and "exists but not yours" (still the outsider
--    caller from test 3 — SET LOCAL persists for the rest of this
--    transaction) ----------
SELECT is(
  (SELECT message FROM link_employee_to_user(
    gen_random_uuid(),
    'f1111111-1111-1111-1111-111111111105'
  )),
  (SELECT message FROM link_employee_to_user(
    'f2222222-2222-2222-2222-222222222202',
    'f1111111-1111-1111-1111-111111111105'
  )),
  'existence is not distinguishable from lack of authorization'
);

-- ---------- 5 & 6. relinking to the SAME account is idempotent success and
--    reports the already-linked state ---------- (employee 201 linked in test 1)
SELECT test_set_caller('f1111111-1111-1111-1111-111111111101');

SELECT ok(
  (SELECT success FROM link_employee_to_user(
    'f2222222-2222-2222-2222-222222222201',
    'f1111111-1111-1111-1111-111111111105'
  )),
  'relinking to the same account is idempotent (success = TRUE)'
);

SELECT matches(
  (SELECT message FROM link_employee_to_user(
    'f2222222-2222-2222-2222-222222222201',
    'f1111111-1111-1111-1111-111111111105'
  )),
  'already linked',
  'second call reports already-linked rather than a generic failure'
);

-- ---------- 7. owner may still link (no regression). Links to member 106,
--    who is not yet linked to any employee — linking to 105 here would create
--    the duplicate (user_id, restaurant_id) that test 11 now forbids. ----------
SELECT test_set_caller('f1111111-1111-1111-1111-111111111104');

SELECT ok(
  (SELECT success FROM link_employee_to_user(
    'f2222222-2222-2222-2222-222222222203',
    'f1111111-1111-1111-1111-111111111106'
  )),
  'owner can still link'
);

-- ---------- 8 & 9. linking to an account that is not a member of the
--    restaurant is denied — the cross-tenant grant this hardening closes.
--    Employee 202 is still unlinked; 107 is a real account belonging to no
--    restaurant. ----------
SELECT test_set_caller('f1111111-1111-1111-1111-111111111101');

SELECT ok(
  NOT (SELECT success FROM link_employee_to_user(
    'f2222222-2222-2222-2222-222222222202',
    'f1111111-1111-1111-1111-111111111107'
  )),
  'linking to a non-member account is denied'
);

SELECT matches(
  (SELECT message FROM link_employee_to_user(
    'f2222222-2222-2222-2222-222222222202',
    'f1111111-1111-1111-1111-111111111107'
  )),
  'not a member',
  'non-member denial names the reason'
);

-- ---------- 10. relinking an already-linked employee to a DIFFERENT account
--    is a conflict ---------- (employee 201 is linked to 105; 106 is another
--    member of the same restaurant)
SELECT ok(
  NOT (SELECT success FROM link_employee_to_user(
    'f2222222-2222-2222-2222-222222222201',
    'f1111111-1111-1111-1111-111111111106'
  )),
  'relinking to a different account is a conflict'
);

-- ---------- 11 & 12. linking an unlinked employee (202) to an account (105)
--    that is ALREADY linked to another employee in this restaurant (201, from
--    test 1) is denied — a second (user_id, restaurant_id) row would make
--    useCurrentEmployee's .single() lookup return multiple rows and silently
--    read as "no employee". ----------
SELECT test_set_caller('f1111111-1111-1111-1111-111111111101');

SELECT ok(
  NOT (SELECT success FROM link_employee_to_user(
    'f2222222-2222-2222-2222-222222222202',
    'f1111111-1111-1111-1111-111111111105'
  )),
  'linking an account already linked to another employee is denied'
);

SELECT matches(
  (SELECT message FROM link_employee_to_user(
    'f2222222-2222-2222-2222-222222222202',
    'f1111111-1111-1111-1111-111111111105'
  )),
  'already linked to another employee',
  'duplicate-employee denial names the reason'
);

SELECT * FROM finish();
ROLLBACK;
