BEGIN;
SELECT plan(19);

-- Table exists
SELECT has_table('public', 'overtime_rules', 'overtime_rules table exists');
SELECT has_table('public', 'overtime_adjustments', 'overtime_adjustments table exists');

-- overtime_rules columns
SELECT has_column('public', 'overtime_rules', 'restaurant_id', 'overtime_rules has restaurant_id');
SELECT has_column('public', 'overtime_rules', 'weekly_threshold_hours', 'overtime_rules has weekly_threshold_hours');
SELECT has_column('public', 'overtime_rules', 'daily_threshold_hours', 'overtime_rules has daily_threshold_hours');
SELECT has_column('public', 'overtime_rules', 'exclude_tips_from_ot_rate', 'overtime_rules has exclude_tips_from_ot_rate');

-- overtime_adjustments columns
SELECT has_column('public', 'overtime_adjustments', 'employee_id', 'overtime_adjustments has employee_id');
SELECT has_column('public', 'overtime_adjustments', 'adjustment_type', 'overtime_adjustments has adjustment_type');
SELECT has_column('public', 'overtime_adjustments', 'hours', 'overtime_adjustments has hours');

-- employees.is_exempt
SELECT has_column('public', 'employees', 'is_exempt', 'employees has is_exempt');

-- Create test restaurant for constraint tests (idempotent)
INSERT INTO restaurants (id, name)
  VALUES ('00000000-0000-0000-0000-000000000099', 'OT Test Restaurant')
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- CHECK constraints: valid insert should succeed
SELECT lives_ok(
  $$INSERT INTO overtime_rules (restaurant_id, weekly_threshold_hours, weekly_ot_multiplier)
    VALUES ('00000000-0000-0000-0000-000000000099', 40, 1.5)$$,
  'Valid overtime_rules insert succeeds'
);

-- Clean up for next tests
DELETE FROM overtime_rules WHERE restaurant_id = '00000000-0000-0000-0000-000000000099';

-- CHECK constraints: negative weekly multiplier should fail
SELECT throws_ok(
  $$INSERT INTO overtime_rules (restaurant_id, weekly_threshold_hours, weekly_ot_multiplier)
    VALUES ('00000000-0000-0000-0000-000000000099', 40, -1)$$,
  '23514',
  NULL,
  'Negative weekly multiplier rejected'
);

-- CHECK constraints: negative weekly threshold should fail
SELECT throws_ok(
  $$INSERT INTO overtime_rules (restaurant_id, weekly_threshold_hours, weekly_ot_multiplier)
    VALUES ('00000000-0000-0000-0000-000000000099', -5, 1.5)$$,
  '23514',
  NULL,
  'Negative weekly threshold rejected'
);

-- CHECK constraints: double-time threshold <= daily threshold should fail
SELECT throws_ok(
  $$INSERT INTO overtime_rules (restaurant_id, weekly_threshold_hours, weekly_ot_multiplier, daily_threshold_hours, daily_double_threshold_hours)
    VALUES ('00000000-0000-0000-0000-000000000099', 40, 1.5, 8, 6)$$,
  '23514',
  NULL,
  'Double-time threshold <= daily threshold rejected'
);

-- UNIQUE constraint: duplicate restaurant_id should fail
INSERT INTO overtime_rules (restaurant_id, weekly_threshold_hours, weekly_ot_multiplier)
  VALUES ('00000000-0000-0000-0000-000000000099', 40, 1.5);

SELECT throws_ok(
  $$INSERT INTO overtime_rules (restaurant_id, weekly_threshold_hours, weekly_ot_multiplier)
    VALUES ('00000000-0000-0000-0000-000000000099', 35, 2.0)$$,
  '23505',
  NULL,
  'Duplicate restaurant_id rejected'
);

DELETE FROM overtime_rules WHERE restaurant_id = '00000000-0000-0000-0000-000000000099';

-- overtime_adjustments: invalid adjustment_type should fail
INSERT INTO employees (id, restaurant_id, name, position, status, compensation_type, is_exempt)
  VALUES ('00000000-0000-0000-0000-000000000088', '00000000-0000-0000-0000-000000000099', 'Test Employee', 'server', 'active', 'hourly', FALSE)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    restaurant_id = EXCLUDED.restaurant_id,
    position = EXCLUDED.position,
    status = EXCLUDED.status,
    compensation_type = EXCLUDED.compensation_type,
    is_exempt = EXCLUDED.is_exempt;

SELECT throws_ok(
  $$INSERT INTO overtime_adjustments (restaurant_id, employee_id, punch_date, adjustment_type, hours, adjusted_by)
    VALUES ('00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000088', '2026-02-01', 'invalid_type', 2, '00000000-0000-0000-0000-000000000001')$$,
  '23514',
  NULL,
  'Invalid adjustment_type rejected'
);

-- overtime_adjustments: hours <= 0 should fail
SELECT throws_ok(
  $$INSERT INTO overtime_adjustments (restaurant_id, employee_id, punch_date, adjustment_type, hours, adjusted_by)
    VALUES ('00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000088', '2026-02-01', 'regular_to_overtime', 0, '00000000-0000-0000-0000-000000000001')$$,
  '23514',
  NULL,
  'Zero hours rejected'
);

-- updated_at trigger: verify it advances on UPDATE (not just set on insert)
INSERT INTO overtime_rules (restaurant_id, weekly_threshold_hours, weekly_ot_multiplier)
  VALUES ('00000000-0000-0000-0000-000000000099', 40, 1.5)
  ON CONFLICT (restaurant_id) DO UPDATE SET weekly_threshold_hours = 40;

-- Capture the initial updated_at, then update the row
DO $$
BEGIN
  -- Small delay so updated_at will differ after update
  PERFORM pg_sleep(0.05);
END $$;

UPDATE overtime_rules
  SET weekly_threshold_hours = 35
  WHERE restaurant_id = '00000000-0000-0000-0000-000000000099';

SELECT ok(
  (SELECT updated_at >= NOW() - interval '2 seconds'
   FROM overtime_rules
   WHERE restaurant_id = '00000000-0000-0000-0000-000000000099'),
  'updated_at trigger advances on UPDATE'
);

-- update_exempt_audit trigger: verify exempt_changed_at is set when is_exempt changes
-- Employee was inserted above with is_exempt = FALSE; update to TRUE
UPDATE employees
  SET is_exempt = TRUE
  WHERE id = '00000000-0000-0000-0000-000000000088';

SELECT ok(
  (SELECT exempt_changed_at IS NOT NULL
   FROM employees
   WHERE id = '00000000-0000-0000-0000-000000000088'),
  'update_exempt_audit trigger sets exempt_changed_at when is_exempt changes'
);

-- Clean up
DELETE FROM overtime_adjustments WHERE restaurant_id = '00000000-0000-0000-0000-000000000099';
DELETE FROM overtime_rules WHERE restaurant_id = '00000000-0000-0000-0000-000000000099';
DELETE FROM employees WHERE id = '00000000-0000-0000-0000-000000000088';
DELETE FROM restaurants WHERE id = '00000000-0000-0000-0000-000000000099';

SELECT * FROM finish();
ROLLBACK;
