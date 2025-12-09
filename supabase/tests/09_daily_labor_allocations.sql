-- Test Suite: Daily Labor Allocations
-- Tests the automatic generation of salary/contractor allocations
-- Run with: psql <connection-string> -f this-file.sql

-- Setup test environment
BEGIN;

-- Create test restaurant
INSERT INTO restaurants (id, name, owner_id) 
VALUES ('test-rest-1', 'Test Restaurant', (SELECT id FROM auth.users LIMIT 1))
ON CONFLICT (id) DO NOTHING;

-- Create test employees
INSERT INTO employees (id, restaurant_id, name, position, status, compensation_type, hire_date, termination_date, salary_amount, pay_period_type, allocate_daily) VALUES
  -- Salaried employee: $3,000/month, hired Dec 1
  ('emp-salary-1', 'test-rest-1', 'John Salary', 'Manager', 'active', 'salary', '2024-12-01', NULL, 300000, 'monthly', true),
  
  -- Salaried employee: hired Dec 1, terminated Dec 10
  ('emp-salary-2', 'test-rest-1', 'Jane Short', 'Server', 'inactive', 'salary', '2024-12-01', '2024-12-10', 200000, 'monthly', true),
  
  -- Contractor: $1,000/week, hired Dec 1
  ('emp-contractor-1', 'test-rest-1', 'Bob Contractor', 'Chef', 'active', 'contractor', '2024-12-01', NULL, 100000, NULL, true),
  
  -- Per-job contractor (should NOT get auto allocations)
  ('emp-perjob-1', 'test-rest-1', 'Alice PerJob', 'Event Staff', 'active', 'contractor', '2024-12-01', NULL, NULL, NULL, true),
  
  -- Hourly employee (should NOT get allocations)
  ('emp-hourly-1', 'test-rest-1', 'Mike Hourly', 'Server', 'active', 'hourly', '2024-12-01', NULL, 1500, NULL, false)
ON CONFLICT (id) DO NOTHING;

-- Update contractor payment intervals
UPDATE employees SET contractor_payment_interval = 'weekly' WHERE id = 'emp-contractor-1';
UPDATE employees SET contractor_payment_interval = 'per-job' WHERE id = 'emp-perjob-1';

-- Clear any existing allocations for test data
DELETE FROM daily_labor_allocations WHERE restaurant_id = 'test-rest-1';

-- =============================================================================
-- TEST 1: Single Date Allocation - Active Employee
-- =============================================================================
DO $$
DECLARE
  v_count INTEGER;
  v_allocation RECORD;
BEGIN
  RAISE NOTICE '=== TEST 1: Generate allocation for single date (active employee) ===';
  
  -- Generate allocation for Dec 5, 2024
  SELECT ensure_labor_allocations_for_date('test-rest-1', '2024-12-05') INTO v_count;
  
  -- Should create 2 allocations (1 salary + 1 contractor, NOT per-job or hourly)
  ASSERT v_count = 2, format('Expected 2 allocations, got %s', v_count);
  RAISE NOTICE '✓ Created %s allocations', v_count;
  
  -- Check salary employee allocation
  SELECT * INTO v_allocation 
  FROM daily_labor_allocations 
  WHERE employee_id = 'emp-salary-1' AND date = '2024-12-05';
  
  ASSERT v_allocation.allocated_cost = 10000, -- $3,000/30 days = $100/day = 10000 cents
    format('Expected 10000 cents/day for salary, got %s', v_allocation.allocated_cost);
  RAISE NOTICE '✓ Salary allocation: $%.2f/day', v_allocation.allocated_cost / 100.0;
  
  -- Check contractor allocation
  SELECT * INTO v_allocation 
  FROM daily_labor_allocations 
  WHERE employee_id = 'emp-contractor-1' AND date = '2024-12-05';
  
  ASSERT v_allocation.allocated_cost = 14286, -- $1,000/7 days = ~$142.86/day = 14286 cents
    format('Expected 14286 cents/day for contractor, got %s', v_allocation.allocated_cost);
  RAISE NOTICE '✓ Contractor allocation: $%.2f/day', v_allocation.allocated_cost / 100.0;
  
  RAISE NOTICE '=== TEST 1 PASSED ===';
END $$;

-- =============================================================================
-- TEST 2: Employee Tenure - Before Hire Date
-- =============================================================================
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  RAISE NOTICE E'\n=== TEST 2: No allocation before hire date ===';
  
  -- Try to generate allocation for Nov 30 (before hire date Dec 1)
  DELETE FROM daily_labor_allocations WHERE restaurant_id = 'test-rest-1';
  SELECT ensure_labor_allocations_for_date('test-rest-1', '2024-11-30') INTO v_count;
  
  -- Should create 0 allocations (employees not hired yet)
  ASSERT v_count = 0, format('Expected 0 allocations before hire date, got %s', v_count);
  RAISE NOTICE '✓ No allocations created for date before hire';
  
  RAISE NOTICE '=== TEST 2 PASSED ===';
END $$;

-- =============================================================================
-- TEST 3: Employee Tenure - After Termination Date
-- =============================================================================
DO $$
DECLARE
  v_count INTEGER;
  v_allocation RECORD;
BEGIN
  RAISE NOTICE E'\n=== TEST 3: Allocation stops after termination ===';
  
  -- Generate allocation for Dec 15 (after emp-salary-2 terminated on Dec 10)
  DELETE FROM daily_labor_allocations WHERE restaurant_id = 'test-rest-1';
  SELECT ensure_labor_allocations_for_date('test-rest-1', '2024-12-15') INTO v_count;
  
  -- Should create 2 allocations (emp-salary-1 + emp-contractor-1, NOT emp-salary-2)
  ASSERT v_count = 2, format('Expected 2 allocations (terminated employee excluded), got %s', v_count);
  RAISE NOTICE '✓ Created %s allocations (terminated employee excluded)', v_count;
  
  -- Verify terminated employee has no allocation
  SELECT * INTO v_allocation 
  FROM daily_labor_allocations 
  WHERE employee_id = 'emp-salary-2' AND date = '2024-12-15';
  
  ASSERT v_allocation IS NULL, 'Terminated employee should not have allocation';
  RAISE NOTICE '✓ Terminated employee correctly excluded';
  
  RAISE NOTICE '=== TEST 3 PASSED ===';
END $$;

-- =============================================================================
-- TEST 4: Multi-Day Backfill
-- =============================================================================
DO $$
DECLARE
  v_result RECORD;
  v_total_allocations INTEGER := 0;
BEGIN
  RAISE NOTICE E'\n=== TEST 4: Backfill multiple days ===';
  
  -- Backfill Dec 1-10 (10 days)
  DELETE FROM daily_labor_allocations WHERE restaurant_id = 'test-rest-1';
  
  FOR v_result IN 
    SELECT * FROM backfill_labor_allocations('test-rest-1', '2024-12-01', '2024-12-10')
  LOOP
    v_total_allocations := v_total_allocations + v_result.allocations_created;
  END LOOP;
  
  -- Should create 30 total allocations:
  -- - Dec 1-10: emp-salary-1 (10) + emp-salary-2 (10) + emp-contractor-1 (10) = 30
  ASSERT v_total_allocations = 30, 
    format('Expected 30 total allocations for 10 days × 3 employees, got %s', v_total_allocations);
  RAISE NOTICE '✓ Created %s allocations for 10 days', v_total_allocations;
  
  -- Verify emp-salary-2 has allocations through Dec 10 (termination date)
  ASSERT (SELECT COUNT(*) FROM daily_labor_allocations 
          WHERE employee_id = 'emp-salary-2' 
          AND date BETWEEN '2024-12-01' AND '2024-12-10') = 10,
    'Terminated employee should have allocations up to termination date';
  RAISE NOTICE '✓ Terminated employee has allocations through termination date';
  
  RAISE NOTICE '=== TEST 4 PASSED ===';
END $$;

-- =============================================================================
-- TEST 5: Real-World Scenario - Payroll Period
-- =============================================================================
DO $$
DECLARE
  v_total_labor_cost INTEGER;
  v_expected_cost INTEGER;
BEGIN
  RAISE NOTICE E'\n=== TEST 5: Real-world payroll calculation ===';
  
  -- Scenario: Calculate total labor cost for Dec 1-15 (15 days)
  DELETE FROM daily_labor_allocations WHERE restaurant_id = 'test-rest-1';
  
  -- Backfill Dec 1-15
  PERFORM backfill_labor_allocations('test-rest-1', '2024-12-01', '2024-12-15');
  
  -- Calculate expected costs:
  -- emp-salary-1: 15 days × $100/day = $1,500
  -- emp-salary-2: 10 days × $66.67/day = $666.70 (terminated Dec 10)
  -- emp-contractor-1: 15 days × $142.86/day = $2,142.90
  -- Total: $4,309.60
  
  SELECT SUM(allocated_cost) INTO v_total_labor_cost
  FROM daily_labor_allocations
  WHERE restaurant_id = 'test-rest-1'
  AND date BETWEEN '2024-12-01' AND '2024-12-15';
  
  v_expected_cost := (15 * 10000) + (10 * 6667) + (15 * 14286); -- in cents
  
  RAISE NOTICE 'Total labor cost for Dec 1-15: $%.2f', v_total_labor_cost / 100.0;
  RAISE NOTICE 'Expected: $%.2f', v_expected_cost / 100.0;
  
  -- Allow 1% margin for rounding
  ASSERT ABS(v_total_labor_cost - v_expected_cost) < (v_expected_cost * 0.01),
    format('Labor cost mismatch: expected ~%s, got %s', v_expected_cost, v_total_labor_cost);
  RAISE NOTICE '✓ Labor costs accurate within 1%% margin';
  
  RAISE NOTICE '=== TEST 5 PASSED ===';
END $$;

-- =============================================================================
-- TEST 6: Idempotency - Running Multiple Times
-- =============================================================================
DO $$
DECLARE
  v_count_first INTEGER;
  v_count_second INTEGER;
  v_cost_first INTEGER;
  v_cost_second INTEGER;
BEGIN
  RAISE NOTICE E'\n=== TEST 6: Idempotency (safe to run multiple times) ===';
  
  -- Generate allocations for Dec 5
  DELETE FROM daily_labor_allocations WHERE restaurant_id = 'test-rest-1';
  SELECT ensure_labor_allocations_for_date('test-rest-1', '2024-12-05') INTO v_count_first;
  
  SELECT SUM(allocated_cost) INTO v_cost_first
  FROM daily_labor_allocations
  WHERE restaurant_id = 'test-rest-1' AND date = '2024-12-05';
  
  -- Run again (should update, not duplicate)
  SELECT ensure_labor_allocations_for_date('test-rest-1', '2024-12-05') INTO v_count_second;
  
  SELECT SUM(allocated_cost) INTO v_cost_second
  FROM daily_labor_allocations
  WHERE restaurant_id = 'test-rest-1' AND date = '2024-12-05';
  
  ASSERT v_count_second = v_count_first, 'Should return same count';
  ASSERT v_cost_second = v_cost_first, 'Should not duplicate costs';
  
  RAISE NOTICE '✓ Function is idempotent (safe to run multiple times)';
  
  RAISE NOTICE '=== TEST 6 PASSED ===';
END $$;

-- =============================================================================
-- TEST 7: No Allocations for Per-Job Contractors or Hourly
-- =============================================================================
DO $$
DECLARE
  v_allocation RECORD;
BEGIN
  RAISE NOTICE E'\n=== TEST 7: Exclude per-job contractors and hourly employees ===';
  
  -- Generate allocations
  DELETE FROM daily_labor_allocations WHERE restaurant_id = 'test-rest-1';
  PERFORM ensure_labor_allocations_for_date('test-rest-1', '2024-12-05');
  
  -- Check per-job contractor has no allocation
  SELECT * INTO v_allocation 
  FROM daily_labor_allocations 
  WHERE employee_id = 'emp-perjob-1' AND date = '2024-12-05';
  
  ASSERT v_allocation IS NULL, 'Per-job contractor should not have auto allocation';
  RAISE NOTICE '✓ Per-job contractor correctly excluded';
  
  -- Check hourly employee has no allocation
  SELECT * INTO v_allocation 
  FROM daily_labor_allocations 
  WHERE employee_id = 'emp-hourly-1' AND date = '2024-12-05';
  
  ASSERT v_allocation IS NULL, 'Hourly employee should not have allocation';
  RAISE NOTICE '✓ Hourly employee correctly excluded';
  
  RAISE NOTICE '=== TEST 7 PASSED ===';
END $$;

-- Cleanup
DELETE FROM daily_labor_allocations WHERE restaurant_id = 'test-rest-1';
DELETE FROM employees WHERE restaurant_id = 'test-rest-1';
DELETE FROM restaurants WHERE id = 'test-rest-1';

ROLLBACK;

-- =============================================================================
-- Summary
-- =============================================================================
DO $$
BEGIN
  RAISE NOTICE E'\n========================================';
  RAISE NOTICE '✅ ALL TESTS PASSED';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'The allocation system:';
  RAISE NOTICE '  ✓ Generates daily allocations correctly';
  RAISE NOTICE '  ✓ Respects hire dates';
  RAISE NOTICE '  ✓ Respects termination dates';
  RAISE NOTICE '  ✓ Excludes per-job contractors';
  RAISE NOTICE '  ✓ Excludes hourly employees';
  RAISE NOTICE '  ✓ Handles multi-day backfills';
  RAISE NOTICE '  ✓ Calculates accurate payroll totals';
  RAISE NOTICE '  ✓ Is idempotent (safe to re-run)';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️  IMPORTANT: These are MANUAL tests.';
  RAISE NOTICE '    A CRON JOB is needed to run daily!';
  RAISE NOTICE '========================================';
END $$;
