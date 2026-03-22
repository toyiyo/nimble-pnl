BEGIN;
SELECT plan(16);

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

-- Test 11: Cross-midnight shift within overnight window — no conflict
-- Shift: Mon 22:00 UTC to Tue 02:00 UTC — crosses midnight but within 13:00-04:00 window
-- The function splits this into two days: Mon 22:00-23:59 and Tue 00:00-02:00
-- Mon (DOW=1) has availability 13:00-04:00; Tue (DOW=2) has no availability (allow)
SELECT is(
  (SELECT count(*) FROM check_availability_conflict(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '2026-04-06 22:00:00+00'::timestamptz,
    '2026-04-07 02:00:00+00'::timestamptz
  ))::integer,
  0,
  'Cross-midnight shift 22:00-02:00 UTC within overnight avail — no conflict'
);

-- Test 12: Multiple availability windows — shift in second window should pass
-- Add a second window for Sunday (day_of_week=0): 18:00-22:00 UTC
-- (Test 1 already added 09:00-17:00 for Sunday)
INSERT INTO employee_availability (restaurant_id, employee_id, day_of_week, is_available, start_time, end_time)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 0, true, '18:00:00', '22:00:00');
-- April 5, 2026 is a Sunday (DOW=0)
SELECT is(
  (SELECT count(*) FROM check_availability_conflict(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '2026-04-05 19:00:00+00'::timestamptz,
    '2026-04-05 21:00:00+00'::timestamptz
  ))::integer,
  0,
  'Shift in second availability window (18:00-22:00) — no conflict'
);

-- Test 13: Multiple availability windows — shift outside all windows should conflict
SELECT is(
  (SELECT count(*) FROM check_availability_conflict(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '2026-04-05 23:00:00+00'::timestamptz,
    '2026-04-05 23:30:00+00'::timestamptz
  ))::integer,
  1,
  'Shift outside all availability windows — conflict'
);

-- Test 14: Previous-day overnight carry-over — shift in Tuesday's early hours
-- covered by Monday's overnight window even when Tuesday has its own availability.
-- Add Tuesday availability (day_of_week=2): 13:00-22:00 UTC (normal daytime)
INSERT INTO employee_availability (restaurant_id, employee_id, day_of_week, is_available, start_time, end_time)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 2, true, '13:00:00', '22:00:00');
-- April 7, 2026 is a Tuesday (DOW=2)
-- Shift Tue 02:00-03:00 UTC should be covered by Monday's 13:00-04:00 carry-over
SELECT is(
  (SELECT count(*) FROM check_availability_conflict(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '2026-04-07 02:00:00+00'::timestamptz,
    '2026-04-07 03:00:00+00'::timestamptz
  ))::integer,
  0,
  'Tue 02:00-03:00 UTC covered by Mon overnight carry-over — no conflict'
);

-- Test 15: Previous-day overnight carry-over — shift outside carry-over range
-- Shift Tue 05:00-06:00 UTC is past Monday's 04:00 end, should check Tuesday only
-- Tuesday has 13:00-22:00, so 05:00-06:00 is outside → conflict
SELECT is(
  (SELECT count(*) FROM check_availability_conflict(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '2026-04-07 05:00:00+00'::timestamptz,
    '2026-04-07 06:00:00+00'::timestamptz
  ))::integer,
  1,
  'Tue 05:00-06:00 UTC outside all windows (carry-over ends at 04:00) — conflict'
);

-- Test 16: Shift ending exactly at midnight should not check next day
-- Monday availability is 13:00-04:00 UTC. Shift Mon 18:00 to Tue 00:00 UTC
-- should NOT iterate into Tuesday (zero-length slice would cause false conflict)
SELECT is(
  (SELECT count(*) FROM check_availability_conflict(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '2026-04-06 18:00:00+00'::timestamptz,
    '2026-04-07 00:00:00+00'::timestamptz
  ))::integer,
  0,
  'Shift ending at midnight should not iterate into next day — no conflict'
);

SELECT * FROM finish();
ROLLBACK;
