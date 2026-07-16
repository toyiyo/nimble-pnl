BEGIN;
SELECT plan(12);

SET LOCAL client_min_messages TO WARNING;

-- Deterministic fixtures: RLS off, delete-before-insert, fixed absolute dates.
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE employee_availability DISABLE ROW LEVEL SECURITY;
ALTER TABLE availability_exceptions DISABLE ROW LEVEL SECURITY;

-- Fixed IDs
CREATE TEMP TABLE t_ids AS SELECT
  '11111111-1111-1111-1111-111111111111'::uuid AS rid,
  '22222222-2222-2222-2222-222222222222'::uuid AS eid;

DELETE FROM availability_exceptions WHERE restaurant_id = (SELECT rid FROM t_ids);
DELETE FROM employee_availability  WHERE restaurant_id = (SELECT rid FROM t_ids);
DELETE FROM employees              WHERE id = (SELECT eid FROM t_ids);
DELETE FROM restaurants            WHERE id = (SELECT rid FROM t_ids);

INSERT INTO restaurants (id, name, timezone)
VALUES ((SELECT rid FROM t_ids), 'TZ Test NY', 'America/New_York')
ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

INSERT INTO employees (id, restaurant_id, name, position, status)
VALUES ((SELECT eid FROM t_ids), (SELECT rid FROM t_ids), 'TZ Emp', 'staff', 'active')
ON CONFLICT (id) DO UPDATE SET status = 'active';

-- Summer fixed date 2027-07-13 is a Tuesday (EDT). Available Tue 2:00 PM-10:30 PM local.
-- Store start/end as the UTC clock the writer would produce, DERIVED via SQL so it is
-- DST-correct regardless of when CI runs.
INSERT INTO employee_availability (restaurant_id, employee_id, day_of_week, is_available, start_time, end_time)
VALUES (
  (SELECT rid FROM t_ids), (SELECT eid FROM t_ids), 2, true,
  (('2027-07-13 14:00'::timestamp AT TIME ZONE 'America/New_York') AT TIME ZONE 'UTC')::time,
  (('2027-07-13 22:30'::timestamp AT TIME ZONE 'America/New_York') AT TIME ZONE 'UTC')::time
);
-- Marked UNAVAILABLE Wednesday (day_of_week = 3) — the day the old UTC bug bled into.
INSERT INTO employee_availability (restaurant_id, employee_id, day_of_week, is_available, start_time, end_time)
VALUES ((SELECT rid FROM t_ids), (SELECT eid FROM t_ids), 3, false, '00:00:00', '23:59:59');

-- CASE 1 (the reported bug): Tue 5:00 PM-9:00 PM local shift => NO conflict.
SELECT is(
  (SELECT count(*)::int FROM check_availability_conflict(
     (SELECT eid FROM t_ids), (SELECT rid FROM t_ids),
     ('2027-07-13 17:00'::timestamp AT TIME ZONE 'America/New_York'),
     ('2027-07-13 21:00'::timestamp AT TIME ZONE 'America/New_York'))),
  0,
  'Tue evening shift within Tue availability returns no conflict (was false Wed bleed)'
);

-- CASE 2 (partial outside-window): Tue 11:00 AM-1:00 PM => recurring conflict WITH window.
SELECT is(
  (SELECT conflict_type FROM check_availability_conflict(
     (SELECT eid FROM t_ids), (SELECT rid FROM t_ids),
     ('2027-07-13 11:00'::timestamp AT TIME ZONE 'America/New_York'),
     ('2027-07-13 13:00'::timestamp AT TIME ZONE 'America/New_York')) LIMIT 1),
  'recurring',
  'Tue morning shift outside the window is a recurring conflict'
);
SELECT ok(
  (SELECT available_start IS NOT NULL FROM check_availability_conflict(
     (SELECT eid FROM t_ids), (SELECT rid FROM t_ids),
     ('2027-07-13 11:00'::timestamp AT TIME ZONE 'America/New_York'),
     ('2027-07-13 13:00'::timestamp AT TIME ZONE 'America/New_York')) LIMIT 1),
  'Outside-window conflict returns the available window (hours shown in dialog)'
);

-- CASE 3 (backward-rollover regression): America/Los_Angeles, available 6-7 PM local.
UPDATE restaurants SET timezone = 'America/Los_Angeles' WHERE id = (SELECT rid FROM t_ids);
DELETE FROM employee_availability WHERE restaurant_id = (SELECT rid FROM t_ids);
-- 2027-07-12 is a Monday (PDT). 6:00 PM PDT -> 01:00 UTC (next day) — the case the
-- old convertOne-mirroring formula misattributed to Sunday.
INSERT INTO employee_availability (restaurant_id, employee_id, day_of_week, is_available, start_time, end_time)
VALUES (
  (SELECT rid FROM t_ids), (SELECT eid FROM t_ids), 1, true,
  (('2027-07-12 18:00'::timestamp AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'UTC')::time,
  (('2027-07-12 19:00'::timestamp AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'UTC')::time
);
SELECT is(
  (SELECT count(*)::int FROM check_availability_conflict(
     (SELECT eid FROM t_ids), (SELECT rid FROM t_ids),
     ('2027-07-12 18:00'::timestamp AT TIME ZONE 'America/Los_Angeles'),
     ('2027-07-12 19:00'::timestamp AT TIME ZONE 'America/Los_Angeles'))),
  0,
  'Late-local-start (6PM PDT) window matches the same-day shift (no backward-rollover false conflict)'
);

-- CASE 4 (invalid timezone falls back to UTC, no throw): garbage tz, UTC-stored window.
UPDATE restaurants SET timezone = 'Not/AZone' WHERE id = (SELECT rid FROM t_ids);
DELETE FROM employee_availability WHERE restaurant_id = (SELECT rid FROM t_ids);
INSERT INTO employee_availability (restaurant_id, employee_id, day_of_week, is_available, start_time, end_time)
VALUES ((SELECT rid FROM t_ids), (SELECT eid FROM t_ids), 1, true, '09:00:00', '17:00:00');
SELECT lives_ok(
  $$ SELECT * FROM check_availability_conflict(
       (SELECT eid FROM t_ids), (SELECT rid FROM t_ids),
       '2027-07-12 10:00+00'::timestamptz, '2027-07-12 12:00+00'::timestamptz) $$,
  'Invalid timezone falls back to UTC without raising'
);

-- CASE 5 (overnight LOCAL window): America/Chicago, available Fri 6:00 PM-2:00 AM local.
-- 2027-07-16 is a Friday (day_of_week=5), 2027-07-17 is the following Saturday.
UPDATE restaurants SET timezone = 'America/Chicago' WHERE id = (SELECT rid FROM t_ids);
DELETE FROM employee_availability WHERE restaurant_id = (SELECT rid FROM t_ids);
INSERT INTO employee_availability (restaurant_id, employee_id, day_of_week, is_available, start_time, end_time)
VALUES (
  (SELECT rid FROM t_ids), (SELECT eid FROM t_ids), 5, true,
  (('2027-07-16 18:00'::timestamp AT TIME ZONE 'America/Chicago') AT TIME ZONE 'UTC')::time,
  (('2027-07-17 02:00'::timestamp AT TIME ZONE 'America/Chicago') AT TIME ZONE 'UTC')::time
);

-- 10:00 PM-1:00 AM local shift is fully inside the Fri 6PM-2AM window => no conflict.
SELECT is(
  (SELECT count(*)::int FROM check_availability_conflict(
     (SELECT eid FROM t_ids), (SELECT rid FROM t_ids),
     ('2027-07-16 22:00'::timestamp AT TIME ZONE 'America/Chicago'),
     ('2027-07-17 01:00'::timestamp AT TIME ZONE 'America/Chicago'))),
  0,
  'Overnight local window: 10PM-1AM shift within Fri 6PM-2AM window — no conflict'
);

-- 3:00-4:00 AM local shift is past the window's 2:00 AM end => recurring conflict, and
-- the window comes from Friday's overnight row via the previous-local-day carry-over
-- (the "early-morning shift covered only by the prior day's overnight window" path).
SELECT is(
  (SELECT conflict_type FROM check_availability_conflict(
     (SELECT eid FROM t_ids), (SELECT rid FROM t_ids),
     ('2027-07-17 03:00'::timestamp AT TIME ZONE 'America/Chicago'),
     ('2027-07-17 04:00'::timestamp AT TIME ZONE 'America/Chicago')) LIMIT 1),
  'recurring',
  'Overnight local window: 3AM shift past the 2AM end is a recurring conflict'
);
SELECT ok(
  (SELECT available_start IS NOT NULL FROM check_availability_conflict(
     (SELECT eid FROM t_ids), (SELECT rid FROM t_ids),
     ('2027-07-17 03:00'::timestamp AT TIME ZONE 'America/Chicago'),
     ('2027-07-17 04:00'::timestamp AT TIME ZONE 'America/Chicago')) LIMIT 1),
  'Early-morning conflict returns the prior day''s overnight window (not NULL)'
);

-- CASE 6 (exceptions): fresh exception dates, no recurring rows in the way.
DELETE FROM employee_availability WHERE restaurant_id = (SELECT rid FROM t_ids);
DELETE FROM availability_exceptions WHERE restaurant_id = (SELECT rid FROM t_ids);

-- 2027-07-19 (Monday): fully unavailable exception => 'exception' type, NULL window.
INSERT INTO availability_exceptions (restaurant_id, employee_id, date, is_available)
VALUES ((SELECT rid FROM t_ids), (SELECT eid FROM t_ids), '2027-07-19', false);
SELECT is(
  (SELECT conflict_type FROM check_availability_conflict(
     (SELECT eid FROM t_ids), (SELECT rid FROM t_ids),
     ('2027-07-19 10:00'::timestamp AT TIME ZONE 'America/Chicago'),
     ('2027-07-19 12:00'::timestamp AT TIME ZONE 'America/Chicago')) LIMIT 1),
  'exception',
  'Unavailable exception day is an exception-type conflict'
);
SELECT ok(
  (SELECT available_start IS NULL FROM check_availability_conflict(
     (SELECT eid FROM t_ids), (SELECT rid FROM t_ids),
     ('2027-07-19 10:00'::timestamp AT TIME ZONE 'America/Chicago'),
     ('2027-07-19 12:00'::timestamp AT TIME ZONE 'America/Chicago')) LIMIT 1),
  'Unavailable exception day returns a NULL window'
);

-- 2027-07-20 (Tuesday): exception window present (9AM-5PM local), shift outside it
-- (7-8AM local) => 'exception' type WITH the window.
INSERT INTO availability_exceptions (restaurant_id, employee_id, date, is_available, start_time, end_time)
VALUES (
  (SELECT rid FROM t_ids), (SELECT eid FROM t_ids), '2027-07-20', true,
  (('2027-07-20 09:00'::timestamp AT TIME ZONE 'America/Chicago') AT TIME ZONE 'UTC')::time,
  (('2027-07-20 17:00'::timestamp AT TIME ZONE 'America/Chicago') AT TIME ZONE 'UTC')::time
);
SELECT is(
  (SELECT conflict_type FROM check_availability_conflict(
     (SELECT eid FROM t_ids), (SELECT rid FROM t_ids),
     ('2027-07-20 07:00'::timestamp AT TIME ZONE 'America/Chicago'),
     ('2027-07-20 08:00'::timestamp AT TIME ZONE 'America/Chicago')) LIMIT 1),
  'exception',
  'Shift outside the exception window is an exception-type conflict'
);
SELECT ok(
  (SELECT available_start IS NOT NULL FROM check_availability_conflict(
     (SELECT eid FROM t_ids), (SELECT rid FROM t_ids),
     ('2027-07-20 07:00'::timestamp AT TIME ZONE 'America/Chicago'),
     ('2027-07-20 08:00'::timestamp AT TIME ZONE 'America/Chicago')) LIMIT 1),
  'Shift outside the exception window returns that window (not NULL)'
);

SELECT * FROM finish();
ROLLBACK;
