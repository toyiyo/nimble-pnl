-- Test: deactivate_employee function with termination_date parameter
-- Tests the critical termination_date parameter for payroll calculations

BEGIN;
SELECT plan(8);

-- Setup: Disable RLS and create test data
SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000001"}';

-- Create test restaurant
INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-0000000DEAC1', 'Test Restaurant Deactivation')
ON CONFLICT (id) DO NOTHING;

-- Create test employee
INSERT INTO employees (
  id,
  restaurant_id,
  name,
  email,
  position,
  status,
  is_active,
  compensation_type,
  salary_amount,
  pay_period_type,
  hire_date
) VALUES (
  '00000000-0000-0000-0000-0000000DEAC2',
  '00000000-0000-0000-0000-0000000DEAC1',
  'Test Employee',
  'test.deactivate@example.com',
  'Manager',
  'active',
  true,
  'salary',
  500000, -- $5,000 per pay period
  'bi-weekly',
  '2025-01-01'
)
ON CONFLICT (id) DO UPDATE SET
  status = 'active',
  is_active = true,
  termination_date = NULL,
  deactivated_at = NULL,
  deactivated_by = NULL,
  deactivation_reason = NULL;

-- ============================================================
-- TEST 1: Function deactivates employee with today's termination date
-- ============================================================

SELECT lives_ok(
  $$
  SELECT deactivate_employee(
    '00000000-0000-0000-0000-0000000DEAC2'::UUID,
    '00000000-0000-0000-0000-000000000001'::UUID,
    'seasonal'::TEXT,
    true,
    CURRENT_DATE
  )
  $$,
  'deactivate_employee should succeed with termination date'
);

SELECT is(
  (SELECT is_active FROM employees WHERE id = '00000000-0000-0000-0000-0000000DEAC2'),
  false,
  'Employee should be marked as inactive'
);

SELECT is(
  (SELECT status FROM employees WHERE id = '00000000-0000-0000-0000-0000000DEAC2'),
  'inactive',
  'Employee status should be inactive'
);

SELECT is(
  (SELECT termination_date FROM employees WHERE id = '00000000-0000-0000-0000-0000000DEAC2'),
  CURRENT_DATE,
  'Termination date should be set to today'
);

SELECT is(
  (SELECT deactivation_reason FROM employees WHERE id = '00000000-0000-0000-0000-0000000DEAC2'),
  'seasonal',
  'Deactivation reason should be set'
);

-- ============================================================
-- TEST 2: Function accepts future termination date (two-week notice)
-- ============================================================

-- Reactivate employee first
UPDATE employees
SET
  is_active = true,
  status = 'active',
  termination_date = NULL,
  deactivated_at = NULL,
  deactivated_by = NULL,
  deactivation_reason = NULL
WHERE id = '00000000-0000-0000-0000-0000000DEAC2';

SELECT lives_ok(
  $$
  SELECT deactivate_employee(
    '00000000-0000-0000-0000-0000000DEAC2'::UUID,
    '00000000-0000-0000-0000-000000000001'::UUID,
    'left_company'::TEXT,
    false, -- Don't remove from future shifts yet
    (CURRENT_DATE + INTERVAL '14 days')::DATE -- Two weeks notice
  )
  $$,
  'deactivate_employee should accept future termination date'
);

SELECT is(
  (SELECT termination_date FROM employees WHERE id = '00000000-0000-0000-0000-0000000DEAC2'),
  (CURRENT_DATE + INTERVAL '14 days')::DATE,
  'CRITICAL: Termination date should be set to future date for two-week notice'
);

-- ============================================================
-- TEST 3: Verify termination_date is used by payroll (integration check)
-- ============================================================

-- This test verifies that the termination_date field is properly populated
-- and can be used by payroll calculations in compensationCalculations.ts
SELECT ok(
  (SELECT termination_date FROM employees WHERE id = '00000000-0000-0000-0000-0000000DEAC2') IS NOT NULL,
  'CRITICAL: Termination date must be set for payroll to stop salary allocations'
);

-- ============================================================
-- Cleanup
-- ============================================================
SELECT * FROM finish();
ROLLBACK;
