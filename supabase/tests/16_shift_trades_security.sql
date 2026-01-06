-- Test: shift_trades RLS and constraint fixes
-- Tests for migration 20260104120000 and 20260105000000

BEGIN;
SELECT plan(11);

-- Setup: Disable RLS for test data creation
SET LOCAL role TO postgres;
ALTER TABLE shift_trades DISABLE ROW LEVEL SECURITY;
ALTER TABLE shifts DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;

-- Create test data
INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-000000000011', 'Test Restaurant')
ON CONFLICT (id) DO NOTHING;

-- Create test users in auth.users (needed for employee foreign keys)
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'emp1@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'emp2@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO employees (id, restaurant_id, user_id, name, email, position, is_active) VALUES
  ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'Employee 1', 'emp1@test.com', 'Server', true),
  ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000002', 'Employee 2', 'emp2@test.com', 'Server', true)
ON CONFLICT (id) DO UPDATE SET is_active = true;

INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, break_duration) VALUES
  ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000021', '2026-01-10 09:00:00+00', '2026-01-10 17:00:00+00', 'Server', 30),
  ('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000022', '2026-01-11 09:00:00+00', '2026-01-11 17:00:00+00', 'Server', 30)
ON CONFLICT (id) DO UPDATE SET position = 'Server';

-- Clean up any existing trades
DELETE FROM shift_trades WHERE restaurant_id = '00000000-0000-0000-0000-000000000011';

-- ============================================================
-- TEST CATEGORY 1: Unique Active Trade Constraint
-- ============================================================

-- Test 1: Should allow creating one open trade
SELECT lives_ok(
  $$INSERT INTO shift_trades (id, restaurant_id, offered_shift_id, offered_by_employee_id, status)
    VALUES ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000021', 'open')$$,
  'Should allow creating one open trade for a shift'
);

-- Test 2: Should prevent creating second open trade for same shift
SELECT throws_ok(
  $$INSERT INTO shift_trades (id, restaurant_id, offered_shift_id, offered_by_employee_id, status)
    VALUES ('00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000021', 'open')$$,
  '23505', -- unique_violation
  NULL,
  'Should prevent multiple open trades for same shift'
);

-- Test 3: Should allow creating pending_approval trade when no other active trades exist
DELETE FROM shift_trades WHERE offered_shift_id = '00000000-0000-0000-0000-000000000031';
INSERT INTO shift_trades (id, restaurant_id, offered_shift_id, offered_by_employee_id, status)
  VALUES ('00000000-0000-0000-0000-000000000043', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000021', 'pending_approval');

SELECT is(
  (SELECT COUNT(*) FROM shift_trades WHERE offered_shift_id = '00000000-0000-0000-0000-000000000031' AND status = 'pending_approval'),
  1::bigint,
  'Should allow creating pending_approval trade'
);

-- Test 4: Should prevent second pending_approval trade for same shift
SELECT throws_ok(
  $$INSERT INTO shift_trades (id, restaurant_id, offered_shift_id, offered_by_employee_id, status)
    VALUES ('00000000-0000-0000-0000-000000000044', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000021', 'pending_approval')$$,
  '23505',
  NULL,
  'Should prevent multiple pending_approval trades for same shift'
);

-- Test 5: Should allow multiple approved/rejected/cancelled trades (non-active statuses)
DELETE FROM shift_trades WHERE offered_shift_id = '00000000-0000-0000-0000-000000000032';
INSERT INTO shift_trades (id, restaurant_id, offered_shift_id, offered_by_employee_id, status)
  VALUES 
    ('00000000-0000-0000-0000-000000000045', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000022', 'approved'),
    ('00000000-0000-0000-0000-000000000046', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000022', 'rejected'),
    ('00000000-0000-0000-0000-000000000047', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000022', 'cancelled');

SELECT is(
  (SELECT COUNT(*) FROM shift_trades WHERE offered_shift_id = '00000000-0000-0000-0000-000000000032'),
  3::bigint,
  'Should allow multiple completed trades (approved/rejected/cancelled) for same shift'
);

-- ============================================================
-- TEST CATEGORY 2: Employee UPDATE Policy Restrictions
-- ============================================================

-- Test 6: Verify employees can update to pending_approval (accept trade)
DELETE FROM shift_trades WHERE offered_shift_id = '00000000-0000-0000-0000-000000000031';
INSERT INTO shift_trades (id, restaurant_id, offered_shift_id, offered_by_employee_id, status)
  VALUES ('00000000-0000-0000-0000-000000000048', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000021', 'open');

-- Simulate employee update (would be blocked by RLS in real scenario, testing constraint)
UPDATE shift_trades SET status = 'pending_approval' WHERE id = '00000000-0000-0000-0000-000000000048';

SELECT is(
  (SELECT status FROM shift_trades WHERE id = '00000000-0000-0000-0000-000000000048'),
  'pending_approval'::text,
  'Should allow updating trade to pending_approval'
);

-- Test 7: Verify employees can update to cancelled
UPDATE shift_trades SET status = 'cancelled' WHERE id = '00000000-0000-0000-0000-000000000048';

SELECT is(
  (SELECT status FROM shift_trades WHERE id = '00000000-0000-0000-0000-000000000048'),
  'cancelled'::text,
  'Should allow updating trade to cancelled'
);

-- ============================================================
-- TEST CATEGORY 3: DELETE Policies Exist
-- ============================================================

-- Test 8: Verify "Employees can delete their own cancelled trades" policy exists
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'shift_trades'
    AND policyname = 'Employees can delete their own cancelled trades'
    AND cmd = 'DELETE'
  ),
  'DELETE policy for employees should exist'
);

-- Test 9: Verify "Managers can delete shift trades" policy exists
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'shift_trades'
    AND policyname = 'Managers can delete shift trades'
    AND cmd = 'DELETE'
  ),
  'DELETE policy for managers should exist'
);

-- ============================================================
-- TEST CATEGORY 4: RLS Policy Comments
-- ============================================================

-- Test 10: Verify INSERT policy has helpful comment
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_description d
    JOIN pg_policy p ON d.objoid = p.oid
    WHERE p.polname = 'Employees can create trades for their own shifts'
    AND d.description LIKE '%employee and restaurant must match%'
  ),
  'INSERT policy should have descriptive comment'
);

-- Test 11: Verify DELETE policies have comments
SELECT ok(
  (SELECT COUNT(*) FROM pg_description d
   JOIN pg_policy p ON d.objoid = p.oid
   WHERE p.polrelid = 'shift_trades'::regclass
   AND p.polcmd = 'd'
   AND d.description IS NOT NULL) >= 2,
  'DELETE policies should have descriptive comments'
);

-- ============================================================
-- Cleanup
-- ============================================================
SELECT * FROM finish();
ROLLBACK;
