-- Test Suite: Daily Labor Allocations (pgTAP version)
-- Tests the automatic generation of salary/contractor allocations

BEGIN;
SELECT plan(13);

-- Setup authenticated user context for tests
SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000000"}';

-- Disable RLS for testing
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE daily_labor_allocations DISABLE ROW LEVEL SECURITY;

-- Define test UUIDs
DO $$
DECLARE
  test_restaurant_id UUID := '11111111-1111-1111-1111-111111111111'::uuid;
  emp_salary_1_id UUID := '22222222-2222-2222-2222-222222222221'::uuid;
  emp_salary_2_id UUID := '22222222-2222-2222-2222-222222222222'::uuid;
  emp_contractor_1_id UUID := '33333333-3333-3333-3333-333333333331'::uuid;
  emp_perjob_1_id UUID := '44444444-4444-4444-4444-444444444441'::uuid;
  emp_hourly_1_id UUID := '55555555-5555-5555-5555-555555555551'::uuid;
BEGIN
  -- Create test restaurant
  INSERT INTO restaurants (id, name) 
  VALUES (test_restaurant_id, 'Test Restaurant')
  ON CONFLICT (id) DO NOTHING;

  -- Create test employees
  
  -- Salaried employees
  INSERT INTO employees (id, restaurant_id, name, position, status, compensation_type, hire_date, termination_date, salary_amount, pay_period_type, allocate_daily, hourly_rate) VALUES
    -- Salaried employee: $3,000/month, hired Dec 1
    (emp_salary_1_id, test_restaurant_id, 'John Salary', 'Manager', 'active', 'salary', '2024-12-01', NULL, 300000, 'monthly', true, 0),
    -- Salaried employee: hired Dec 1, terminated Dec 10
    (emp_salary_2_id, test_restaurant_id, 'Jane Short', 'Server', 'inactive', 'salary', '2024-12-01', '2024-12-10', 200000, 'monthly', true, 0)
  ON CONFLICT (id) DO NOTHING;

  -- Contractor employees
  INSERT INTO employees (id, restaurant_id, name, position, status, compensation_type, hire_date, termination_date, contractor_payment_amount, contractor_payment_interval, allocate_daily, hourly_rate) VALUES
    -- Contractor: $1,000/week, hired Dec 1
    (emp_contractor_1_id, test_restaurant_id, 'Bob Contractor', 'Chef', 'active', 'contractor', '2024-12-01', NULL, 100000, 'weekly', true, 0),
    -- Per-job contractor (should NOT get auto allocations)
    (emp_perjob_1_id, test_restaurant_id, 'Alice PerJob', 'Event Staff', 'active', 'contractor', '2024-12-01', NULL, NULL, 'per-job', true, 0)
  ON CONFLICT (id) DO NOTHING;

  -- Hourly employee
  INSERT INTO employees (id, restaurant_id, name, position, status, compensation_type, hire_date, termination_date, hourly_rate, allocate_daily) VALUES
    -- Hourly employee (should NOT get allocations)
    (emp_hourly_1_id, test_restaurant_id, 'Mike Hourly', 'Server', 'active', 'hourly', '2024-12-01', NULL, 1500, false)
  ON CONFLICT (id) DO NOTHING;

  -- Clear any existing allocations for test data
  DELETE FROM daily_labor_allocations WHERE restaurant_id = test_restaurant_id;
END $$;

-- TEST 1: Generate allocation for single date (active employee)
SELECT is(
  (SELECT ensure_labor_allocations_for_date('11111111-1111-1111-1111-111111111111', '2024-12-05')),
  2::INTEGER,
  'Should create 2 allocations (1 salary + 1 contractor, NOT per-job or hourly)'
);

SELECT is(
  (SELECT allocated_cost FROM daily_labor_allocations 
   WHERE employee_id = '22222222-2222-2222-2222-222222222221' AND date = '2024-12-05'),
  10000::INTEGER,
  'Salary allocation should be $100/day (10000 cents)'
);

SELECT is(
  (SELECT allocated_cost FROM daily_labor_allocations 
   WHERE employee_id = '33333333-3333-3333-3333-333333333331' AND date = '2024-12-05'),
  14286::INTEGER,
  'Contractor allocation should be ~$142.86/day (14286 cents)'
);

-- TEST 2: No allocation before hire date
DO $$
BEGIN
  DELETE FROM daily_labor_allocations WHERE restaurant_id = '11111111-1111-1111-1111-111111111111';
END $$;

SELECT is(
  (SELECT ensure_labor_allocations_for_date('11111111-1111-1111-1111-111111111111', '2024-11-30')),
  0::INTEGER,
  'Should create 0 allocations before hire date'
);

-- TEST 3: Allocation stops after termination
DO $$
BEGIN
  DELETE FROM daily_labor_allocations WHERE restaurant_id = '11111111-1111-1111-1111-111111111111';
END $$;

SELECT is(
  (SELECT ensure_labor_allocations_for_date('11111111-1111-1111-1111-111111111111', '2024-12-15')),
  2::INTEGER,
  'Should create 2 allocations (terminated employee excluded)'
);

SELECT is(
  (SELECT COUNT(*) FROM daily_labor_allocations 
   WHERE employee_id = '22222222-2222-2222-2222-222222222222' AND date = '2024-12-15'),
  0::BIGINT,
  'Terminated employee should not have allocation after termination date'
);

-- TEST 4: Multi-day backfill
DO $$
DECLARE
  test_restaurant_id UUID := '11111111-1111-1111-1111-111111111111'::uuid;
  v_result RECORD;
  v_total_allocations INTEGER := 0;
BEGIN
  DELETE FROM daily_labor_allocations WHERE restaurant_id = test_restaurant_id;
  
  FOR v_result IN 
    SELECT * FROM backfill_labor_allocations(test_restaurant_id, '2024-12-01', '2024-12-10')
  LOOP
    v_total_allocations := v_total_allocations + v_result.allocations_created;
  END LOOP;
  
  -- Store result in a temp table for testing
  CREATE TEMP TABLE IF NOT EXISTS test_results (key TEXT, value INTEGER);
  DELETE FROM test_results WHERE key = 'total_allocations';
  INSERT INTO test_results (key, value) VALUES ('total_allocations', v_total_allocations);
END $$;

SELECT is(
  (SELECT value FROM test_results WHERE key = 'total_allocations'),
  30::INTEGER,
  'Should create 30 total allocations for 10 days × 3 employees'
);

SELECT is(
  (SELECT COUNT(*) FROM daily_labor_allocations 
   WHERE employee_id = '22222222-2222-2222-2222-222222222222' 
   AND date BETWEEN '2024-12-01' AND '2024-12-10'),
  10::BIGINT,
  'Terminated employee should have allocations through termination date'
);

-- TEST 5: Real-world payroll calculation
DO $$
DECLARE
  test_restaurant_id UUID := '11111111-1111-1111-1111-111111111111'::uuid;
  v_total_labor_cost INTEGER;
  v_expected_cost INTEGER;
BEGIN
  DELETE FROM daily_labor_allocations WHERE restaurant_id = test_restaurant_id;
  
  -- Backfill Dec 1-15
  PERFORM backfill_labor_allocations(test_restaurant_id, '2024-12-01', '2024-12-15');
  
  SELECT SUM(allocated_cost) INTO v_total_labor_cost
  FROM daily_labor_allocations
  WHERE restaurant_id = test_restaurant_id
  AND date BETWEEN '2024-12-01' AND '2024-12-15';
  
  v_expected_cost := (15 * 10000) + (10 * 6667) + (15 * 14286); -- in cents
  
  -- Store result for testing
  DELETE FROM test_results WHERE key = 'labor_cost_diff';
  INSERT INTO test_results (key, value) VALUES ('labor_cost_diff', ABS(v_total_labor_cost - v_expected_cost));
END $$;

SELECT ok(
  (SELECT value FROM test_results WHERE key = 'labor_cost_diff') < ((15 * 10000) + (10 * 6667) + (15 * 14286)) * 0.01,
  'Labor costs should be accurate within 1% margin'
);

-- TEST 6: Idempotency
DO $$
DECLARE
  test_restaurant_id UUID := '11111111-1111-1111-1111-111111111111'::uuid;
  v_count_first INTEGER;
  v_count_second INTEGER;
  v_cost_first INTEGER;
  v_cost_second INTEGER;
BEGIN
  DELETE FROM daily_labor_allocations WHERE restaurant_id = test_restaurant_id;
  SELECT ensure_labor_allocations_for_date(test_restaurant_id, '2024-12-05') INTO v_count_first;
  
  SELECT SUM(allocated_cost) INTO v_cost_first
  FROM daily_labor_allocations
  WHERE restaurant_id = test_restaurant_id AND date = '2024-12-05';
  
  -- Run again
  SELECT ensure_labor_allocations_for_date(test_restaurant_id, '2024-12-05') INTO v_count_second;
  
  SELECT SUM(allocated_cost) INTO v_cost_second
  FROM daily_labor_allocations
  WHERE restaurant_id = test_restaurant_id AND date = '2024-12-05';
  
  -- Store results
  DELETE FROM test_results WHERE key IN ('count_match', 'cost_match');
  INSERT INTO test_results (key, value) VALUES 
    ('count_match', CASE WHEN v_count_second = v_count_first THEN 1 ELSE 0 END),
    ('cost_match', CASE WHEN v_cost_second = v_cost_first THEN 1 ELSE 0 END);
END $$;

SELECT is(
  (SELECT value FROM test_results WHERE key = 'count_match'),
  1::INTEGER,
  'Function should return same count when run multiple times (idempotent)'
);

SELECT is(
  (SELECT value FROM test_results WHERE key = 'cost_match'),
  1::INTEGER,
  'Function should not duplicate costs when run multiple times (idempotent)'
);

-- TEST 7: Exclude per-job contractors and hourly employees
DO $$
BEGIN
  DELETE FROM daily_labor_allocations WHERE restaurant_id = '11111111-1111-1111-1111-111111111111';
  PERFORM ensure_labor_allocations_for_date('11111111-1111-1111-1111-111111111111', '2024-12-05');
END $$;

SELECT is(
  (SELECT COUNT(*) FROM daily_labor_allocations 
   WHERE employee_id = '44444444-4444-4444-4444-444444444441' AND date = '2024-12-05'),
  0::BIGINT,
  'Per-job contractor should not have auto allocation'
);

SELECT is(
  (SELECT COUNT(*) FROM daily_labor_allocations 
   WHERE employee_id = '55555555-5555-5555-5555-555555555551' AND date = '2024-12-05'),
  0::BIGINT,
  'Hourly employee should not have allocation'
);

-- Cleanup
DO $$
DECLARE
  test_restaurant_id UUID := '11111111-1111-1111-1111-111111111111'::uuid;
BEGIN
  DELETE FROM daily_labor_allocations WHERE restaurant_id = test_restaurant_id;
  DELETE FROM employees WHERE restaurant_id = test_restaurant_id;
  DELETE FROM restaurants WHERE id = test_restaurant_id;
  DROP TABLE IF EXISTS test_results;
END $$;

-- Re-enable RLS
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_labor_allocations ENABLE ROW LEVEL SECURITY;

SELECT * FROM finish();
ROLLBACK;
