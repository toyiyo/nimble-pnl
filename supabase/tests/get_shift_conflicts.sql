-- get_shift_conflicts returns time-off and availability conflicts for every
-- live shift of one restaurant in one window. It must reuse the rules in
-- check_timeoff_conflict and check_availability_conflict, skip dead shifts,
-- cap the window at 32 days, and respect RLS and the anon revoke.
BEGIN;
SELECT plan(15);

SET LOCAL client_min_messages TO WARNING;

SET LOCAL role TO postgres;
ALTER TABLE restaurants            DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees              DISABLE ROW LEVEL SECURITY;
ALTER TABLE shifts                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE time_off_requests      DISABLE ROW LEVEL SECURITY;
ALTER TABLE employee_availability  DISABLE ROW LEVEL SECURITY;
ALTER TABLE availability_exceptions DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants       DISABLE ROW LEVEL SECURITY;

CREATE TEMP TABLE t_ids AS SELECT
  '61000000-0000-0000-0000-000000000001'::uuid AS rid,
  '61000000-0000-0000-0000-000000000002'::uuid AS rid_b,
  '61000000-0000-0000-0000-000000000011'::uuid AS eid,
  '61000000-0000-0000-0000-000000000012'::uuid AS eid_b,
  '61000000-0000-0000-0000-000000000021'::uuid AS uid_a;
GRANT SELECT ON t_ids TO PUBLIC;

DELETE FROM shifts                 WHERE restaurant_id IN ((SELECT rid FROM t_ids), (SELECT rid_b FROM t_ids));
DELETE FROM time_off_requests      WHERE restaurant_id IN ((SELECT rid FROM t_ids), (SELECT rid_b FROM t_ids));
DELETE FROM employee_availability  WHERE restaurant_id IN ((SELECT rid FROM t_ids), (SELECT rid_b FROM t_ids));
DELETE FROM availability_exceptions WHERE restaurant_id IN ((SELECT rid FROM t_ids), (SELECT rid_b FROM t_ids));
DELETE FROM user_restaurants       WHERE restaurant_id IN ((SELECT rid FROM t_ids), (SELECT rid_b FROM t_ids));
DELETE FROM employees              WHERE id IN ((SELECT eid FROM t_ids), (SELECT eid_b FROM t_ids));
DELETE FROM restaurants            WHERE id IN ((SELECT rid FROM t_ids), (SELECT rid_b FROM t_ids));

INSERT INTO restaurants (id, name, timezone) VALUES
  ((SELECT rid FROM t_ids),   'Conflicts A', 'America/Chicago'),
  ((SELECT rid_b FROM t_ids), 'Conflicts B', 'America/Chicago');

INSERT INTO employees (id, restaurant_id, name, position, status) VALUES
  ((SELECT eid FROM t_ids),   (SELECT rid FROM t_ids),   'Conflict Emp A', 'staff', 'active'),
  ((SELECT eid_b FROM t_ids), (SELECT rid_b FROM t_ids), 'Conflict Emp B', 'staff', 'active');

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES ((SELECT uid_a FROM t_ids), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'conflicts-a-61@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_restaurants (user_id, restaurant_id, role)
VALUES ((SELECT uid_a FROM t_ids), (SELECT rid FROM t_ids), 'owner');

-- Shifts: one per scenario, local Chicago times. Id suffix = scenario day.
-- Sep 1 approved, Sep 2 pending, Sep 3 denied, Sep 4 two requests.
INSERT INTO time_off_requests (restaurant_id, employee_id, start_date, end_date, status) VALUES
  ((SELECT rid FROM t_ids), (SELECT eid FROM t_ids), '2026-09-01', '2026-09-01', 'approved'),
  ((SELECT rid FROM t_ids), (SELECT eid FROM t_ids), '2026-09-02', '2026-09-02', 'pending'),
  ((SELECT rid FROM t_ids), (SELECT eid FROM t_ids), '2026-09-03', '2026-09-03', 'rejected'),
  ((SELECT rid FROM t_ids), (SELECT eid FROM t_ids), '2026-09-04', '2026-09-04', 'approved'),
  ((SELECT rid FROM t_ids), (SELECT eid FROM t_ids), '2026-09-04', '2026-09-04', 'pending'),
  ((SELECT rid FROM t_ids), (SELECT eid FROM t_ids), '2026-09-06', '2026-09-06', 'approved'),
  ((SELECT rid FROM t_ids), (SELECT eid FROM t_ids), '2026-09-21', '2026-09-23', 'approved');

-- Availability: exception unavailable Sep 8; recurring unavailable Thursday
-- (Sep 10, Sep 17); exception available Sep 17 overrides the recurring row.
INSERT INTO availability_exceptions (employee_id, restaurant_id, date, is_available, reason) VALUES
  ((SELECT eid FROM t_ids), (SELECT rid FROM t_ids), '2026-09-08', false, 'Personal day'),
  ((SELECT eid FROM t_ids), (SELECT rid FROM t_ids), '2026-09-17', true,  'Swapped in');
INSERT INTO employee_availability (employee_id, restaurant_id, day_of_week, start_time, end_time, is_available)
VALUES ((SELECT eid FROM t_ids), (SELECT rid FROM t_ids), 4, '00:00:00', '23:59:59', false);

INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, break_duration, status) VALUES
  ('61000000-0000-0000-0000-000000000101', (SELECT rid FROM t_ids), (SELECT eid FROM t_ids), '2026-09-01 10:00'::timestamp AT TIME ZONE 'America/Chicago', '2026-09-01 18:00'::timestamp AT TIME ZONE 'America/Chicago', 'Server', 0, 'scheduled'),
  ('61000000-0000-0000-0000-000000000102', (SELECT rid FROM t_ids), (SELECT eid FROM t_ids), '2026-09-02 10:00'::timestamp AT TIME ZONE 'America/Chicago', '2026-09-02 18:00'::timestamp AT TIME ZONE 'America/Chicago', 'Server', 0, 'scheduled'),
  ('61000000-0000-0000-0000-000000000103', (SELECT rid FROM t_ids), (SELECT eid FROM t_ids), '2026-09-03 10:00'::timestamp AT TIME ZONE 'America/Chicago', '2026-09-03 18:00'::timestamp AT TIME ZONE 'America/Chicago', 'Server', 0, 'scheduled'),
  ('61000000-0000-0000-0000-000000000104', (SELECT rid FROM t_ids), (SELECT eid FROM t_ids), '2026-09-04 10:00'::timestamp AT TIME ZONE 'America/Chicago', '2026-09-04 18:00'::timestamp AT TIME ZONE 'America/Chicago', 'Server', 0, 'scheduled'),
  ('61000000-0000-0000-0000-000000000105', (SELECT rid FROM t_ids), (SELECT eid FROM t_ids), '2026-09-05 18:00'::timestamp AT TIME ZONE 'America/Chicago', '2026-09-06 00:00'::timestamp AT TIME ZONE 'America/Chicago', 'Server', 0, 'scheduled'),
  ('61000000-0000-0000-0000-000000000108', (SELECT rid FROM t_ids), (SELECT eid FROM t_ids), '2026-09-08 10:00'::timestamp AT TIME ZONE 'America/Chicago', '2026-09-08 18:00'::timestamp AT TIME ZONE 'America/Chicago', 'Server', 0, 'scheduled'),
  ('61000000-0000-0000-0000-000000000110', (SELECT rid FROM t_ids), (SELECT eid FROM t_ids), '2026-09-10 10:00'::timestamp AT TIME ZONE 'America/Chicago', '2026-09-10 18:00'::timestamp AT TIME ZONE 'America/Chicago', 'Server', 0, 'scheduled'),
  ('61000000-0000-0000-0000-000000000117', (SELECT rid FROM t_ids), (SELECT eid FROM t_ids), '2026-09-17 10:00'::timestamp AT TIME ZONE 'America/Chicago', '2026-09-17 18:00'::timestamp AT TIME ZONE 'America/Chicago', 'Server', 0, 'scheduled'),
  ('61000000-0000-0000-0000-000000000121', (SELECT rid FROM t_ids), (SELECT eid FROM t_ids), '2026-09-21 10:00'::timestamp AT TIME ZONE 'America/Chicago', '2026-09-21 18:00'::timestamp AT TIME ZONE 'America/Chicago', 'Server', 0, 'cancelled'),
  ('61000000-0000-0000-0000-000000000122', (SELECT rid FROM t_ids), (SELECT eid FROM t_ids), '2026-09-22 10:00'::timestamp AT TIME ZONE 'America/Chicago', '2026-09-22 18:00'::timestamp AT TIME ZONE 'America/Chicago', 'Server', 0, 'completed'),
  ('61000000-0000-0000-0000-000000000201', (SELECT rid_b FROM t_ids), (SELECT eid_b FROM t_ids), '2026-09-01 10:00'::timestamp AT TIME ZONE 'America/Chicago', '2026-09-01 18:00'::timestamp AT TIME ZONE 'America/Chicago', 'Server', 0, 'scheduled');
INSERT INTO time_off_requests (restaurant_id, employee_id, start_date, end_date, status)
VALUES ((SELECT rid_b FROM t_ids), (SELECT eid_b FROM t_ids), '2026-09-01', '2026-09-01', 'approved');

-- 1
SELECT has_function('public', 'get_shift_conflicts', ARRAY['uuid','timestamp with time zone','timestamp with time zone']);

CREATE TEMP TABLE r AS
SELECT * FROM get_shift_conflicts((SELECT rid FROM t_ids), '2026-08-31 00:00+00', '2026-09-30 00:00+00');
GRANT SELECT ON r TO PUBLIC;

-- 2
SELECT results_eq(
  $$SELECT conflict_type, status FROM r WHERE shift_id = '61000000-0000-0000-0000-000000000101'$$,
  $$VALUES ('time_off'::text, 'approved'::text)$$,
  'approved day off gives one time_off row');
-- 3
SELECT results_eq(
  $$SELECT conflict_type, status FROM r WHERE shift_id = '61000000-0000-0000-0000-000000000102'$$,
  $$VALUES ('time_off'::text, 'pending'::text)$$,
  'pending request gives one time_off row');
-- 4
SELECT is_empty($$SELECT * FROM r WHERE shift_id = '61000000-0000-0000-0000-000000000103' AND conflict_type = 'time_off'$$,
  'denied request gives no row');
-- 5
SELECT is((SELECT count(*)::int FROM r WHERE shift_id = '61000000-0000-0000-0000-000000000104' AND conflict_type = 'time_off'), 2,
  'two overlapping requests give two time_off rows');
-- 6
SELECT is_empty($$SELECT * FROM r WHERE shift_id = '61000000-0000-0000-0000-000000000105'$$,
  'shift that ends at local midnight before a day off gives no row');
-- 7
SELECT results_eq(
  $$SELECT conflict_type, source FROM r WHERE shift_id = '61000000-0000-0000-0000-000000000108'$$,
  $$VALUES ('availability'::text, 'exception'::text)$$,
  'unavailable exception gives availability/exception');
-- 8
SELECT results_eq(
  $$SELECT conflict_type, source FROM r WHERE shift_id = '61000000-0000-0000-0000-000000000110'$$,
  $$VALUES ('availability'::text, 'recurring'::text)$$,
  'recurring unavailable window gives availability/recurring');
-- 9
SELECT is_empty($$SELECT * FROM r WHERE shift_id = '61000000-0000-0000-0000-000000000117'$$,
  'available exception overrides recurring unavailable row');
-- 10
SELECT is_empty($$SELECT * FROM r WHERE shift_id = '61000000-0000-0000-0000-000000000121'$$,
  'cancelled shift gives no row');
-- 11
SELECT is_empty($$SELECT * FROM r WHERE shift_id = '61000000-0000-0000-0000-000000000122'$$,
  'completed shift gives no row');
-- 12
-- shifts.employee_id is NOT NULL, so an open shift cannot be a shifts row.
-- The function keeps its IS NOT NULL guard; this check pins the column rule.
SELECT col_not_null('public', 'shifts', 'employee_id', 'open shifts are not shifts rows');
-- 13
SELECT is(
  (SELECT count(*)::int FROM get_shift_conflicts((SELECT rid FROM t_ids), '2026-08-31 00:00+00', '2026-10-10 00:00+00')),
  0, 'window of 40 days returns zero rows');
-- 14
SELECT ok(NOT has_function_privilege('anon', 'public.get_shift_conflicts(uuid,timestamptz,timestamptz)', 'EXECUTE'),
  'anon cannot execute get_shift_conflicts');

-- RLS block: a member of restaurant A reads A, not B.
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_off_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;

SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"61000000-0000-0000-0000-000000000021","role":"authenticated"}', true);

-- 15
SELECT results_eq(
  $$SELECT
      (SELECT count(*) FROM get_shift_conflicts((SELECT rid FROM t_ids), '2026-08-31 00:00+00', '2026-09-30 00:00+00')) > 0,
      (SELECT count(*) FROM get_shift_conflicts((SELECT rid_b FROM t_ids), '2026-08-31 00:00+00', '2026-09-30 00:00+00'))::int$$,
  $$VALUES (true, 0)$$,
  'RLS: member of A sees A rows and zero rows for B');

SELECT * FROM finish();
ROLLBACK;
