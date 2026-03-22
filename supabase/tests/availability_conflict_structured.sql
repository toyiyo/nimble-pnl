BEGIN;
SELECT plan(6);

-- Setup: create test restaurant and employee
INSERT INTO restaurants (id, name, timezone)
VALUES ('00000000-0000-0000-0000-000000000099', 'Test Structured Conflict', 'UTC')
ON CONFLICT (id) DO NOTHING;

INSERT INTO employees (id, restaurant_id, name, position)
VALUES ('00000000-0000-0000-0000-000000000299', '00000000-0000-0000-0000-000000000099',
        'Test Employee', 'staff')
ON CONFLICT (id) DO NOTHING;

-- Setup: recurring availability Mon (dow=1) 14:00-22:00 UTC
INSERT INTO employee_availability (employee_id, restaurant_id, day_of_week, start_time, end_time, is_available)
VALUES ('00000000-0000-0000-0000-000000000299', '00000000-0000-0000-0000-000000000099',
        1, '14:00:00', '22:00:00', true);

-- Setup: recurring unavailable Tue (dow=2)
INSERT INTO employee_availability (employee_id, restaurant_id, day_of_week, start_time, end_time, is_available)
VALUES ('00000000-0000-0000-0000-000000000299', '00000000-0000-0000-0000-000000000099',
        2, '00:00:00', '23:59:00', false);

-- Test 1: Recurring conflict returns available_start/end for the window
SELECT results_eq(
  $$SELECT available_start, available_end FROM check_availability_conflict(
    '00000000-0000-0000-0000-000000000299',
    '00000000-0000-0000-0000-000000000099',
    '2026-03-23 10:00:00+00'::timestamptz,
    '2026-03-23 13:00:00+00'::timestamptz
  )$$,
  $$VALUES ('14:00:00'::time, '22:00:00'::time)$$,
  'Recurring conflict returns availability window times'
);

-- Test 2: Recurring unavailable day returns NULL for start/end
SELECT results_eq(
  $$SELECT available_start, available_end FROM check_availability_conflict(
    '00000000-0000-0000-0000-000000000299',
    '00000000-0000-0000-0000-000000000099',
    '2026-03-24 10:00:00+00'::timestamptz,
    '2026-03-24 18:00:00+00'::timestamptz
  )$$,
  $$VALUES (NULL::time, NULL::time)$$,
  'Unavailable day returns NULL window times'
);

-- Test 3: No conflict returns no rows
SELECT is_empty(
  $$SELECT * FROM check_availability_conflict(
    '00000000-0000-0000-0000-000000000299',
    '00000000-0000-0000-0000-000000000099',
    '2026-03-23 15:00:00+00'::timestamptz,
    '2026-03-23 20:00:00+00'::timestamptz
  )$$,
  'No conflict when shift is within availability window'
);

-- Setup: exception on 2026-03-25 (Wed) with specific hours 16:00-20:00
INSERT INTO availability_exceptions (employee_id, restaurant_id, date, start_time, end_time, is_available)
VALUES ('00000000-0000-0000-0000-000000000299', '00000000-0000-0000-0000-000000000099',
        '2026-03-25', '16:00:00', '20:00:00', true);

-- Test 4: Exception conflict returns exception window times
SELECT results_eq(
  $$SELECT available_start, available_end FROM check_availability_conflict(
    '00000000-0000-0000-0000-000000000299',
    '00000000-0000-0000-0000-000000000099',
    '2026-03-25 10:00:00+00'::timestamptz,
    '2026-03-25 15:00:00+00'::timestamptz
  )$$,
  $$VALUES ('16:00:00'::time, '20:00:00'::time)$$,
  'Exception conflict returns exception window times'
);

-- Setup: exception on 2026-03-26 (Thu) fully unavailable
INSERT INTO availability_exceptions (employee_id, restaurant_id, date, is_available, reason)
VALUES ('00000000-0000-0000-0000-000000000299', '00000000-0000-0000-0000-000000000099',
        '2026-03-26', false, 'Personal day');

-- Test 5: Exception unavailable returns NULL window times
SELECT results_eq(
  $$SELECT available_start, available_end FROM check_availability_conflict(
    '00000000-0000-0000-0000-000000000299',
    '00000000-0000-0000-0000-000000000099',
    '2026-03-26 10:00:00+00'::timestamptz,
    '2026-03-26 18:00:00+00'::timestamptz
  )$$,
  $$VALUES (NULL::time, NULL::time)$$,
  'Exception unavailable returns NULL window times'
);

-- Setup: overnight window for Sat (dow=6) 22:00-06:00 UTC
INSERT INTO employee_availability (employee_id, restaurant_id, day_of_week, start_time, end_time, is_available)
VALUES ('00000000-0000-0000-0000-000000000299', '00000000-0000-0000-0000-000000000099',
        6, '22:00:00', '06:00:00', true);

-- Test 6: Overnight window conflict returns the overnight window times
SELECT results_eq(
  $$SELECT available_start, available_end FROM check_availability_conflict(
    '00000000-0000-0000-0000-000000000299',
    '00000000-0000-0000-0000-000000000099',
    '2026-03-28 10:00:00+00'::timestamptz,
    '2026-03-28 18:00:00+00'::timestamptz
  )$$,
  $$VALUES ('22:00:00'::time, '06:00:00'::time)$$,
  'Overnight window conflict returns overnight window times'
);

SELECT * FROM finish();
ROLLBACK;
