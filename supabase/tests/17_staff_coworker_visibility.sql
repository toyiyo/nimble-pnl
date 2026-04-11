-- Test: Staff can view coworkers in their restaurant
-- Tests for migration 20260411100000_staff_can_view_coworkers.sql
-- Verifies that staff-role users can see other employees in their restaurant
-- via the "Team members can view coworkers in their restaurant" RLS policy.

BEGIN;
SELECT plan(4);

-- Setup: Create test data as postgres (bypasses RLS)
SET LOCAL role TO postgres;
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;

-- Create test restaurant
INSERT INTO restaurants (id, name) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Coworker Test Restaurant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO restaurants (id, name) VALUES
  ('a0000000-0000-0000-0000-000000000002', 'Other Restaurant')
ON CONFLICT (id) DO NOTHING;

-- Create test users
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('a0000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff_a@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('a0000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manager_b@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('a0000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff_other@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Create employees
INSERT INTO employees (id, restaurant_id, user_id, name, email, position, is_active) VALUES
  ('a0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000010', 'Staff A', 'staff_a@test.com', 'Server', true),
  ('a0000000-0000-0000-0000-000000000021', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000020', 'Manager B', 'manager_b@test.com', 'Manager', true),
  ('a0000000-0000-0000-0000-000000000031', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000030', 'Staff Other', 'staff_other@test.com', 'Server', true)
ON CONFLICT (id) DO UPDATE SET is_active = true;

-- Create user_restaurants associations (staff role for Staff A)
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('a0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001', 'staff'),
  ('a0000000-0000-0000-0000-000000000020', 'a0000000-0000-0000-0000-000000000001', 'manager'),
  ('a0000000-0000-0000-0000-000000000030', 'a0000000-0000-0000-0000-000000000002', 'staff')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- Re-enable RLS
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TEST 1: Policy exists
-- ============================================================
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'employees'
    AND policyname = 'Team members can view coworkers in their restaurant'
    AND cmd = 'SELECT'
  ),
  'Coworker visibility SELECT policy should exist on employees table'
);

-- ============================================================
-- TEST 2: Staff user can see coworkers (including manager) in same restaurant
-- ============================================================
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000000-0000-0000-0000-000000000010'; -- Staff A

SELECT is(
  (SELECT COUNT(*) FROM employees WHERE restaurant_id = 'a0000000-0000-0000-0000-000000000001'),
  2::bigint,
  'Staff A should see both employees (self + Manager B) in their restaurant'
);

-- ============================================================
-- TEST 3: Staff user cannot see employees in other restaurants
-- ============================================================
SELECT is(
  (SELECT COUNT(*) FROM employees WHERE restaurant_id = 'a0000000-0000-0000-0000-000000000002'),
  0::bigint,
  'Staff A should NOT see employees in other restaurants'
);

-- ============================================================
-- TEST 4: Staff user can read manager name (the actual marketplace use case)
-- ============================================================
SELECT is(
  (SELECT name FROM employees WHERE id = 'a0000000-0000-0000-0000-000000000021'),
  'Manager B'::text,
  'Staff A should be able to read manager name for shift trade display'
);

SELECT * FROM finish();
ROLLBACK;
