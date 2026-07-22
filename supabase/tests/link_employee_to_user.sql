-- Test: link_employee_to_user authorization hardening
-- Tests for migration 20260722120000_link_employee_to_user_hardening.sql
--
-- Verifies:
--   1. operations_manager can link (previously excluded from the allowlist)
--   2. chef cannot link
--   3. a caller from another restaurant cannot link
--   4. an unauthorized caller gets one non-committal message whether the
--      employee exists or not (no existence leak)
--   5. relinking an already-linked employee reports the already-linked
--      state rather than a generic failure
--   6. owner can still link (no regression)

BEGIN;
SELECT plan(6);

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
  ('f1111111-1111-1111-1111-111111111105', 'target-user@test.com', '', 'authenticated', 'authenticated')
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  encrypted_password = EXCLUDED.encrypted_password,
  aud = EXCLUDED.aud,
  role = EXCLUDED.role;

-- Callers: operations_manager and chef and owner in the restaurant under
-- test; the outsider is a member of the OTHER restaurant only. The target
-- user being linked to is not a member of either restaurant.
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('f1111111-1111-1111-1111-111111111101', 'f0000000-0000-0000-0000-000000000001', 'operations_manager'),
  ('f1111111-1111-1111-1111-111111111102', 'f0000000-0000-0000-0000-000000000001', 'chef'),
  ('f1111111-1111-1111-1111-111111111103', 'f0000000-0000-0000-0000-000000000002', 'owner'),
  ('f1111111-1111-1111-1111-111111111104', 'f0000000-0000-0000-0000-000000000001', 'owner')
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

-- ---------- 1. operations_manager may link — they hold manage:employees ----------
SELECT test_set_caller('f1111111-1111-1111-1111-111111111101');

SELECT ok(
  (SELECT success FROM link_employee_to_user(
    'f2222222-2222-2222-2222-222222222201',
    'f1111111-1111-1111-1111-111111111105'
  )),
  'operations_manager can link an employee to an existing account'
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

-- ---------- 5. relinking an already-linked employee reports the
--    already-linked state ---------- (employee 201 was linked in test 1)
SELECT test_set_caller('f1111111-1111-1111-1111-111111111101');

SELECT matches(
  (SELECT message FROM link_employee_to_user(
    'f2222222-2222-2222-2222-222222222201',
    'f1111111-1111-1111-1111-111111111105'
  )),
  'already linked',
  'second call reports already-linked rather than a generic failure'
);

-- ---------- 6. owner may still link (no regression) ----------
SELECT test_set_caller('f1111111-1111-1111-1111-111111111104');

SELECT ok(
  (SELECT success FROM link_employee_to_user(
    'f2222222-2222-2222-2222-222222222203',
    'f1111111-1111-1111-1111-111111111105'
  )),
  'owner can still link'
);

SELECT * FROM finish();
ROLLBACK;
