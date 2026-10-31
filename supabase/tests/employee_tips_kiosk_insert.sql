-- ============================================================================
-- Test: a kiosk service account can record a tip with INSERT ... RETURNING
--
-- The kiosk opens the tip dialog after a clock-out. useEmployeeTips sends
-- INSERT ... RETURNING on employee_tips. No INSERT policy admitted the role
-- 'kiosk', and no SELECT policy admitted the returned row. Every kiosk tip
-- then failed with "new row violates row-level security policy for table
-- employee_tips".
--
-- Design: docs/superpowers/specs/2026-10-31-kiosk-punch-returning-rls-design.md
--
-- Fixture namespace: UUIDs starting with 7b000000-...
-- R1, R2: restaurants. K: kiosk member of R1. S: staff member of R1.
-- E1: employee of R1. E2: employee of R2.
-- ============================================================================

BEGIN;
SELECT plan(7);

SET LOCAL role TO postgres;

ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE employee_tips DISABLE ROW LEVEL SECURITY;

INSERT INTO restaurants (id, name) VALUES
  ('7b000000-0000-0000-0000-000000000001', 'Kiosk Tips RLS Restaurant 1'),
  ('7b000000-0000-0000-0000-000000000002', 'Kiosk Tips RLS Restaurant 2');

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('7b000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kt-kiosk-7b@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('7b000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kt-staff-7b@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '');

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('7b000000-0000-0000-0000-000000000011', '7b000000-0000-0000-0000-000000000001', 'kiosk'),
  ('7b000000-0000-0000-0000-000000000012', '7b000000-0000-0000-0000-000000000001', 'staff');

INSERT INTO employees (id, restaurant_id, user_id, name, email, position, is_active) VALUES
  ('7b000000-0000-0000-0000-000000000021', '7b000000-0000-0000-0000-000000000001', NULL, 'Employee E1', 'kt-e1-7b@test.com', 'Server', true),
  ('7b000000-0000-0000-0000-000000000022', '7b000000-0000-0000-0000-000000000002', NULL, 'Employee E2', 'kt-e2-7b@test.com', 'Server', true);

-- ...031: tip that the kiosk created 1 day ago (outside the 5-minute window).
INSERT INTO employee_tips (id, restaurant_id, employee_id, tip_amount, tip_source, created_by, created_at) VALUES
  ('7b000000-0000-0000-0000-000000000031', '7b000000-0000-0000-0000-000000000001', '7b000000-0000-0000-0000-000000000021', 500, 'cash', '7b000000-0000-0000-0000-000000000011', now() - interval '1 day');

ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_tips ENABLE ROW LEVEL SECURITY;

RESET ROLE;

-- ============================================================================
-- Kiosk K
-- ============================================================================
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"7b000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO employee_tips (id, restaurant_id, employee_id, tip_amount, tip_source, created_by)
    VALUES ('7b000000-0000-0000-0000-000000000041', '7b000000-0000-0000-0000-000000000001',
            '7b000000-0000-0000-0000-000000000021', 1250, 'cash',
            '7b000000-0000-0000-0000-000000000011')
    RETURNING *$$,
  'kiosk: INSERT ... RETURNING of a tip lives (the regression)'
);

SELECT is(
  (SELECT COUNT(*) FROM employee_tips WHERE id = '7b000000-0000-0000-0000-000000000041'),
  1::bigint,
  'kiosk: sees the tip it created now'
);

SELECT is(
  (SELECT COUNT(*) FROM employee_tips WHERE id = '7b000000-0000-0000-0000-000000000031'),
  0::bigint,
  'kiosk: does NOT see a tip it created 1 day ago (5-minute window)'
);

SELECT throws_ok(
  $$INSERT INTO employee_tips (restaurant_id, employee_id, tip_amount, tip_source, created_by)
    VALUES ('7b000000-0000-0000-0000-000000000001', '7b000000-0000-0000-0000-000000000022',
            100, 'cash', '7b000000-0000-0000-0000-000000000011')$$,
  '42501',
  NULL,
  'kiosk: cannot create a tip for an employee of another restaurant'
);

SELECT throws_ok(
  $$INSERT INTO employee_tips (restaurant_id, employee_id, tip_amount, tip_source, created_by)
    VALUES ('7b000000-0000-0000-0000-000000000002', '7b000000-0000-0000-0000-000000000022',
            100, 'cash', '7b000000-0000-0000-0000-000000000011')$$,
  '42501',
  NULL,
  'kiosk: cannot create a tip in a restaurant it is not a member of'
);

SELECT throws_ok(
  $$INSERT INTO employee_tips (restaurant_id, employee_id, tip_amount, tip_source, created_by)
    VALUES ('7b000000-0000-0000-0000-000000000001', '7b000000-0000-0000-0000-000000000021',
            100, 'cash', '7b000000-0000-0000-0000-000000000012')$$,
  '42501',
  NULL,
  'kiosk: cannot create a tip with created_by set to another user'
);

RESET ROLE;

-- ============================================================================
-- Staff S: the kiosk branch does not apply to staff
-- ============================================================================
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"7b000000-0000-0000-0000-000000000012","role":"authenticated"}', true);

SELECT throws_ok(
  $$INSERT INTO employee_tips (restaurant_id, employee_id, tip_amount, tip_source, created_by)
    VALUES ('7b000000-0000-0000-0000-000000000001', '7b000000-0000-0000-0000-000000000021',
            100, 'cash', '7b000000-0000-0000-0000-000000000012')$$,
  '42501',
  NULL,
  'staff: cannot create a tip for another employee'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
