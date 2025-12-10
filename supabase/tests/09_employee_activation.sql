-- Test: Employee Activation/Deactivation System
-- Tests the employee activation tracking migration and related functions

BEGIN;

-- Load pgTAP extension
SELECT plan(29);

-- Setup: Create test restaurant and users
INSERT INTO restaurants (id, name, address, phone)
VALUES 
  ('00000000-0000-0000-0000-000000000301'::uuid, 'Activation Test Restaurant', '123 Test St', '555-TEST')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
VALUES 
  ('00000000-0000-0000-0000-000000000302'::uuid, 'manager-activation@test.com'),
  ('00000000-0000-0000-0000-000000000303'::uuid, 'user-activation@test.com')
ON CONFLICT (id) DO NOTHING;

-- Test 1: Check that is_active column exists and defaults to true
SELECT has_column('employees', 'is_active', 'employees table should have is_active column');

SELECT col_default_is(
  'employees',
  'is_active',
  'true',
  'is_active should default to true'
);

-- Test 2: Check deactivation tracking columns exist
SELECT has_column('employees', 'deactivation_reason', 'employees table should have deactivation_reason');
SELECT has_column('employees', 'deactivated_at', 'employees table should have deactivated_at');
SELECT has_column('employees', 'deactivated_by', 'employees table should have deactivated_by');
SELECT has_column('employees', 'reactivated_at', 'employees table should have reactivated_at');
SELECT has_column('employees', 'reactivated_by', 'employees table should have reactivated_by');
SELECT has_column('employees', 'last_active_date', 'employees table should have last_active_date');

-- Test 3: Check indexes exist for performance
SELECT has_index('employees', 'idx_employees_is_active', 'Should have index on is_active for filtering');
SELECT has_index('employees', 'idx_employees_deactivated_at', 'Should have index on deactivated_at');

-- Test 4: Create test employee
INSERT INTO employees (
  id,
  restaurant_id,
  name,
  position,
  hourly_rate,
  status,
  compensation_type
) VALUES (
  '00000000-0000-0000-0000-000000000304'::uuid,
  '00000000-0000-0000-0000-000000000301'::uuid,
  'Test Active Employee',
  'Server',
  1500,
  'active',
  'hourly'
);

-- Test 5: New employee should be active by default
SELECT ok(
  (SELECT is_active FROM employees WHERE id = '00000000-0000-0000-0000-000000000304'::uuid),
  'New employee should be active by default'
);

SELECT is(
  (SELECT status FROM employees WHERE id = '00000000-0000-0000-0000-000000000304'::uuid),
  'active',
  'New employee status should be active'
);

-- Test 6: Test deactivate_employee function
SELECT lives_ok(
  $$SELECT * FROM deactivate_employee('00000000-0000-0000-0000-000000000304'::uuid, '00000000-0000-0000-0000-000000000302'::uuid, 'seasonal', true)$$,
  'deactivate_employee function should execute successfully'
);

-- Test 7: Verify deactivation sets fields correctly
SELECT is(
  (SELECT is_active FROM employees WHERE id = '00000000-0000-0000-0000-000000000304'::uuid),
  false,
  'Employee should be inactive after deactivation'
);

SELECT is(
  (SELECT status FROM employees WHERE id = '00000000-0000-0000-0000-000000000304'::uuid),
  'inactive',
  'Employee status should be inactive after deactivation'
);

SELECT is(
  (SELECT deactivation_reason FROM employees WHERE id = '00000000-0000-0000-0000-000000000304'::uuid),
  'seasonal',
  'Deactivation reason should be stored'
);

SELECT ok(
  (SELECT deactivated_at FROM employees WHERE id = '00000000-0000-0000-0000-000000000304'::uuid) IS NOT NULL,
  'deactivated_at should be set'
);

SELECT is(
  (SELECT deactivated_by FROM employees WHERE id = '00000000-0000-0000-0000-000000000304'::uuid),
  '00000000-0000-0000-0000-000000000302'::uuid::uuid,
  'deactivated_by should be set to manager user id'
);

-- Test 8: Test that future shifts are cancelled on deactivation
INSERT INTO shifts (
  id,
  restaurant_id,
  employee_id,
  start_time,
  end_time,
  position,
  status
) VALUES (
  '00000000-0000-0000-0000-000000000306'::uuid,
  '00000000-0000-0000-0000-000000000301'::uuid,
  '00000000-0000-0000-0000-000000000304'::uuid,
  NOW() + INTERVAL '1 day',
  NOW() + INTERVAL '1 day' + INTERVAL '8 hours',
  'Server',
  'scheduled'
);

-- Create another employee to test shift cancellation
INSERT INTO employees (
  id,
  restaurant_id,
  name,
  position,
  hourly_rate,
  status,
  compensation_type
) VALUES (
  '00000000-0000-0000-0000-000000000305'::uuid,
  '00000000-0000-0000-0000-000000000301'::uuid,
  'Test Employee for Shift Cancel',
  'Server',
  1500,
  'active',
  'hourly'
);

INSERT INTO shifts (
  id,
  restaurant_id,
  employee_id,
  start_time,
  end_time,
  position,
  status
) VALUES (
  '00000000-0000-0000-0000-000000000307'::uuid,
  '00000000-0000-0000-0000-000000000301'::uuid,
  '00000000-0000-0000-0000-000000000305'::uuid,
  NOW() + INTERVAL '2 days',
  NOW() + INTERVAL '2 days' + INTERVAL '8 hours',
  'Server',
  'scheduled'
);

-- Deactivate with shift removal
SELECT deactivate_employee('00000000-0000-0000-0000-000000000305'::uuid, '00000000-0000-0000-0000-000000000302'::uuid, NULL, true);

SELECT is(
  (SELECT status FROM shifts WHERE id = '00000000-0000-0000-0000-000000000307'::uuid),
  'cancelled',
  'Future shifts should be cancelled when remove_from_future_shifts is true'
);

-- Test 9: Test reactivate_employee function
SELECT lives_ok(
  $$SELECT * FROM reactivate_employee('00000000-0000-0000-0000-000000000304'::uuid, '00000000-0000-0000-0000-000000000302'::uuid, NULL)$$,
  'reactivate_employee function should execute successfully'
);

-- Test 10: Verify reactivation sets fields correctly
SELECT ok(
  (SELECT is_active FROM employees WHERE id = '00000000-0000-0000-0000-000000000304'::uuid),
  'Employee should be active after reactivation'
);

SELECT is(
  (SELECT status FROM employees WHERE id = '00000000-0000-0000-0000-000000000304'::uuid),
  'active',
  'Employee status should be active after reactivation'
);

SELECT ok(
  (SELECT deactivation_reason FROM employees WHERE id = '00000000-0000-0000-0000-000000000304'::uuid) IS NULL,
  'Deactivation reason should be cleared on reactivation'
);

SELECT ok(
  (SELECT deactivated_at FROM employees WHERE id = '00000000-0000-0000-0000-000000000304'::uuid) IS NULL,
  'deactivated_at should be cleared on reactivation'
);

SELECT ok(
  (SELECT reactivated_at FROM employees WHERE id = '00000000-0000-0000-0000-000000000304'::uuid) IS NOT NULL,
  'reactivated_at should be set'
);

SELECT is(
  (SELECT reactivated_by FROM employees WHERE id = '00000000-0000-0000-0000-000000000304'::uuid),
  '00000000-0000-0000-0000-000000000302'::uuid::uuid,
  'reactivated_by should be set to manager user id'
);

-- Test 11: Test reactivation with new hourly rate
INSERT INTO employees (
  id,
  restaurant_id,
  name,
  position,
  hourly_rate,
  status,
  is_active,
  compensation_type
) VALUES (
  '00000000-0000-0000-0000-000000000308'::uuid,
  '00000000-0000-0000-0000-000000000301'::uuid,
  'Test Employee for Rate Update',
  'Cook',
  1600,
  'inactive',
  false,
  'hourly'
);

SELECT reactivate_employee('00000000-0000-0000-0000-000000000308'::uuid, '00000000-0000-0000-0000-000000000302'::uuid, 1800);

SELECT is(
  (SELECT hourly_rate FROM employees WHERE id = '00000000-0000-0000-0000-000000000308'::uuid),
  1800,
  'Hourly rate should be updated when provided during reactivation'
);

-- Test 12: Test active_employees view
SELECT ok(
  EXISTS(SELECT 1 FROM active_employees WHERE id = '00000000-0000-0000-0000-000000000304'::uuid),
  'active_employees view should include active employees'
);

SELECT ok(
  NOT EXISTS(SELECT 1 FROM active_employees WHERE id = '00000000-0000-0000-0000-000000000305'::uuid),
  'active_employees view should exclude inactive employees'
);

-- Test 13: Test inactive_employees view
SELECT ok(
  EXISTS(SELECT 1 FROM inactive_employees WHERE id = '00000000-0000-0000-0000-000000000305'::uuid),
  'inactive_employees view should include inactive employees'
);

SELECT ok(
  NOT EXISTS(SELECT 1 FROM inactive_employees WHERE id = '00000000-0000-0000-0000-000000000304'::uuid),
  'inactive_employees view should exclude active employees'
);

-- Test 14: Test check constraint (status and is_active must be in sync)
PREPARE invalid_status_mismatch AS
  INSERT INTO employees (
    id,
    restaurant_id,
    name,
    position,
    hourly_rate,
    status,
    is_active,
    compensation_type
  ) VALUES (
    '00000000-0000-0000-0000-000000000309'::uuid,
    '00000000-0000-0000-0000-000000000301'::uuid,
    'Invalid Employee',
    'Server',
    1500,
    'active',
    false, -- This violates the constraint
    'hourly'
  );

SELECT throws_ok(
  'invalid_status_mismatch',
  '23514', -- Check constraint violation
  NULL,
  'Should not allow status=active with is_active=false'
);

-- Cleanup
DELETE FROM shifts WHERE restaurant_id = '00000000-0000-0000-0000-000000000301'::uuid;
DELETE FROM employees WHERE restaurant_id = '00000000-0000-0000-0000-000000000301'::uuid;
DELETE FROM restaurants WHERE id = '00000000-0000-0000-0000-000000000301'::uuid;

SELECT * FROM finish();

ROLLBACK;
