BEGIN;
SELECT plan(4);

-- Test 1: Column exists
SELECT has_column('public', 'shifts', 'source',
  'shifts table should have a source column');

-- Test 2: Default value is 'manual'
SELECT col_default_is('public', 'shifts', 'source', 'manual'::text,
  'source column should default to manual');

-- Test 3: Column is NOT NULL
SELECT col_not_null('public', 'shifts', 'source',
  'source column should be NOT NULL');

-- Test 4: CHECK constraint enforces valid values
SELECT throws_ok(
  $$INSERT INTO shifts (restaurant_id, employee_id, start_time, end_time, break_duration, position, status, source)
    VALUES (gen_random_uuid(), gen_random_uuid(), now(), now() + interval '8 hours', 0, 'server', 'scheduled', 'invalid')$$,
  23514, -- check_violation error code
  NULL,
  'source column should reject invalid values'
);

SELECT * FROM finish();
ROLLBACK;
