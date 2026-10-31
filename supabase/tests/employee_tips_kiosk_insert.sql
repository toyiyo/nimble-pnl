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
-- R1, R2: restaurants. K: kiosk service account of R1 (kiosk_service_accounts
-- row). Z: member of R1 with a self-assigned 'kiosk' role and no
-- kiosk_service_accounts row. S: staff of R1. M: manager of R1.
-- X: former member (no membership row). E1: employee of R1. E2: of R2.
-- ============================================================================

BEGIN;
SELECT plan(12);

SET LOCAL role TO postgres;

ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE employee_tips DISABLE ROW LEVEL SECURITY;
ALTER TABLE kiosk_service_accounts DISABLE ROW LEVEL SECURITY;

INSERT INTO restaurants (id, name) VALUES
  ('7b000000-0000-0000-0000-000000000001', 'Kiosk Tips RLS Restaurant 1'),
  ('7b000000-0000-0000-0000-000000000002', 'Kiosk Tips RLS Restaurant 2');

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('7b000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kt-kiosk-7b@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('7b000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kt-staff-7b@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('7b000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kt-selfkiosk-7b@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('7b000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kt-manager-7b@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('7b000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kt-former-7b@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '');

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('7b000000-0000-0000-0000-000000000011', '7b000000-0000-0000-0000-000000000001', 'kiosk'),
  ('7b000000-0000-0000-0000-000000000012', '7b000000-0000-0000-0000-000000000001', 'staff'),
  ('7b000000-0000-0000-0000-000000000013', '7b000000-0000-0000-0000-000000000001', 'kiosk'),
  ('7b000000-0000-0000-0000-000000000014', '7b000000-0000-0000-0000-000000000001', 'manager');

INSERT INTO kiosk_service_accounts (restaurant_id, user_id, email) VALUES
  ('7b000000-0000-0000-0000-000000000001', '7b000000-0000-0000-0000-000000000011', 'kt-kiosk-7b@test.com');

INSERT INTO employees (id, restaurant_id, user_id, name, email, position, is_active) VALUES
  ('7b000000-0000-0000-0000-000000000021', '7b000000-0000-0000-0000-000000000001', NULL, 'Employee E1', 'kt-e1-7b@test.com', 'Server', true),
  ('7b000000-0000-0000-0000-000000000022', '7b000000-0000-0000-0000-000000000002', NULL, 'Employee E2', 'kt-e2-7b@test.com', 'Server', true);

-- ...031: tip that K created 1 day ago (outside the 5-minute window).
-- ...032: tip that the manager M created now.
-- ...033: tip that the former member X created now, before removal.
INSERT INTO employee_tips (id, restaurant_id, employee_id, tip_amount, tip_source, created_by, created_at) VALUES
  ('7b000000-0000-0000-0000-000000000031', '7b000000-0000-0000-0000-000000000001', '7b000000-0000-0000-0000-000000000021', 500, 'cash', '7b000000-0000-0000-0000-000000000011', now() - interval '1 day'),
  ('7b000000-0000-0000-0000-000000000032', '7b000000-0000-0000-0000-000000000001', '7b000000-0000-0000-0000-000000000021', 700, 'cash', '7b000000-0000-0000-0000-000000000014', now()),
  ('7b000000-0000-0000-0000-000000000033', '7b000000-0000-0000-0000-000000000001', '7b000000-0000-0000-0000-000000000021', 900, 'cash', '7b000000-0000-0000-0000-000000000015', now());

ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_tips ENABLE ROW LEVEL SECURITY;
ALTER TABLE kiosk_service_accounts ENABLE ROW LEVEL SECURITY;

RESET ROLE;

-- ============================================================================
-- Kiosk service account K
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

SELECT is(
  (SELECT COUNT(*) FROM employee_tips WHERE id = '7b000000-0000-0000-0000-000000000032'),
  0::bigint,
  'kiosk: does NOT see a tip that another user created now'
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

SELECT throws_ok(
  $$INSERT INTO employee_tips (restaurant_id, employee_id, tip_amount, tip_source, created_by)
    VALUES ('7b000000-0000-0000-0000-000000000001', '7b000000-0000-0000-0000-000000000021',
            100, 'pool', '7b000000-0000-0000-0000-000000000011')$$,
  '42501',
  NULL,
  'kiosk: cannot create a pool tip (the kiosk dialog sends cash or credit only)'
);

SELECT throws_ok(
  $$INSERT INTO employee_tips (restaurant_id, employee_id, tip_amount, tip_source, recorded_at, created_by)
    VALUES ('7b000000-0000-0000-0000-000000000001', '7b000000-0000-0000-0000-000000000021',
            100, 'cash', now() - interval '3 days', '7b000000-0000-0000-0000-000000000011')$$,
  '42501',
  NULL,
  'kiosk: cannot backdate a tip'
);

RESET ROLE;

-- ============================================================================
-- Member Z with a self-assigned 'kiosk' role (no kiosk_service_accounts row)
-- ============================================================================
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"7b000000-0000-0000-0000-000000000013","role":"authenticated"}', true);

SELECT throws_ok(
  $$INSERT INTO employee_tips (restaurant_id, employee_id, tip_amount, tip_source, created_by)
    VALUES ('7b000000-0000-0000-0000-000000000001', '7b000000-0000-0000-0000-000000000021',
            100, 'cash', '7b000000-0000-0000-0000-000000000013')$$,
  '42501',
  NULL,
  'self-assigned kiosk role: cannot create a tip for another employee'
);

RESET ROLE;

-- ============================================================================
-- Staff S and former member X
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

SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"7b000000-0000-0000-0000-000000000015","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM employee_tips WHERE id = '7b000000-0000-0000-0000-000000000033'),
  0::bigint,
  'former member: does NOT see a tip it created (membership check)'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
