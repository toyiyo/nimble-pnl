-- Test: Compensation history upsert (backdate rate changes)
-- Verifies that updating a rate for an existing employee+date uses upsert behavior

BEGIN;

SELECT plan(5);

-- Setup: Create test restaurant and employee
INSERT INTO restaurants (id, name, address, phone)
VALUES ('00000000-0000-0000-0000-000000000401'::uuid, 'Comp History Test Restaurant', '123 Test St', '555-TEST')
ON CONFLICT (id) DO NOTHING;

INSERT INTO employees (id, restaurant_id, name, position, compensation_type, hourly_rate)
VALUES (
  '00000000-0000-0000-0000-000000000402'::uuid,
  '00000000-0000-0000-0000-000000000401'::uuid,
  'Test Employee',
  'Cook',
  'hourly',
  1500
) ON CONFLICT (id) DO NOTHING;

-- Test 1: Insert initial compensation history entry
SELECT lives_ok(
  $$
    INSERT INTO employee_compensation_history (employee_id, restaurant_id, compensation_type, amount_cents, effective_date)
    VALUES (
      '00000000-0000-0000-0000-000000000402'::uuid,
      '00000000-0000-0000-0000-000000000401'::uuid,
      'hourly',
      1500,
      '2026-01-01'
    )
  $$,
  'Initial compensation history entry should insert successfully'
);

-- Test 2: Verify the initial entry exists
SELECT is(
  (SELECT amount_cents FROM employee_compensation_history
   WHERE employee_id = '00000000-0000-0000-0000-000000000402'::uuid
   AND effective_date = '2026-01-01'),
  1500,
  'Initial entry should have amount_cents = 1500'
);

-- Test 3: Upsert on the same date should succeed (not violate constraint)
SELECT lives_ok(
  $$
    INSERT INTO employee_compensation_history (employee_id, restaurant_id, compensation_type, amount_cents, effective_date)
    VALUES (
      '00000000-0000-0000-0000-000000000402'::uuid,
      '00000000-0000-0000-0000-000000000401'::uuid,
      'hourly',
      1800,
      '2026-01-01'
    )
    ON CONFLICT (employee_id, effective_date)
    DO UPDATE SET
      compensation_type = EXCLUDED.compensation_type,
      amount_cents = EXCLUDED.amount_cents
  $$,
  'Upsert on existing date should succeed without constraint violation'
);

-- Test 4: Verify the upserted value replaced the old one
SELECT is(
  (SELECT amount_cents FROM employee_compensation_history
   WHERE employee_id = '00000000-0000-0000-0000-000000000402'::uuid
   AND effective_date = '2026-01-01'),
  1800,
  'Upserted entry should have updated amount_cents = 1800'
);

-- Test 5: Only one row should exist for that employee+date
SELECT is(
  (SELECT count(*)::integer FROM employee_compensation_history
   WHERE employee_id = '00000000-0000-0000-0000-000000000402'::uuid
   AND effective_date = '2026-01-01'),
  1,
  'Should have exactly one entry per employee per date after upsert'
);

SELECT * FROM finish();
ROLLBACK;
