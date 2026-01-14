-- Test: Daily Rate Compensation Type
-- Tests for daily_rate compensation model

BEGIN;
SELECT plan(8);

-- Disable RLS for tests
SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000000"}';

ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Setup: Create test restaurant
-- ============================================================================

INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-00000000D001', 'Test Daily Rate Restaurant')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- TEST 1: Can create daily_rate employee with all required fields
-- ============================================================================

SELECT lives_ok(
  $$
    INSERT INTO employees (
      id, restaurant_id, name, position, 
      compensation_type, daily_rate_amount, 
      daily_rate_reference_weekly, daily_rate_reference_days,
      status, is_active, hourly_rate
    ) VALUES (
      '00000000-0000-0000-0000-00000000D101',
      '00000000-0000-0000-0000-00000000D001',
      'Test Daily Rate Manager',
      'Manager',
      'daily_rate',
      16667, -- $166.67/day
      100000, -- $1000/week
      6, -- 6 days
      'active',
      true,
      0
    )
  $$,
  'Should create daily_rate employee with all required fields'
);

-- ============================================================================
-- TEST 2: Verify compensation_type is daily_rate
-- ============================================================================

SELECT is(
  (SELECT compensation_type FROM employees WHERE id = '00000000-0000-0000-0000-00000000D101'),
  'daily_rate',
  'Employee has daily_rate compensation type'
);

-- ============================================================================
-- TEST 3: Verify daily_rate_amount stored correctly
-- ============================================================================

SELECT is(
  (SELECT daily_rate_amount FROM employees WHERE id = '00000000-0000-0000-0000-00000000D101'),
  16667,
  'Daily rate amount is $166.67 in cents'
);

-- ============================================================================
-- TEST 4: Verify reference weekly amount stored
-- ============================================================================

SELECT is(
  (SELECT daily_rate_reference_weekly FROM employees WHERE id = '00000000-0000-0000-0000-00000000D101'),
  100000,
  'Weekly reference amount is $1000 in cents'
);

-- ============================================================================
-- TEST 5: Verify reference days stored
-- ============================================================================

SELECT is(
  (SELECT daily_rate_reference_days FROM employees WHERE id = '00000000-0000-0000-0000-00000000D101'),
  6,
  'Standard work days is 6'
);

-- ============================================================================
-- TEST 6: CRITICAL - Cannot create daily_rate without required fields
-- ============================================================================

SELECT throws_ok(
  $$
    INSERT INTO employees (
      id, restaurant_id, name, position,
      compensation_type, status, is_active, hourly_rate
    ) VALUES (
      '00000000-0000-0000-0000-00000000D102',
      '00000000-0000-0000-0000-00000000D001',
      'Invalid Daily Rate',
      'Server',
      'daily_rate',
      'active',
      true,
      0
    )
  $$,
  '23514', -- check_violation
  NULL,
  'Should reject daily_rate employee without required fields'
);

-- ============================================================================
-- TEST 7: Can create 5-day week daily_rate employee
-- ============================================================================

SELECT lives_ok(
  $$
    INSERT INTO employees (
      id, restaurant_id, name, position,
      compensation_type, daily_rate_amount,
      daily_rate_reference_weekly, daily_rate_reference_days,
      status, is_active, hourly_rate
    ) VALUES (
      '00000000-0000-0000-0000-00000000D103',
      '00000000-0000-0000-0000-00000000D001',
      'Five Day Manager',
      'Manager',
      'daily_rate',
      20000, -- $200/day
      100000, -- $1000/week
      5, -- 5 days
      'active',
      true,
      0
    )
  $$,
  'Should create daily_rate employee with 5-day week'
);

-- ============================================================================
-- TEST 8: Other compensation types not affected
-- ============================================================================

SELECT lives_ok(
  $$
    INSERT INTO employees (
      id, restaurant_id, name, position,
      compensation_type, hourly_rate,
      status, is_active
    ) VALUES (
      '00000000-0000-0000-0000-00000000D104',
      '00000000-0000-0000-0000-00000000D001',
      'Hourly Employee',
      'Server',
      'hourly',
      1500, -- $15/hr
      'active',
      true
    )
  $$,
  'Should still create hourly employees normally'
);

-- ============================================================================
-- Cleanup
-- ============================================================================

SELECT * FROM finish();
ROLLBACK;
