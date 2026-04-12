-- Test that check_availability_conflict correctly compares UTC-stored availability
-- times against shift timestamps
BEGIN;
SELECT plan(6);

-- Setup: create restaurant in CST timezone, and employee
INSERT INTO restaurants (id, name, timezone)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'UTC Conflict Test Restaurant', 'America/Chicago')
ON CONFLICT (id) DO NOTHING;

INSERT INTO employees (id, restaurant_id, name, position)
VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'UTC Test Employee', 'staff')
ON CONFLICT (id) DO NOTHING;

-- Insert availability: available Monday 21:30-00:00 UTC (= 4:30 PM - 7:00 PM CDT)
INSERT INTO employee_availability (restaurant_id, employee_id, day_of_week, is_available, start_time, end_time)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 1, true, '21:30:00', '00:00:00');

-- Test 1: Shift fully within availability window — no conflict expected
SELECT is(
  (SELECT count(*) FROM check_availability_conflict(
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    '2026-04-13 22:00:00+00'::timestamptz,
    '2026-04-13 23:00:00+00'::timestamptz
  ))::integer,
  0,
  'Shift within availability window should have no conflict'
);

-- Test 2: Shift starting before availability window — conflict expected
SELECT is(
  (SELECT count(*) FROM check_availability_conflict(
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    '2026-04-13 20:00:00+00'::timestamptz,
    '2026-04-13 23:00:00+00'::timestamptz
  ) WHERE has_conflict = true)::integer,
  1,
  'Shift starting before availability window should conflict'
);

-- Test 3: Shift ending after availability window — conflict expected
SELECT is(
  (SELECT count(*) FROM check_availability_conflict(
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    '2026-04-13 22:00:00+00'::timestamptz,
    '2026-04-14 01:00:00+00'::timestamptz
  ) WHERE has_conflict = true)::integer,
  1,
  'Shift ending after availability window should conflict'
);

-- Insert exception: unavailable on a specific Monday
INSERT INTO availability_exceptions (restaurant_id, employee_id, date, is_available)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'dddddddd-dddd-dddd-dddd-dddddddddddd', '2026-04-20', false);

-- Test 4: Shift on exception date (unavailable) — conflict expected
SELECT is(
  (SELECT count(*) FROM check_availability_conflict(
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    '2026-04-20 22:00:00+00'::timestamptz,
    '2026-04-20 23:00:00+00'::timestamptz
  ) WHERE has_conflict = true)::integer,
  1,
  'Shift on unavailable exception date should conflict'
);

-- Insert exception with specific hours: available 18:00-22:00 UTC on Apr 27
INSERT INTO availability_exceptions (restaurant_id, employee_id, date, is_available, start_time, end_time)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'dddddddd-dddd-dddd-dddd-dddddddddddd', '2026-04-27', true, '18:00:00', '22:00:00');

-- Test 5: Shift within exception availability window — no conflict
SELECT is(
  (SELECT count(*) FROM check_availability_conflict(
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    '2026-04-27 19:00:00+00'::timestamptz,
    '2026-04-27 21:00:00+00'::timestamptz
  ))::integer,
  0,
  'Shift within exception availability window should have no conflict'
);

-- Test 6: Shift outside exception availability window — conflict expected
SELECT is(
  (SELECT count(*) FROM check_availability_conflict(
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    '2026-04-27 17:00:00+00'::timestamptz,
    '2026-04-27 21:00:00+00'::timestamptz
  ) WHERE has_conflict = true)::integer,
  1,
  'Shift outside exception availability window should conflict'
);

SELECT * FROM finish();
ROLLBACK;
