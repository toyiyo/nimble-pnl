BEGIN;
SELECT plan(10);

-- Setup: create restaurant, employee
INSERT INTO restaurants (id, name, timezone)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Test Overnight Restaurant', 'America/Chicago')
ON CONFLICT (id) DO NOTHING;

INSERT INTO employees (id, restaurant_id, name, position)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Test Employee', 'staff')
ON CONFLICT (id) DO NOTHING;

-- Test 1: Normal availability (start < end) should still work
SELECT lives_ok(
  $$INSERT INTO employee_availability (restaurant_id, employee_id, day_of_week, is_available, start_time, end_time)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 0, true, '09:00:00', '17:00:00')$$,
  'Normal availability (09:00-17:00) should succeed'
);

-- Test 2: Overnight UTC availability (end < start) should now work
SELECT lives_ok(
  $$INSERT INTO employee_availability (restaurant_id, employee_id, day_of_week, is_available, start_time, end_time)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1, true, '13:00:00', '04:00:00')$$,
  'Overnight UTC availability (13:00-04:00) should succeed'
);

-- Test 3: Same start and end time should be rejected (zero-length window)
SELECT throws_ok(
  $$INSERT INTO employee_availability (restaurant_id, employee_id, day_of_week, is_available, start_time, end_time)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 2, true, '09:00:00', '09:00:00')$$,
  '23514',
  NULL,
  'Same start and end time should be rejected'
);

-- Test 4: Normal exception availability (start < end) should still work
SELECT lives_ok(
  $$INSERT INTO availability_exceptions (restaurant_id, employee_id, date, is_available, start_time, end_time)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-04-01', true, '09:00:00', '17:00:00')$$,
  'Normal exception availability (09:00-17:00) should succeed'
);

-- Test 5: Overnight UTC exception availability should work
SELECT lives_ok(
  $$INSERT INTO availability_exceptions (restaurant_id, employee_id, date, is_available, start_time, end_time)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-04-02', true, '13:00:00', '04:00:00')$$,
  'Overnight UTC exception availability (13:00-04:00) should succeed'
);

-- Test 6: Exception with NULL times (unavailable all day) should still work
SELECT lives_ok(
  $$INSERT INTO availability_exceptions (restaurant_id, employee_id, date, is_available)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-04-03', false)$$,
  'Exception with NULL times should succeed'
);

-- Test 7: Shift within overnight availability window (before midnight portion) — no conflict
-- Availability: 13:00-04:00 UTC (8AM-11PM CST) on Monday (day_of_week=1)
-- Shift: 14:00-20:00 UTC (9AM-3PM CST) — within window
-- Note: April 6, 2026 is a Monday (PostgreSQL DOW=1)
SELECT is(
  (SELECT count(*) FROM check_availability_conflict(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '2026-04-06 14:00:00+00'::timestamptz,
    '2026-04-06 20:00:00+00'::timestamptz
  ))::integer,
  0,
  'Shift 14:00-20:00 UTC within overnight avail 13:00-04:00 — no conflict'
);

-- Test 8: Shift within overnight availability window (after midnight portion) — no conflict
-- Shift: 01:00-03:00 UTC on Monday — within the after-midnight part of the window
SELECT is(
  (SELECT count(*) FROM check_availability_conflict(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '2026-04-06 01:00:00+00'::timestamptz,
    '2026-04-06 03:00:00+00'::timestamptz
  ))::integer,
  0,
  'Shift 01:00-03:00 UTC within after-midnight portion — no conflict'
);

-- Test 9: Shift outside overnight availability window — conflict
-- Shift: 05:00-10:00 UTC on Monday — outside window (in the 04:00-13:00 gap)
SELECT is(
  (SELECT count(*) FROM check_availability_conflict(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '2026-04-06 05:00:00+00'::timestamptz,
    '2026-04-06 10:00:00+00'::timestamptz
  ))::integer,
  1,
  'Shift 05:00-10:00 UTC outside overnight avail 13:00-04:00 — conflict'
);

-- Test 10: Shift spanning the gap in overnight availability — conflict
-- Shift: 03:00-14:00 UTC on Monday — spans the 04:00-13:00 gap
SELECT is(
  (SELECT count(*) FROM check_availability_conflict(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '2026-04-06 03:00:00+00'::timestamptz,
    '2026-04-06 14:00:00+00'::timestamptz
  ))::integer,
  1,
  'Shift 03:00-14:00 UTC spanning gap in overnight avail — conflict'
);

SELECT * FROM finish();
ROLLBACK;
