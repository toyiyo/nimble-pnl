-- Test: Inactive Employee Auth Blocking Functions
-- Tests verify_employee_can_login and verify_employee_pin functions
-- Validates that inactive employees are blocked and audit logs are created

BEGIN;

-- Load pgTAP extension
SELECT plan(18);

-- Setup: Clear any existing test data
DELETE FROM auth_audit_log WHERE employee_id IN (
  SELECT id FROM employees WHERE restaurant_id = '00000000-0000-0000-0000-000000000401'::uuid
);
DELETE FROM employee_pins WHERE restaurant_id = '00000000-0000-0000-0000-000000000401'::uuid;
DELETE FROM employees WHERE restaurant_id = '00000000-0000-0000-0000-000000000401'::uuid;
DELETE FROM user_restaurants WHERE restaurant_id = '00000000-0000-0000-0000-000000000401'::uuid;
DELETE FROM restaurants WHERE id = '00000000-0000-0000-0000-000000000401'::uuid;

-- Create test restaurant
INSERT INTO restaurants (id, name, address, phone)
VALUES 
  ('00000000-0000-0000-0000-000000000401'::uuid, 'Auth Blocking Test Restaurant', '123 Test St', '555-AUTH')
ON CONFLICT (id) DO NOTHING;

-- Create test users
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES 
  ('00000000-0000-0000-0000-000000000402'::uuid, 'active-employee@test.com', crypt('password123', gen_salt('bf')), NOW(), '{"provider":"email"}', '{}', NOW(), NOW()),
  ('00000000-0000-0000-0000-000000000403'::uuid, 'inactive-employee@test.com', crypt('password123', gen_salt('bf')), NOW(), '{"provider":"email"}', '{}', NOW(), NOW()),
  ('00000000-0000-0000-0000-000000000404'::uuid, 'manager@test.com', crypt('password123', gen_salt('bf')), NOW(), '{"provider":"email"}', '{}', NOW(), NOW()),
  ('00000000-0000-0000-0000-000000000405'::uuid, 'non-employee@test.com', crypt('password123', gen_salt('bf')), NOW(), '{"provider":"email"}', '{}', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Create test employees
INSERT INTO employees (
  id,
  restaurant_id,
  name,
  position,
  hourly_rate,
  status,
  is_active,
  compensation_type,
  user_id
) VALUES (
  '00000000-0000-0000-0000-000000000406'::uuid,
  '00000000-0000-0000-0000-000000000401'::uuid,
  'Active Employee',
  'Server',
  1500,
  'active',
  true,
  'hourly',
  '00000000-0000-0000-0000-000000000402'::uuid
), (
  '00000000-0000-0000-0000-000000000407'::uuid,
  '00000000-0000-0000-0000-000000000401'::uuid,
  'Inactive Employee',
  'Cook',
  1800,
  'inactive',
  false,
  'hourly',
  '00000000-0000-0000-0000-000000000403'::uuid
);

-- Create employee PINs (using MD5 for test simplicity - real system uses better hashing)
INSERT INTO employee_pins (
  id,
  restaurant_id,
  employee_id,
  pin_hash,
  min_length
) VALUES (
  '00000000-0000-0000-0000-000000000408'::uuid,
  '00000000-0000-0000-0000-000000000401'::uuid,
  '00000000-0000-0000-0000-000000000406'::uuid,
  encode(digest('1234', 'sha256'), 'hex'),
  4
), (
  '00000000-0000-0000-0000-000000000409'::uuid,
  '00000000-0000-0000-0000-000000000401'::uuid,
  '00000000-0000-0000-0000-000000000407'::uuid,
  encode(digest('5678', 'sha256'), 'hex'),
  4
);

-- Create user_restaurants relationships
INSERT INTO user_restaurants (user_id, restaurant_id, role)
VALUES 
  ('00000000-0000-0000-0000-000000000402'::uuid, '00000000-0000-0000-0000-000000000401'::uuid, 'employee'),
  ('00000000-0000-0000-0000-000000000403'::uuid, '00000000-0000-0000-0000-000000000401'::uuid, 'employee'),
  ('00000000-0000-0000-0000-000000000404'::uuid, '00000000-0000-0000-0000-000000000401'::uuid, 'manager');

-- Test 1: verify_employee_can_login allows active employee to login
SELECT results_eq(
  $$SELECT can_login, is_active FROM verify_employee_can_login('00000000-0000-0000-0000-000000000402'::uuid)$$,
  $$VALUES (true, true)$$,
  'Active employee should be allowed to login'
);

-- Test 2: verify_employee_can_login blocks inactive employee
SELECT results_eq(
  $$SELECT can_login, is_active FROM verify_employee_can_login('00000000-0000-0000-0000-000000000403'::uuid)$$,
  $$VALUES (false, false)$$,
  'Inactive employee should be blocked from login'
);

-- Test 3: verify_employee_can_login returns correct reason for inactive employee
SELECT ok(
  (SELECT reason FROM verify_employee_can_login('00000000-0000-0000-0000-000000000403'::uuid)) LIKE '%inactive%',
  'Inactive employee block should include "inactive" in reason'
);

-- Test 4: verify_employee_can_login allows non-employee users
SELECT results_eq(
  $$SELECT can_login FROM verify_employee_can_login('00000000-0000-0000-0000-000000000405'::uuid)$$,
  $$VALUES (true)$$,
  'Non-employee users (managers/owners) should be allowed to login'
);

-- Test 5: verify_employee_can_login creates audit log for inactive employee
-- Clear audit log first
DELETE FROM auth_audit_log WHERE employee_id = '00000000-0000-0000-0000-000000000407'::uuid;

-- Call function as authenticated user
SET LOCAL request.jwt.claims TO json_build_object(
  'sub', '00000000-0000-0000-0000-000000000403'::uuid,
  'role', 'authenticated'
)::text;

PERFORM verify_employee_can_login('00000000-0000-0000-0000-000000000403'::uuid);

SELECT ok(
  EXISTS(
    SELECT 1 FROM auth_audit_log 
    WHERE employee_id = '00000000-0000-0000-0000-000000000407'::uuid
      AND event_type = 'login_blocked_inactive_employee'
  ),
  'Audit log should be created when inactive employee attempts login'
);

-- Test 6: verify_employee_can_login audit log has correct user_id
SELECT is(
  (SELECT user_id FROM auth_audit_log WHERE employee_id = '00000000-0000-0000-0000-000000000407'::uuid LIMIT 1),
  '00000000-0000-0000-0000-000000000403'::uuid,
  'Audit log should record correct user_id'
);

-- Test 7: verify_employee_pin succeeds for active employee with correct PIN
SELECT results_eq(
  $$SELECT is_valid FROM verify_employee_pin('00000000-0000-0000-0000-000000000401'::uuid, '1234')$$,
  $$VALUES (true)$$,
  'Active employee with correct PIN should be verified'
);

-- Test 8: verify_employee_pin returns employee info for valid PIN
SELECT is(
  (SELECT employee_name FROM verify_employee_pin('00000000-0000-0000-0000-000000000401'::uuid, '1234')),
  'Active Employee',
  'verify_employee_pin should return correct employee name'
);

-- Test 9: verify_employee_pin blocks inactive employee even with correct PIN
SELECT results_eq(
  $$SELECT is_valid FROM verify_employee_pin('00000000-0000-0000-0000-000000000401'::uuid, '5678')$$,
  $$VALUES (false)$$,
  'Inactive employee should be blocked even with correct PIN'
);

-- Test 10: verify_employee_pin returns inactive reason for blocked employee
SELECT ok(
  (SELECT reason FROM verify_employee_pin('00000000-0000-0000-0000-000000000401'::uuid, '5678')) LIKE '%inactive%',
  'Blocked PIN should include "inactive" in reason'
);

-- Test 11: verify_employee_pin rejects invalid PIN
SELECT results_eq(
  $$SELECT is_valid FROM verify_employee_pin('00000000-0000-0000-0000-000000000401'::uuid, '9999')$$,
  $$VALUES (false)$$,
  'Invalid PIN should be rejected'
);

-- Test 12: verify_employee_pin creates audit log for inactive employee PIN attempt
-- Clear audit log first
DELETE FROM auth_audit_log WHERE employee_id = '00000000-0000-0000-0000-000000000407'::uuid;

-- Call function as authenticated user (kiosk mode manager)
PERFORM verify_employee_pin('00000000-0000-0000-0000-000000000401'::uuid, '5678');

SELECT ok(
  EXISTS(
    SELECT 1 FROM auth_audit_log 
    WHERE employee_id = '00000000-0000-0000-0000-000000000407'::uuid
      AND event_type = 'pin_blocked_inactive_employee'
  ),
  'Audit log should be created when inactive employee attempts PIN verification'
);

-- Test 13: verify_employee_pin audit log in anon mode (kiosk) should handle NULL auth.uid()
-- Reset to anon role
RESET request.jwt.claims;
SET LOCAL role TO 'anon';

-- Clear audit log
DELETE FROM auth_audit_log WHERE employee_id = '00000000-0000-0000-0000-000000000407'::uuid;

-- Call function as anon (this should NOT create audit log entry due to NULL guard)
PERFORM verify_employee_pin('00000000-0000-0000-0000-000000000401'::uuid, '5678');

-- Verify function still blocks but doesn't crash
SELECT results_eq(
  $$SELECT is_valid FROM verify_employee_pin('00000000-0000-0000-0000-000000000401'::uuid, '5678')$$,
  $$VALUES (false)$$,
  'Anon role should still block inactive employee PIN'
);

-- Test 14: Anon role should not create audit log (due to NULL auth.uid() guard)
SELECT is(
  (SELECT COUNT(*) FROM auth_audit_log WHERE employee_id = '00000000-0000-0000-0000-000000000407'::uuid)::integer,
  0,
  'Anon role (kiosk mode) should not create audit log when auth.uid() is NULL'
);

-- Test 15: Anon role can verify active employee PIN (kiosk mode allows active employees)
SELECT results_eq(
  $$SELECT is_valid FROM verify_employee_pin('00000000-0000-0000-0000-000000000401'::uuid, '1234')$$,
  $$VALUES (true)$$,
  'Anon role (kiosk mode) should allow active employee PIN verification'
);

-- Reset to authenticated for remaining tests
RESET role;
SET LOCAL request.jwt.claims TO json_build_object(
  'sub', '00000000-0000-0000-0000-000000000404'::uuid,
  'role', 'authenticated'
)::text;

-- Test 16: auth_audit_log table has correct columns
SELECT has_column('auth_audit_log', 'user_id', 'auth_audit_log should have user_id column');

-- Test 17: auth_audit_log table has correct indexes
SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'auth_audit_log' 
      AND indexname = 'idx_auth_audit_log_user_id'
  ),
  'auth_audit_log should have index on user_id'
);

-- Test 18: auth_audit_log RLS policy exists
SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'auth_audit_log' 
      AND policyname = 'Users can view their own auth audit logs'
  ),
  'auth_audit_log should have RLS policy for user access'
);

-- Cleanup
RESET request.jwt.claims;
RESET role;
DELETE FROM auth_audit_log WHERE employee_id IN (
  SELECT id FROM employees WHERE restaurant_id = '00000000-0000-0000-0000-000000000401'::uuid
);
DELETE FROM employee_pins WHERE restaurant_id = '00000000-0000-0000-0000-000000000401'::uuid;
DELETE FROM employees WHERE restaurant_id = '00000000-0000-0000-0000-000000000401'::uuid;
DELETE FROM user_restaurants WHERE restaurant_id = '00000000-0000-0000-0000-000000000401'::uuid;
DELETE FROM restaurants WHERE id = '00000000-0000-0000-0000-000000000401'::uuid;

SELECT * FROM finish();

ROLLBACK;
