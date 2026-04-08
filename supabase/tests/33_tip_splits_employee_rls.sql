-- ============================================================================
-- Tests for Employee Tip Splits RLS Policies
--
-- Verifies that staff/employees can read approved/archived tip_splits for their
-- restaurant, but NOT draft splits. Without these policies, the usePayroll hook
-- returns $0 tips for staff because the tip_splits query is blocked by RLS.
--
-- Also verifies the prerequisite employee self-view policy on the employees
-- table. Without it, subqueries like EXISTS(SELECT 1 FROM employees WHERE
-- user_id = auth.uid()) return 0 rows for staff users because the employees
-- table RLS only grants SELECT to users with 'view:employees' capability.
--
-- Migration: 20260220000000_add_staff_tip_read_policies.sql
-- ============================================================================

BEGIN;
SELECT plan(9);

-- ============================================================================
-- Test 1: Verify the employee self-view policy exists on employees table
-- ============================================================================

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'employees'
    AND policyname = 'Employees can view their own record'
    AND cmd = 'SELECT'
  ),
  'Employee self-view SELECT policy should exist on employees table'
);

-- ============================================================================
-- Test 2: Verify the employee SELECT policy exists on tip_splits
-- ============================================================================

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tip_splits'
    AND policyname = 'Employees can view approved tip splits'
    AND cmd = 'SELECT'
  ),
  'Employee SELECT policy should exist on tip_splits'
);

-- ============================================================================
-- Test 3: Verify existing manager policies still exist alongside new one
-- ============================================================================

SELECT policies_are(
    'public',
    'tip_splits',
    ARRAY[
        'Managers can view tip splits',
        'Managers can insert tip splits',
        'Managers can update tip splits',
        'Managers can delete tip splits',
        'Employees can view approved tip splits'
    ],
    'tip_splits table should have all expected policies (manager CRUD + employee SELECT)'
);

-- ============================================================================
-- Test 4: Verify the employee policy is SELECT-only (no INSERT/UPDATE/DELETE)
-- ============================================================================

SELECT policy_cmd_is(
    'public',
    'tip_splits',
    'Employees can view approved tip splits',
    'select',
    'Employee tip splits policy should be SELECT only'
);

-- ============================================================================
-- Test 5-9: Functional RLS tests with JWT context switching
-- ============================================================================

-- Setup: Disable RLS for test data creation
SET LOCAL role TO postgres;
ALTER TABLE tip_splits DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;

-- Create test data
INSERT INTO restaurants (id, name) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Tips Test Restaurant'),
  ('a0000000-0000-0000-0000-000000000002', 'Other Restaurant')
ON CONFLICT (id) DO NOTHING;

-- Create test auth users
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('a0000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff_tips@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('a0000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff_other@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Create employees linked to users
INSERT INTO employees (id, restaurant_id, user_id, name, email, position, is_active) VALUES
  ('a0000000-0000-0000-0000-000000000100', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000010', 'Staff Member', 'staff_tips@test.com', 'Server', true),
  ('a0000000-0000-0000-0000-000000000200', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000020', 'Other Staff', 'staff_other@test.com', 'Server', true)
ON CONFLICT (id) DO UPDATE SET is_active = true;

-- Create tip splits with different statuses
INSERT INTO tip_splits (id, restaurant_id, split_date, total_amount, status) VALUES
  ('a0000000-0000-0000-0000-000000001001', 'a0000000-0000-0000-0000-000000000001', '2026-02-15', 10000, 'approved'),
  ('a0000000-0000-0000-0000-000000001002', 'a0000000-0000-0000-0000-000000000001', '2026-02-16', 8000, 'archived'),
  ('a0000000-0000-0000-0000-000000001003', 'a0000000-0000-0000-0000-000000000001', '2026-02-17', 12000, 'draft'),
  ('a0000000-0000-0000-0000-000000001004', 'a0000000-0000-0000-0000-000000000002', '2026-02-15', 5000, 'approved')
ON CONFLICT (id) DO NOTHING;

-- Re-enable RLS
ALTER TABLE tip_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Test 5: Employee CAN read approved tip_splits for their restaurant
-- ============================================================================

-- Switch to staff user context
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000010", "role": "authenticated"}';

SELECT is(
  (SELECT COUNT(*) FROM tip_splits
   WHERE id = 'a0000000-0000-0000-0000-000000001001'),
  1::bigint,
  'Employee should see approved tip_splits for their restaurant'
);

-- ============================================================================
-- Test 6: Employee CAN read archived tip_splits for their restaurant
-- ============================================================================

SELECT is(
  (SELECT COUNT(*) FROM tip_splits
   WHERE id = 'a0000000-0000-0000-0000-000000001002'),
  1::bigint,
  'Employee should see archived tip_splits for their restaurant'
);

-- ============================================================================
-- Test 7: Employee CANNOT read draft tip_splits (even for their restaurant)
-- ============================================================================

SELECT is(
  (SELECT COUNT(*) FROM tip_splits
   WHERE id = 'a0000000-0000-0000-0000-000000001003'),
  0::bigint,
  'Employee should NOT see draft tip_splits'
);

-- ============================================================================
-- Test 8: Employee CANNOT read tip_splits from another restaurant
-- ============================================================================

SELECT is(
  (SELECT COUNT(*) FROM tip_splits
   WHERE id = 'a0000000-0000-0000-0000-000000001004'),
  0::bigint,
  'Employee should NOT see tip_splits from another restaurant'
);

-- ============================================================================
-- Test 9: Employee sees correct count (approved + archived only, own restaurant)
-- ============================================================================

SELECT is(
  (SELECT COUNT(*) FROM tip_splits),
  2::bigint,
  'Employee should see exactly 2 tip_splits (1 approved + 1 archived for their restaurant)'
);

-- ============================================================================
-- Cleanup
-- ============================================================================
SELECT * FROM finish();
ROLLBACK;
