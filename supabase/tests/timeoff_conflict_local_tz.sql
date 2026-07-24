-- check_timeoff_conflict must bucket a shift by the RESTAURANT-LOCAL calendar
-- date, not the UTC one. time_off_requests.start_date/end_date are plain DATE
-- columns holding the local days the employee requested off; comparing them
-- against DATE(p_start_time AT TIME ZONE 'UTC') is a frame mismatch that both
-- invents conflicts (evening shift the day BEFORE time off) and, worse, misses
-- real ones (evening shift ON an approved day off).
--
-- Companion to supabase/tests/availability_conflict_local_tz.sql, which covers
-- the same class of bug in check_availability_conflict.
--
-- The timezone is derived from the EMPLOYEE's restaurant (the function takes no
-- p_restaurant_id), so every fixture drives it via UPDATE on restaurants.

BEGIN;
SELECT plan(13);

SET LOCAL client_min_messages TO WARNING;

-- Deterministic fixtures: RLS off, delete-before-insert, fixed absolute dates.
ALTER TABLE restaurants        DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees          DISABLE ROW LEVEL SECURITY;
ALTER TABLE time_off_requests  DISABLE ROW LEVEL SECURITY;

CREATE TEMP TABLE t_ids AS SELECT
  '33333333-3333-3333-3333-333333333333'::uuid AS rid,
  '44444444-4444-4444-4444-444444444444'::uuid AS eid,
  '55555555-5555-5555-5555-555555555555'::uuid AS eid2;

DELETE FROM time_off_requests WHERE restaurant_id = (SELECT rid FROM t_ids);
DELETE FROM employees         WHERE id IN ((SELECT eid FROM t_ids), (SELECT eid2 FROM t_ids));
DELETE FROM restaurants       WHERE id = (SELECT rid FROM t_ids);

INSERT INTO restaurants (id, name, timezone)
VALUES ((SELECT rid FROM t_ids), 'TZ Test Chicago', 'America/Chicago')
ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

INSERT INTO employees (id, restaurant_id, name, position, status)
VALUES
  ((SELECT eid FROM t_ids),  (SELECT rid FROM t_ids), 'TZ Emp',   'staff', 'active'),
  ((SELECT eid2 FROM t_ids), (SELECT rid FROM t_ids), 'Other Emp','staff', 'active')
ON CONFLICT (id) DO UPDATE SET status = 'active';

-- ---------------------------------------------------------------------------
-- CASE 1 (the reported bug — false positive): approved time off Aug 1-7, shift
-- the EVENING BEFORE (Fri Jul 31, 7:00-11:59 PM local). In UTC that shift is
-- 2026-08-01 00:00Z-04:59Z, i.e. an "August 1" shift, which is why it wrongly
-- matched. Locally it is entirely Jul 31 => NO conflict.
-- ---------------------------------------------------------------------------
INSERT INTO time_off_requests (restaurant_id, employee_id, start_date, end_date, status)
VALUES ((SELECT rid FROM t_ids), (SELECT eid FROM t_ids), '2026-08-01', '2026-08-07', 'approved');

SELECT is(
  (SELECT count(*)::int FROM check_timeoff_conflict(
     (SELECT eid FROM t_ids),
     ('2026-07-31 19:00'::timestamp AT TIME ZONE 'America/Chicago'),
     ('2026-07-31 23:59'::timestamp AT TIME ZONE 'America/Chicago'))),
  0,
  'Jul 31 evening shift does not conflict with Aug 1-7 time off (was a false positive)'
);

-- ---------------------------------------------------------------------------
-- CASE 2 (the dangerous half — false negative): approved single day off Aug 10,
-- evening shift ON that day. UTC rolls it to Aug 11 and the conflict vanished
-- silently, scheduling the employee over approved time off.
-- ---------------------------------------------------------------------------
DELETE FROM time_off_requests WHERE restaurant_id = (SELECT rid FROM t_ids);
INSERT INTO time_off_requests (restaurant_id, employee_id, start_date, end_date, status)
VALUES ((SELECT rid FROM t_ids), (SELECT eid FROM t_ids), '2026-08-10', '2026-08-10', 'approved');

SELECT is(
  (SELECT count(*)::int FROM check_timeoff_conflict(
     (SELECT eid FROM t_ids),
     ('2026-08-10 19:00'::timestamp AT TIME ZONE 'America/Chicago'),
     ('2026-08-10 23:59'::timestamp AT TIME ZONE 'America/Chicago'))),
  1,
  'Evening shift ON an approved day off IS a conflict (was silently missed)'
);
SELECT is(
  (SELECT start_date FROM check_timeoff_conflict(
     (SELECT eid FROM t_ids),
     ('2026-08-10 19:00'::timestamp AT TIME ZONE 'America/Chicago'),
     ('2026-08-10 23:59'::timestamp AT TIME ZONE 'America/Chicago')) LIMIT 1),
  '2026-08-10'::date,
  'Conflict row carries the request dates the dialog renders'
);

-- ---------------------------------------------------------------------------
-- CASE 3 (local-midnight boundary): a shift ending exactly at local midnight
-- belongs to the day it started, not the next one — otherwise a 6PM-midnight
-- shift reintroduces the same false positive one day later.
-- ---------------------------------------------------------------------------
DELETE FROM time_off_requests WHERE restaurant_id = (SELECT rid FROM t_ids);
INSERT INTO time_off_requests (restaurant_id, employee_id, start_date, end_date, status)
VALUES ((SELECT rid FROM t_ids), (SELECT eid FROM t_ids), '2026-08-15', '2026-08-15', 'approved');

SELECT is(
  (SELECT count(*)::int FROM check_timeoff_conflict(
     (SELECT eid FROM t_ids),
     ('2026-08-14 18:00'::timestamp AT TIME ZONE 'America/Chicago'),
     ('2026-08-15 00:00'::timestamp AT TIME ZONE 'America/Chicago'))),
  0,
  'Shift ending exactly at local midnight does not claim the next day'
);
SELECT is(
  (SELECT count(*)::int FROM check_timeoff_conflict(
     (SELECT eid FROM t_ids),
     ('2026-08-14 18:00'::timestamp AT TIME ZONE 'America/Chicago'),
     ('2026-08-15 00:01'::timestamp AT TIME ZONE 'America/Chicago'))),
  1,
  'Shift running one minute PAST local midnight does reach the next day'
);

-- ---------------------------------------------------------------------------
-- CASE 4 (multi-day time off spanning the shift): the case the original
-- three-way OR existed for; the symmetric overlap predicate must keep it.
-- ---------------------------------------------------------------------------
DELETE FROM time_off_requests WHERE restaurant_id = (SELECT rid FROM t_ids);
INSERT INTO time_off_requests (restaurant_id, employee_id, start_date, end_date, status)
VALUES ((SELECT rid FROM t_ids), (SELECT eid FROM t_ids), '2026-09-01', '2026-09-30', 'approved');

SELECT is(
  (SELECT count(*)::int FROM check_timeoff_conflict(
     (SELECT eid FROM t_ids),
     ('2026-09-15 12:00'::timestamp AT TIME ZONE 'America/Chicago'),
     ('2026-09-15 17:00'::timestamp AT TIME ZONE 'America/Chicago'))),
  1,
  'Shift inside a month-long time-off span conflicts'
);

-- ---------------------------------------------------------------------------
-- CASE 5 (status filter): a REJECTED request must never block. Previously
-- covered by tests/unit/shiftValidator.test.ts, which is being deleted along
-- with the unreachable client-side check.
-- ---------------------------------------------------------------------------
DELETE FROM time_off_requests WHERE restaurant_id = (SELECT rid FROM t_ids);
INSERT INTO time_off_requests (restaurant_id, employee_id, start_date, end_date, status)
VALUES ((SELECT rid FROM t_ids), (SELECT eid FROM t_ids), '2026-09-15', '2026-09-15', 'rejected');

SELECT is(
  (SELECT count(*)::int FROM check_timeoff_conflict(
     (SELECT eid FROM t_ids),
     ('2026-09-15 12:00'::timestamp AT TIME ZONE 'America/Chicago'),
     ('2026-09-15 17:00'::timestamp AT TIME ZONE 'America/Chicago'))),
  0,
  'Rejected time-off requests do not produce a conflict'
);

-- ---------------------------------------------------------------------------
-- CASE 6 (pending still warns): pending requests are advisory but must surface,
-- and the status must round-trip so the dialog can say "pending" vs "approved".
-- ---------------------------------------------------------------------------
UPDATE time_off_requests SET status = 'pending' WHERE restaurant_id = (SELECT rid FROM t_ids);

SELECT is(
  (SELECT count(*)::int FROM check_timeoff_conflict(
     (SELECT eid FROM t_ids),
     ('2026-09-15 12:00'::timestamp AT TIME ZONE 'America/Chicago'),
     ('2026-09-15 17:00'::timestamp AT TIME ZONE 'America/Chicago'))),
  1,
  'Pending time-off requests still produce a conflict'
);
SELECT is(
  (SELECT status FROM check_timeoff_conflict(
     (SELECT eid FROM t_ids),
     ('2026-09-15 12:00'::timestamp AT TIME ZONE 'America/Chicago'),
     ('2026-09-15 17:00'::timestamp AT TIME ZONE 'America/Chicago')) LIMIT 1),
  'pending',
  'Conflict row carries the request status'
);

-- ---------------------------------------------------------------------------
-- CASE 7 (employee scoping): another employee's time off must not block this
-- one. Also previously covered only by the deleted client-side unit tests.
-- ---------------------------------------------------------------------------
DELETE FROM time_off_requests WHERE restaurant_id = (SELECT rid FROM t_ids);
INSERT INTO time_off_requests (restaurant_id, employee_id, start_date, end_date, status)
VALUES ((SELECT rid FROM t_ids), (SELECT eid2 FROM t_ids), '2026-09-15', '2026-09-15', 'approved');

SELECT is(
  (SELECT count(*)::int FROM check_timeoff_conflict(
     (SELECT eid FROM t_ids),
     ('2026-09-15 12:00'::timestamp AT TIME ZONE 'America/Chicago'),
     ('2026-09-15 17:00'::timestamp AT TIME ZONE 'America/Chicago'))),
  0,
  'Another employee''s time off does not block this employee'
);

-- ---------------------------------------------------------------------------
-- CASE 8 (DST-day local date): 2026-03-08 is US spring-forward. That evening the
-- zone is CDT (UTC-5), so a 7 PM start is already Mar 9 in UTC — the old
-- UTC-bucketing computed Mar 9 and missed this Mar 8 day off, so this fails
-- pre-fix. The offset is derived via AT TIME ZONE, never hardcoded, so it stays
-- correct whenever CI runs. (The midnight-pullback guard needs no DST case of
-- its own: it runs on the naive local wall clock — midnight is midnight
-- regardless of the 2 AM skip — and case 3 already pins it.)
-- ---------------------------------------------------------------------------
DELETE FROM time_off_requests WHERE restaurant_id = (SELECT rid FROM t_ids);
INSERT INTO time_off_requests (restaurant_id, employee_id, start_date, end_date, status)
VALUES ((SELECT rid FROM t_ids), (SELECT eid FROM t_ids), '2026-03-08', '2026-03-08', 'approved');

SELECT is(
  (SELECT count(*)::int FROM check_timeoff_conflict(
     (SELECT eid FROM t_ids),
     ('2026-03-08 19:00'::timestamp AT TIME ZONE 'America/Chicago'),
     ('2026-03-08 23:00'::timestamp AT TIME ZONE 'America/Chicago'))),
  1,
  'Evening shift on a spring-forward day off conflicts (DST-correct local date)'
);

-- ---------------------------------------------------------------------------
-- CASE 9 (positive UTC offset): no production restaurant is east of UTC today,
-- but the fix is offset-sign-agnostic and the untested direction is where a
-- regression would hide. Asia/Tokyo is UTC+9: a 1-5 AM local shift on Aug 20 is
-- Aug 19 16:00-20:00Z, so the UTC frame would miss the Aug 20 day off.
-- ---------------------------------------------------------------------------
UPDATE restaurants SET timezone = 'Asia/Tokyo' WHERE id = (SELECT rid FROM t_ids);
DELETE FROM time_off_requests WHERE restaurant_id = (SELECT rid FROM t_ids);
INSERT INTO time_off_requests (restaurant_id, employee_id, start_date, end_date, status)
VALUES ((SELECT rid FROM t_ids), (SELECT eid FROM t_ids), '2026-08-20', '2026-08-20', 'approved');

SELECT is(
  (SELECT count(*)::int FROM check_timeoff_conflict(
     (SELECT eid FROM t_ids),
     ('2026-08-20 01:00'::timestamp AT TIME ZONE 'Asia/Tokyo'),
     ('2026-08-20 05:00'::timestamp AT TIME ZONE 'Asia/Tokyo'))),
  1,
  'Early-morning shift in a UTC+9 restaurant conflicts with that local day off'
);

-- ---------------------------------------------------------------------------
-- CASE 10 (invalid timezone): garbage restaurants.timezone must fall back to UTC
-- rather than raising — worst case is today's behaviour, never an error.
-- ---------------------------------------------------------------------------
UPDATE restaurants SET timezone = 'Not/AZone' WHERE id = (SELECT rid FROM t_ids);

SELECT lives_ok(
  $$ SELECT * FROM check_timeoff_conflict(
       (SELECT eid FROM t_ids),
       '2026-08-20 01:00+00'::timestamptz, '2026-08-20 05:00+00'::timestamptz) $$,
  'Invalid restaurant timezone falls back to UTC without raising'
);

SELECT * FROM finish();
ROLLBACK;
