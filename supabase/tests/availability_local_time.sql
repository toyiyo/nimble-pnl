BEGIN;
SELECT plan(40);

SET LOCAL client_min_messages TO WARNING;

ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE employee_availability DISABLE ROW LEVEL SECURITY;

CREATE TEMP TABLE t_ids AS SELECT
  'a1111111-1111-1111-1111-111111111111'::uuid AS r_chi,
  'a2222222-2222-2222-2222-222222222222'::uuid AS r_bad,
  'a3333333-3333-3333-3333-333333333333'::uuid AS r_nul,
  'b1111111-1111-1111-1111-111111111111'::uuid AS e_chi,
  'b2222222-2222-2222-2222-222222222222'::uuid AS e_bad,
  'b3333333-3333-3333-3333-333333333333'::uuid AS e_nul;
GRANT ALL ON t_ids TO PUBLIC;

DELETE FROM employee_availability WHERE restaurant_id IN (SELECT r_chi FROM t_ids UNION SELECT r_bad FROM t_ids UNION SELECT r_nul FROM t_ids);
DELETE FROM employees WHERE id IN (SELECT e_chi FROM t_ids UNION SELECT e_bad FROM t_ids UNION SELECT e_nul FROM t_ids);
DELETE FROM restaurants WHERE id IN (SELECT r_chi FROM t_ids UNION SELECT r_bad FROM t_ids UNION SELECT r_nul FROM t_ids);

INSERT INTO restaurants (id, name, timezone) VALUES
  ((SELECT r_chi FROM t_ids), 'Local Chicago', 'America/Chicago'),
  ((SELECT r_bad FROM t_ids), 'Local Bad TZ', 'Not/AZone'),
  ((SELECT r_nul FROM t_ids), 'Local Null TZ', NULL);

INSERT INTO employees (id, restaurant_id, name, position, status) VALUES
  ((SELECT e_chi FROM t_ids), (SELECT r_chi FROM t_ids), 'Chi Emp', 'staff', 'active'),
  ((SELECT e_bad FROM t_ids), (SELECT r_bad FROM t_ids), 'Bad Emp', 'staff', 'active'),
  ((SELECT e_nul FROM t_ids), (SELECT r_nul FROM t_ids), 'Null Emp', 'staff', 'active');

-- Offset helper
SELECT is(availability_noon_offset('2026-07-15 17:00+00', 'America/Chicago'), '-05:00'::interval, 'CDT');
SELECT is(availability_noon_offset('2026-12-15 18:00+00', 'America/Chicago'), '-06:00'::interval, 'CST');
SELECT is(availability_noon_offset('2026-11-01 12:00+00', 'America/Chicago'), '-06:00'::interval, 'fall day uses noon');
SELECT is(availability_noon_offset('2026-03-08 12:00+00', 'America/Chicago'), '-05:00'::interval, 'spring day uses noon');
SELECT is(availability_noon_offset('2026-11-01 04:30+00', 'America/Chicago'), '-05:00'::interval, 'local date is Oct 31');
SELECT is(availability_noon_offset(now(), 'Not/AZone'), '00:00'::interval, 'invalid timezone');
SELECT is(availability_noon_offset(now(), NULL), '00:00'::interval, 'null timezone');

-- INSERT cases (spec 7.2)
-- 1. Both local set, legacy also set: local wins.
INSERT INTO employee_availability (restaurant_id, employee_id, day_of_week, start_time_local, end_time_local, start_time, end_time)
VALUES ((SELECT r_chi FROM t_ids), (SELECT e_chi FROM t_ids), 1, '10:00', '22:00', '01:00', '02:00');
SELECT is(
  (SELECT start_time FROM employee_availability WHERE employee_id = (SELECT e_chi FROM t_ids) AND day_of_week = 1),
  '10:00'::time - availability_noon_offset(now(), 'America/Chicago'),
  'insert: local wins, legacy start derived');
SELECT is(
  (SELECT end_time FROM employee_availability WHERE employee_id = (SELECT e_chi FROM t_ids) AND day_of_week = 1),
  '22:00'::time - availability_noon_offset(now(), 'America/Chicago'),
  'insert: local wins, legacy end derived');

-- 2. Legacy only (stale insert)
INSERT INTO employee_availability (restaurant_id, employee_id, day_of_week, start_time, end_time)
VALUES ((SELECT r_chi FROM t_ids), (SELECT e_chi FROM t_ids), 2, '15:00', '03:00');
SELECT is(
  (SELECT start_time_local FROM employee_availability WHERE employee_id = (SELECT e_chi FROM t_ids) AND day_of_week = 2),
  '15:00'::time + availability_noon_offset(now(), 'America/Chicago'),
  'stale insert: local start derived');
SELECT is(
  (SELECT end_time_local FROM employee_availability WHERE employee_id = (SELECT e_chi FROM t_ids) AND day_of_week = 2),
  '03:00'::time + availability_noon_offset(now(), 'America/Chicago'),
  'stale insert: local end derived and wraps');

-- 3. Closed day keeps four values
INSERT INTO employee_availability (restaurant_id, employee_id, day_of_week, is_available, start_time_local, end_time_local)
VALUES ((SELECT r_chi FROM t_ids), (SELECT e_chi FROM t_ids), 3, false, '00:00', '23:59');
SELECT ok(
  (SELECT start_time IS NOT NULL AND end_time IS NOT NULL FROM employee_availability WHERE employee_id = (SELECT e_chi FROM t_ids) AND day_of_week = 3),
  'closed day: legacy values are not null');

-- 4. Incomplete pairs
SELECT throws_ok(
  format($$INSERT INTO employee_availability (restaurant_id, employee_id, day_of_week, start_time_local) VALUES (%L, %L, 4, '10:00')$$,
    (SELECT r_chi FROM t_ids), (SELECT e_chi FROM t_ids)),
  '23502', NULL, 'insert: local start only raises');
SELECT throws_ok(
  format($$INSERT INTO employee_availability (restaurant_id, employee_id, day_of_week, start_time) VALUES (%L, %L, 4, '10:00')$$,
    (SELECT r_chi FROM t_ids), (SELECT e_chi FROM t_ids)),
  '23502', NULL, 'insert: legacy start only raises');
SELECT throws_ok(
  format($$INSERT INTO employee_availability (restaurant_id, employee_id, day_of_week) VALUES (%L, %L, 4)$$,
    (SELECT r_chi FROM t_ids), (SELECT e_chi FROM t_ids)),
  '23502', NULL, 'insert: no times raises');

-- UPDATE cases (spec 7.2). Reset day 1 to known values.
UPDATE employee_availability SET start_time_local = '10:00', end_time_local = '22:00'
WHERE employee_id = (SELECT e_chi FROM t_ids) AND day_of_week = 1;

SELECT throws_ok(
  format($$UPDATE employee_availability SET end_time_local = NULL WHERE employee_id = %L AND day_of_week = 1$$, (SELECT e_chi FROM t_ids)),
  '23502', NULL, 'update: local set to null raises');
SELECT throws_ok(
  format($$UPDATE employee_availability SET end_time = NULL WHERE employee_id = %L AND day_of_week = 1$$, (SELECT e_chi FROM t_ids)),
  '23502', NULL, 'update: legacy set to null raises');

-- Local change derives legacy
UPDATE employee_availability SET end_time_local = '23:00'
WHERE employee_id = (SELECT e_chi FROM t_ids) AND day_of_week = 1;
SELECT is(
  (SELECT end_time FROM employee_availability WHERE employee_id = (SELECT e_chi FROM t_ids) AND day_of_week = 1),
  '23:00'::time - availability_noon_offset(now(), 'America/Chicago'),
  'update: local change derives legacy end');
SELECT is(
  (SELECT start_time FROM employee_availability WHERE employee_id = (SELECT e_chi FROM t_ids) AND day_of_week = 1),
  '10:00'::time - availability_noon_offset(now(), 'America/Chicago'),
  'update: local change derives legacy start');

-- Stale update, one column: end_time changes, start_time the same
UPDATE employee_availability
SET start_time = (SELECT start_time FROM employee_availability WHERE employee_id = (SELECT e_chi FROM t_ids) AND day_of_week = 1),
    end_time = '20:00'
WHERE employee_id = (SELECT e_chi FROM t_ids) AND day_of_week = 1;
SELECT is(
  (SELECT start_time_local FROM employee_availability WHERE employee_id = (SELECT e_chi FROM t_ids) AND day_of_week = 1),
  '10:00'::time, 'stale update: unchanged column keeps local start');
SELECT is(
  (SELECT end_time_local FROM employee_availability WHERE employee_id = (SELECT e_chi FROM t_ids) AND day_of_week = 1),
  '20:00'::time + availability_noon_offset(now(), 'America/Chicago'),
  'stale update: changed column derives local end');

-- Stale save, no change
UPDATE employee_availability SET start_time = start_time, end_time = end_time, notes = 'same'
WHERE employee_id = (SELECT e_chi FROM t_ids) AND day_of_week = 1;
SELECT is(
  (SELECT start_time_local FROM employee_availability WHERE employee_id = (SELECT e_chi FROM t_ids) AND day_of_week = 1),
  '10:00'::time, 'stale save with no change: local start stays');
SELECT is(
  (SELECT end_time_local FROM employee_availability WHERE employee_id = (SELECT e_chi FROM t_ids) AND day_of_week = 1),
  '20:00'::time + availability_noon_offset(now(), 'America/Chicago'),
  'stale save with no change: local end stays');

-- Whole row back: new local end, old legacy values. Local wins.
UPDATE employee_availability SET start_time_local = '10:00', end_time_local = '21:00',
  start_time = '15:00', end_time = '16:00'
WHERE employee_id = (SELECT e_chi FROM t_ids) AND day_of_week = 1;
SELECT is(
  (SELECT end_time_local FROM employee_availability WHERE employee_id = (SELECT e_chi FROM t_ids) AND day_of_week = 1),
  '21:00'::time, 'whole row back: local end wins');
SELECT is(
  (SELECT end_time FROM employee_availability WHERE employee_id = (SELECT e_chi FROM t_ids) AND day_of_week = 1),
  '21:00'::time - availability_noon_offset(now(), 'America/Chicago'),
  'whole row back: legacy end follows local');

-- Local equal
SELECT throws_ok(
  format($$UPDATE employee_availability SET end_time_local = start_time_local WHERE employee_id = %L AND day_of_week = 1$$, (SELECT e_chi FROM t_ids)),
  '23514', NULL, 'update: equal local times raise a check violation');

-- No time column changes: nothing happens
UPDATE employee_availability SET notes = 'x' WHERE employee_id = (SELECT e_chi FROM t_ids) AND day_of_week = 1;
SELECT is(
  (SELECT end_time_local FROM employee_availability WHERE employee_id = (SELECT e_chi FROM t_ids) AND day_of_week = 1),
  '21:00'::time, 'update: no time change does nothing');

-- Invalid and null timezone: zero offset
INSERT INTO employee_availability (restaurant_id, employee_id, day_of_week, start_time_local, end_time_local)
VALUES ((SELECT r_bad FROM t_ids), (SELECT e_bad FROM t_ids), 1, '10:00', '22:00'),
       ((SELECT r_nul FROM t_ids), (SELECT e_nul FROM t_ids), 1, '10:00', '22:00');
SELECT is(
  (SELECT start_time FROM employee_availability WHERE employee_id = (SELECT e_bad FROM t_ids)),
  '10:00'::time, 'invalid timezone: legacy start equals local');
SELECT is(
  (SELECT end_time FROM employee_availability WHERE employee_id = (SELECT e_bad FROM t_ids)),
  '22:00'::time, 'invalid timezone: legacy end equals local');
SELECT is(
  (SELECT start_time FROM employee_availability WHERE employee_id = (SELECT e_nul FROM t_ids)),
  '10:00'::time, 'null timezone: legacy start equals local');
SELECT is(
  (SELECT end_time FROM employee_availability WHERE employee_id = (SELECT e_nul FROM t_ids)),
  '22:00'::time, 'null timezone: legacy end equals local');

-- Hidden restaurant: caller cannot read restaurants, offset must still be Chicago
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
SET LOCAL ROLE authenticated;
INSERT INTO employee_availability (restaurant_id, employee_id, day_of_week, start_time, end_time)
VALUES ((SELECT r_chi FROM t_ids), (SELECT e_chi FROM t_ids), 5, '15:00', '03:00');
RESET ROLE;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
SELECT is(
  (SELECT start_time_local FROM employee_availability WHERE employee_id = (SELECT e_chi FROM t_ids) AND day_of_week = 5),
  '15:00'::time + availability_noon_offset(now(), 'America/Chicago'),
  'hidden restaurant: Chicago offset, not zero');

-- Backfill cases
ALTER TABLE employee_availability DISABLE TRIGGER sync_employee_availability_frames;
ALTER TABLE employee_availability DISABLE TRIGGER update_employee_availability_updated_at;
DELETE FROM employee_availability WHERE restaurant_id IN (SELECT r_chi FROM t_ids UNION SELECT r_bad FROM t_ids UNION SELECT r_nul FROM t_ids);

INSERT INTO employee_availability (restaurant_id, employee_id, day_of_week, start_time, end_time, is_available, created_at, updated_at) VALUES
  ((SELECT r_chi FROM t_ids), (SELECT e_chi FROM t_ids), 0, '15:00', '03:00', true,  '2026-07-01 00:00+00', '2026-07-15 17:00+00'),
  ((SELECT r_chi FROM t_ids), (SELECT e_chi FROM t_ids), 1, '16:00', '04:00', true,  '2026-07-01 00:00+00', '2026-12-15 18:00+00'),
  ((SELECT r_chi FROM t_ids), (SELECT e_chi FROM t_ids), 2, '05:00', '07:00', true,  '2026-07-01 00:00+00', '2026-11-01 18:00+00'),
  ((SELECT r_bad FROM t_ids), (SELECT e_bad FROM t_ids), 0, '15:00', '03:00', true,  '2026-07-01 00:00+00', '2026-07-15 17:00+00'),
  ((SELECT r_chi FROM t_ids), (SELECT e_chi FROM t_ids), 3, '15:00', '03:00', true,  '2026-07-15 17:00+00', NULL),
  ((SELECT r_chi FROM t_ids), (SELECT e_chi FROM t_ids), 4, '15:00', '03:00', false, '2026-07-01 00:00+00', '2026-07-15 17:00+00');

SELECT cmp_ok(backfill_employee_availability_local(), '>=', 6, 'backfill returns the updated row count');

SELECT results_eq(
  $$SELECT start_time_local, end_time_local FROM employee_availability WHERE employee_id = 'b1111111-1111-1111-1111-111111111111' AND day_of_week = 0$$,
  $$VALUES ('10:00'::time, '22:00'::time)$$, 'backfill: CDT row');
SELECT results_eq(
  $$SELECT start_time_local, end_time_local FROM employee_availability WHERE employee_id = 'b1111111-1111-1111-1111-111111111111' AND day_of_week = 1$$,
  $$VALUES ('10:00'::time, '22:00'::time)$$, 'backfill: CST row');
SELECT results_eq(
  $$SELECT start_time_local, end_time_local FROM employee_availability WHERE employee_id = 'b1111111-1111-1111-1111-111111111111' AND day_of_week = 2$$,
  $$VALUES ('23:00'::time, '01:00'::time)$$, 'backfill: day of the fall time change uses the noon offset');
SELECT results_eq(
  $$SELECT start_time_local, end_time_local FROM employee_availability WHERE employee_id = 'b2222222-2222-2222-2222-222222222222'$$,
  $$VALUES ('15:00'::time, '03:00'::time)$$, 'backfill: invalid timezone uses zero offset');
SELECT results_eq(
  $$SELECT start_time_local, end_time_local FROM employee_availability WHERE employee_id = 'b1111111-1111-1111-1111-111111111111' AND day_of_week = 3$$,
  $$VALUES ('10:00'::time, '22:00'::time)$$, 'backfill: null updated_at falls back to created_at');
SELECT results_eq(
  $$SELECT start_time_local, end_time_local FROM employee_availability WHERE employee_id = 'b1111111-1111-1111-1111-111111111111' AND day_of_week = 4$$,
  $$VALUES ('10:00'::time, '22:00'::time)$$, 'backfill: closed day gets local values');
SELECT results_eq(
  $$SELECT start_time, end_time, updated_at FROM employee_availability WHERE employee_id = 'b1111111-1111-1111-1111-111111111111' AND day_of_week = 0$$,
  $$VALUES ('15:00'::time, '03:00'::time, '2026-07-15 17:00+00'::timestamptz)$$, 'backfill keeps legacy values and updated_at');

SELECT * FROM finish();
ROLLBACK;
