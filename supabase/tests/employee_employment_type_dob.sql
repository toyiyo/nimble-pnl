-- supabase/tests/employee_employment_type_dob.sql
BEGIN;
SELECT plan(7);

-- Test 1: employment_type column exists with default
SELECT has_column('public', 'employees', 'employment_type',
  'employees table should have employment_type column');

-- Test 2: date_of_birth column exists
SELECT has_column('public', 'employees', 'date_of_birth',
  'employees table should have date_of_birth column');

-- Test 3: employment_type defaults to full_time
INSERT INTO employees (id, restaurant_id, name, position, hourly_rate, compensation_type)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000001',
  (SELECT id FROM restaurants LIMIT 1),
  'Test Default FT',
  'Server',
  1500,
  'hourly'
);
SELECT is(
  (SELECT employment_type FROM employees WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'full_time',
  'employment_type should default to full_time'
);

-- Test 4: Can set employment_type to part_time
UPDATE employees SET employment_type = 'part_time'
WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT is(
  (SELECT employment_type FROM employees WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'part_time',
  'employment_type should accept part_time'
);

-- Test 5: CHECK constraint rejects invalid values
SELECT throws_ok(
  $$UPDATE employees SET employment_type = 'contractor'
    WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '23514',
  NULL,
  'employment_type should reject invalid values'
);

-- Test 6: date_of_birth accepts valid date
UPDATE employees SET date_of_birth = '2008-06-15'
WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT is(
  (SELECT date_of_birth FROM employees WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '2008-06-15'::DATE,
  'date_of_birth should accept valid date'
);

-- Test 7: date_of_birth accepts NULL
UPDATE employees SET date_of_birth = NULL
WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT is(
  (SELECT date_of_birth FROM employees WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  NULL::DATE,
  'date_of_birth should accept NULL'
);

-- Cleanup
DELETE FROM employees WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

SELECT * FROM finish();
ROLLBACK;
