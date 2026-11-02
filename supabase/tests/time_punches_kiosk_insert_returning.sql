-- ============================================================================
-- Test: a kiosk service account can record a punch with INSERT ... RETURNING
--
-- useCreateTimePunch sends `.insert(...).select().single()`, which is
-- INSERT ... RETURNING. Postgres applies the SELECT policies to the returned
-- row. The kiosk role has no view:scheduling or view:payroll capability.
-- It has no employees row. Thus no SELECT policy admitted the row, and the
-- insert failed with "new row violates row-level security policy for table
-- time_punches".
--
-- The fix is a bounded SELECT policy: a current member can read a punch that
-- the member created in the last 5 minutes.
--
-- Design: docs/superpowers/specs/2026-10-31-kiosk-punch-returning-rls-design.md
--
-- Fixture namespace: UUIDs starting with 7a000000-...
-- R1, R2: restaurants. K: kiosk member of R1. S, CW: staff members of R1 with
-- employees rows. M: manager of R1. X: former member (no membership row).
-- ============================================================================

BEGIN;
SELECT plan(12);

SET LOCAL role TO postgres;

ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE time_punches DISABLE ROW LEVEL SECURITY;

INSERT INTO restaurants (id, name) VALUES
  ('7a000000-0000-0000-0000-000000000001', 'Kiosk Returning RLS Restaurant 1'),
  ('7a000000-0000-0000-0000-000000000002', 'Kiosk Returning RLS Restaurant 2');

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('7a000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kr-kiosk-7a@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('7a000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kr-staff-7a@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('7a000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kr-coworker-7a@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('7a000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kr-manager-7a@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('7a000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kr-former-7a@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '');

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('7a000000-0000-0000-0000-000000000011', '7a000000-0000-0000-0000-000000000001', 'kiosk'),
  ('7a000000-0000-0000-0000-000000000012', '7a000000-0000-0000-0000-000000000001', 'staff'),
  ('7a000000-0000-0000-0000-000000000013', '7a000000-0000-0000-0000-000000000001', 'staff'),
  ('7a000000-0000-0000-0000-000000000014', '7a000000-0000-0000-0000-000000000001', 'manager');

INSERT INTO employees (id, restaurant_id, user_id, name, email, position, is_active) VALUES
  ('7a000000-0000-0000-0000-000000000021', '7a000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000012', 'Staff S', 'kr-staff-7a@test.com', 'Server', true),
  ('7a000000-0000-0000-0000-000000000022', '7a000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000013', 'Coworker CW', 'kr-coworker-7a@test.com', 'Server', true),
  ('7a000000-0000-0000-0000-000000000023', '7a000000-0000-0000-0000-000000000002', NULL, 'Other R2', 'kr-other-7a@test.com', 'Server', true);

-- ...031: kiosk punch from 1 day ago (outside the 5-minute window).
-- ...032: CW punch that the manager created now.
-- ...033: punch that the former member X created now, before removal.
-- ...034, ...035: kiosk punches 4 and 6 minutes old (the window edges).
-- ...036: R2 punch with created_by = K. K is not a member of R2.
INSERT INTO time_punches (id, restaurant_id, employee_id, punch_type, punch_time, created_by, created_at) VALUES
  ('7a000000-0000-0000-0000-000000000031', '7a000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000022', 'clock_in', now() - interval '1 day', '7a000000-0000-0000-0000-000000000011', now() - interval '1 day'),
  ('7a000000-0000-0000-0000-000000000032', '7a000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000022', 'clock_in', now(), '7a000000-0000-0000-0000-000000000014', now()),
  ('7a000000-0000-0000-0000-000000000033', '7a000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000022', 'clock_out', now(), '7a000000-0000-0000-0000-000000000015', now()),
  ('7a000000-0000-0000-0000-000000000034', '7a000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000022', 'clock_in', now() - interval '4 minutes', '7a000000-0000-0000-0000-000000000011', now() - interval '4 minutes'),
  ('7a000000-0000-0000-0000-000000000035', '7a000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000022', 'clock_in', now() - interval '6 minutes', '7a000000-0000-0000-0000-000000000011', now() - interval '6 minutes'),
  ('7a000000-0000-0000-0000-000000000036', '7a000000-0000-0000-0000-000000000002', '7a000000-0000-0000-0000-000000000023', 'clock_in', now(), '7a000000-0000-0000-0000-000000000011', now());

ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_punches ENABLE ROW LEVEL SECURITY;

RESET ROLE;

-- ============================================================================
-- Kiosk K
-- ============================================================================
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"7a000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO time_punches (id, restaurant_id, employee_id, punch_type, punch_time, notes, created_by)
    VALUES ('7a000000-0000-0000-0000-000000000041', '7a000000-0000-0000-0000-000000000001',
            '7a000000-0000-0000-0000-000000000021', 'clock_in', now(), 'Kiosk PIN punch',
            '7a000000-0000-0000-0000-000000000011')
    RETURNING *$$,
  'kiosk: INSERT ... RETURNING of a punch lives (the regression)'
);

SELECT is(
  (SELECT COUNT(*) FROM time_punches WHERE id = '7a000000-0000-0000-0000-000000000041'),
  1::bigint,
  'kiosk: sees the punch it created now'
);

SELECT is(
  (SELECT COUNT(*) FROM time_punches WHERE id = '7a000000-0000-0000-0000-000000000031'),
  0::bigint,
  'kiosk: does NOT see a punch it created 1 day ago (5-minute window)'
);

SELECT is(
  (SELECT COUNT(*) FROM time_punches WHERE id = '7a000000-0000-0000-0000-000000000032'),
  0::bigint,
  'kiosk: does NOT see a punch that another user created'
);

SELECT is(
  (SELECT COUNT(*) FROM time_punches WHERE id = '7a000000-0000-0000-0000-000000000034'),
  1::bigint,
  'kiosk: sees a punch it created 4 minutes ago (inside the window)'
);

SELECT is(
  (SELECT COUNT(*) FROM time_punches WHERE id = '7a000000-0000-0000-0000-000000000035'),
  0::bigint,
  'kiosk: does NOT see a punch it created 6 minutes ago (outside the window)'
);

SELECT is(
  (SELECT COUNT(*) FROM time_punches WHERE id = '7a000000-0000-0000-0000-000000000036'),
  0::bigint,
  'kiosk: does NOT see its own punch in a restaurant it is not a member of'
);

SELECT throws_ok(
  $$INSERT INTO time_punches (restaurant_id, employee_id, punch_type, punch_time, created_by)
    VALUES ('7a000000-0000-0000-0000-000000000002', '7a000000-0000-0000-0000-000000000023',
            'clock_in', now(), '7a000000-0000-0000-0000-000000000011')$$,
  '42501',
  NULL,
  'kiosk: cannot insert a punch into a restaurant it is not a member of'
);

RESET ROLE;

-- ============================================================================
-- Former member X (no membership row)
-- ============================================================================
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"7a000000-0000-0000-0000-000000000015","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM time_punches WHERE id = '7a000000-0000-0000-0000-000000000033'),
  0::bigint,
  'former member: does NOT see a punch it created (membership check)'
);

RESET ROLE;

-- ============================================================================
-- Staff S: self-scope stays
-- ============================================================================
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"7a000000-0000-0000-0000-000000000012","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM time_punches WHERE id = '7a000000-0000-0000-0000-000000000032'),
  0::bigint,
  'staff: does NOT see a coworker punch'
);

SELECT is(
  (SELECT COUNT(*) FROM time_punches WHERE id = '7a000000-0000-0000-0000-000000000041'),
  1::bigint,
  'staff: sees own punch that the kiosk recorded'
);

RESET ROLE;

-- ============================================================================
-- Manager M: bulk INSERT ... RETURNING returns every row
-- ============================================================================
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"7a000000-0000-0000-0000-000000000014","role":"authenticated"}', true);

WITH ins AS (
  INSERT INTO time_punches (restaurant_id, employee_id, punch_type, punch_time, created_by) VALUES
    ('7a000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000021', 'clock_in', now() - interval '2 hours', '7a000000-0000-0000-0000-000000000014'),
    ('7a000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000022', 'clock_in', now() - interval '2 hours', '7a000000-0000-0000-0000-000000000014')
  RETURNING id
)
SELECT is(COUNT(*), 2::bigint, 'manager: bulk INSERT ... RETURNING returns both rows') FROM ins;

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
