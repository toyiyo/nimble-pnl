-- pgTAP for update_shift_template_with_cascade (Task 1) and
-- undo_template_hours_cascade (Task 2), from
-- supabase/migrations/20260804130000_template_hours_cascade.sql, plus the
-- template-restore behavior of undo_template_hours_cascade from
-- supabase/migrations/20260805160000_template_cascade_undo_restores_template.sql.
--
-- What makes this suite non-vacuous:
--   * The Tokyo block proves drift detection reads the RESTAURANT's wall clock.
--     A shift at 09:00 Asia/Tokyo is 00:00 UTC; bucketing it with a bare
--     `start_time::time` would compare 00:00 against the template's 09:00, call
--     a perfectly-matching shift "drifted", and silently exclude it.
--   * The drifted fixture sits at 11:00-19:00, deliberately NOT equal to the
--     new template times, so "left alone" and "cascaded" are distinguishable.
--   * The cross-tenant block passes a template id from restaurant B together
--     with p_restaurant_id = A. The capability guard PASSES (the caller really
--     does manage A); only the per-statement restaurant_id scoping stops it.
--
-- No hardcoded calendar dates: everything is anchored to the next Monday after
-- CURRENT_DATE, and instants are built as `<local timestamp> AT TIME ZONE
-- '<iana>'` so the fixtures survive every DST transition.
--
-- Auth context: schedule_change_logs.changed_by is NOT NULL REFERENCES
-- auth.users(id), and user_has_capability reads auth.uid(). Both come from
-- request.jwt.claims, which is role-independent, so the suite stays as postgres
-- throughout and never re-enables RLS mid-file.

BEGIN;

SELECT plan(46);

-- ============================================
-- Setup
-- ============================================

SET LOCAL role TO postgres;
ALTER TABLE restaurants          DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees            DISABLE ROW LEVEL SECURITY;
ALTER TABLE shifts               DISABLE ROW LEVEL SECURITY;
ALTER TABLE shift_templates      DISABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_change_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants     DISABLE ROW LEVEL SECURITY;

-- Next Monday. ISODOW: Monday = 1 ... Sunday = 7, so 8 - ISODOW is always in
-- [1, 7] and never resolves to today — every "future" fixture stays future.
CREATE TEMP TABLE test_config AS
SELECT (CURRENT_DATE + (8 - EXTRACT(ISODOW FROM CURRENT_DATE)::int)) AS mon;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('a11ce000-0000-0000-0000-0000000ca001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cascade-chi-mgr@example.com',   crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('a11ce000-0000-0000-0000-0000000ca002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cascade-tky-mgr@example.com',   crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('a11ce000-0000-0000-0000-0000000ca003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cascade-chi-staff@example.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- DO UPDATE, not DO NOTHING: the timezone is the subject of half this suite, so
-- a retained row from an earlier run with a different zone would silently
-- invalidate every bucketing assertion below.
INSERT INTO restaurants (id, name, timezone) VALUES
  ('c0000000-0000-0000-0000-0000000ca001', 'Cascade Chicago', 'America/Chicago'),
  ('c0000000-0000-0000-0000-0000000ca002', 'Cascade Tokyo',   'Asia/Tokyo')
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, timezone = EXCLUDED.timezone;

INSERT INTO employees (id, restaurant_id, name, position) VALUES
  ('e0000000-0000-0000-0000-0000000ca001', 'c0000000-0000-0000-0000-0000000ca001', 'Casey Chicago', 'Server'),
  ('e0000000-0000-0000-0000-0000000ca002', 'c0000000-0000-0000-0000-0000000ca002', 'Toshi Tokyo',   'Server')
ON CONFLICT (id) DO UPDATE
  SET restaurant_id = EXCLUDED.restaurant_id, name = EXCLUDED.name, position = EXCLUDED.position;

-- role_id stays NULL, so user_has_capability takes its legacy-role CASE branch.
-- 'staff' is absent from the edit:scheduling row list at
-- 20260730140000_user_has_capability_from_areas.sql:146 — that is what makes
-- the insufficient_privilege assertion real rather than a membership check.
-- The Chicago manager is deliberately NOT a member of Tokyo, and vice versa.
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('a11ce000-0000-0000-0000-0000000ca001', 'c0000000-0000-0000-0000-0000000ca001', 'owner'),
  ('a11ce000-0000-0000-0000-0000000ca002', 'c0000000-0000-0000-0000-0000000ca002', 'owner'),
  ('a11ce000-0000-0000-0000-0000000ca003', 'c0000000-0000-0000-0000-0000000ca001', 'staff')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role, role_id = NULL;

-- Five templates, all 09:00-17:00 except the midnight-crossing one. Separate
-- templates per scenario so one call's writes cannot make a later assertion
-- vacuous.
--
-- B and E carry distinct `area` values that A does not. Without them, A, B
-- and E would all sit at the identical (restaurant_id, position, start_time,
-- end_time, days, area) tuple at insert time, and Call A retargeting template
-- A to 10:00-18:00 would then collide with Call B retargeting template B to
-- the same 10:00-18:00 -- both trip uq_shift_templates_active_slot
-- (20260528120000_shift_templates_idempotent_apply.sql), the partial unique
-- index that keeps "Apply suggested shifts" idempotent. No assertion below
-- inspects `area`, so this is purely a collision-avoidance knob, carried
-- through to Call B's p_area argument below so the post-UPDATE row stays
-- distinct from template A's.
INSERT INTO shift_templates (id, restaurant_id, name, days, start_time, end_time, break_duration, position, capacity, is_active, area) VALUES
  ('7a000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000ca001', 'A Baseline',  '{1,2,3,4,5}', '09:00', '17:00', 30, 'Server', 1, true, NULL),
  ('7b000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-0000000ca001', 'B Drift',     '{1,2,3,4,5}', '09:00', '17:00', 30, 'Server', 1, true, 'Cascade Test Zone B'),
  ('7c000000-0000-0000-0000-00000000000c', 'c0000000-0000-0000-0000-0000000ca002', 'C Tokyo',     '{1,2,3,4,5}', '09:00', '17:00', 30, 'Server', 1, true, NULL),
  ('7d000000-0000-0000-0000-00000000000d', 'c0000000-0000-0000-0000-0000000ca001', 'D Overnight', '{1,2,3,4,5}', '22:00', '02:00', 30, 'Server', 1, true, NULL),
  ('7e000000-0000-0000-0000-00000000000e', 'c0000000-0000-0000-0000-0000000ca001', 'E NoCascade', '{1,2,3,4,5}', '09:00', '17:00', 30, 'Server', 1, true, 'Cascade Test Zone E')
ON CONFLICT (id) DO UPDATE
  SET restaurant_id = EXCLUDED.restaurant_id, days = EXCLUDED.days,
      start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, area = EXCLUDED.area;

-- Template A fixtures: one of each bucket, plus a published one for the flag.
INSERT INTO shifts (id, restaurant_id, employee_id, shift_template_id, start_time, end_time, position, locked, is_published)
SELECT * FROM (VALUES
  -- A1: future, unlocked, matches 09:00-17:00 -> cascades
  ('11000000-0000-0000-0000-0000000000a1'::uuid, 'c0000000-0000-0000-0000-0000000ca001'::uuid, 'e0000000-0000-0000-0000-0000000ca001'::uuid, '7a000000-0000-0000-0000-00000000000a'::uuid,
   ((SELECT mon FROM test_config)::timestamp + interval '9 hours')  AT TIME ZONE 'America/Chicago',
   ((SELECT mon FROM test_config)::timestamp + interval '17 hours') AT TIME ZONE 'America/Chicago', 'Server', false, false),
  -- A2: PAST (two weeks back), matches -> never touched
  ('11000000-0000-0000-0000-0000000000a2'::uuid, 'c0000000-0000-0000-0000-0000000ca001'::uuid, 'e0000000-0000-0000-0000-0000000ca001'::uuid, '7a000000-0000-0000-0000-00000000000a'::uuid,
   (((SELECT mon FROM test_config) - 14)::timestamp + interval '9 hours')  AT TIME ZONE 'America/Chicago',
   (((SELECT mon FROM test_config) - 14)::timestamp + interval '17 hours') AT TIME ZONE 'America/Chicago', 'Server', false, false),
  -- A3: future, LOCKED, matches -> never touched
  ('11000000-0000-0000-0000-0000000000a3'::uuid, 'c0000000-0000-0000-0000-0000000ca001'::uuid, 'e0000000-0000-0000-0000-0000000ca001'::uuid, '7a000000-0000-0000-0000-00000000000a'::uuid,
   (((SELECT mon FROM test_config) + 1)::timestamp + interval '9 hours')  AT TIME ZONE 'America/Chicago',
   (((SELECT mon FROM test_config) + 1)::timestamp + interval '17 hours') AT TIME ZONE 'America/Chicago', 'Server', true, false),
  -- A4: future, unlocked, DRIFTED to 11:00-19:00 -> not opted in, untouched
  ('11000000-0000-0000-0000-0000000000a4'::uuid, 'c0000000-0000-0000-0000-0000000ca001'::uuid, 'e0000000-0000-0000-0000-0000000ca001'::uuid, '7a000000-0000-0000-0000-00000000000a'::uuid,
   (((SELECT mon FROM test_config) + 2)::timestamp + interval '11 hours') AT TIME ZONE 'America/Chicago',
   (((SELECT mon FROM test_config) + 2)::timestamp + interval '19 hours') AT TIME ZONE 'America/Chicago', 'Server', false, false),
  -- A5: future, unlocked, matches, PUBLISHED -> cascades and raises the flag
  ('11000000-0000-0000-0000-0000000000a5'::uuid, 'c0000000-0000-0000-0000-0000000ca001'::uuid, 'e0000000-0000-0000-0000-0000000ca001'::uuid, '7a000000-0000-0000-0000-00000000000a'::uuid,
   (((SELECT mon FROM test_config) + 3)::timestamp + interval '9 hours')  AT TIME ZONE 'America/Chicago',
   (((SELECT mon FROM test_config) + 3)::timestamp + interval '17 hours') AT TIME ZONE 'America/Chicago', 'Server', false, true)
) AS v
ON CONFLICT (id) DO NOTHING;

-- Template B: one matching, one drifted (the drift opt-in block), plus a
-- second drifted-and-PUBLISHED shift (b3) proving a posted hand-edited shift
-- is just as opt-in-able and just as visible in published_shifts as a
-- posted matching one (Test 10).
INSERT INTO shifts (id, restaurant_id, employee_id, shift_template_id, start_time, end_time, position, locked, is_published)
SELECT * FROM (VALUES
  ('11000000-0000-0000-0000-0000000000b1'::uuid, 'c0000000-0000-0000-0000-0000000ca001'::uuid, 'e0000000-0000-0000-0000-0000000ca001'::uuid, '7b000000-0000-0000-0000-00000000000b'::uuid,
   ((SELECT mon FROM test_config)::timestamp + interval '9 hours')  AT TIME ZONE 'America/Chicago',
   ((SELECT mon FROM test_config)::timestamp + interval '17 hours') AT TIME ZONE 'America/Chicago', 'Server', false, false),
  ('11000000-0000-0000-0000-0000000000b2'::uuid, 'c0000000-0000-0000-0000-0000000ca001'::uuid, 'e0000000-0000-0000-0000-0000000ca001'::uuid, '7b000000-0000-0000-0000-00000000000b'::uuid,
   (((SELECT mon FROM test_config) + 1)::timestamp + interval '11 hours') AT TIME ZONE 'America/Chicago',
   (((SELECT mon FROM test_config) + 1)::timestamp + interval '19 hours') AT TIME ZONE 'America/Chicago', 'Server', false, false),
  ('11000000-0000-0000-0000-0000000000b3'::uuid, 'c0000000-0000-0000-0000-0000000ca001'::uuid, 'e0000000-0000-0000-0000-0000000ca001'::uuid, '7b000000-0000-0000-0000-00000000000b'::uuid,
   (((SELECT mon FROM test_config) + 3)::timestamp + interval '11 hours') AT TIME ZONE 'America/Chicago',
   (((SELECT mon FROM test_config) + 3)::timestamp + interval '19 hours') AT TIME ZONE 'America/Chicago', 'Server', false, true)
) AS v
ON CONFLICT (id) DO NOTHING;

-- Template C: Tokyo. 09:00 Asia/Tokyo is 00:00 UTC — the whole point.
INSERT INTO shifts (id, restaurant_id, employee_id, shift_template_id, start_time, end_time, position, locked, is_published)
SELECT * FROM (VALUES
  ('11000000-0000-0000-0000-0000000000c1'::uuid, 'c0000000-0000-0000-0000-0000000ca002'::uuid, 'e0000000-0000-0000-0000-0000000ca002'::uuid, '7c000000-0000-0000-0000-00000000000c'::uuid,
   ((SELECT mon FROM test_config)::timestamp + interval '9 hours')  AT TIME ZONE 'Asia/Tokyo',
   ((SELECT mon FROM test_config)::timestamp + interval '17 hours') AT TIME ZONE 'Asia/Tokyo', 'Server', false, false)
) AS v
ON CONFLICT (id) DO NOTHING;

-- Template D: overnight, 22:00 -> 02:00 the next local day.
INSERT INTO shifts (id, restaurant_id, employee_id, shift_template_id, start_time, end_time, position, locked, is_published)
SELECT * FROM (VALUES
  ('11000000-0000-0000-0000-0000000000d1'::uuid, 'c0000000-0000-0000-0000-0000000ca001'::uuid, 'e0000000-0000-0000-0000-0000000ca001'::uuid, '7d000000-0000-0000-0000-00000000000d'::uuid,
   ((SELECT mon FROM test_config)::timestamp + interval '22 hours')      AT TIME ZONE 'America/Chicago',
   (((SELECT mon FROM test_config) + 1)::timestamp + interval '2 hours') AT TIME ZONE 'America/Chicago', 'Server', false, false)
) AS v
ON CONFLICT (id) DO NOTHING;

-- Template E: the p_cascade = false control.
INSERT INTO shifts (id, restaurant_id, employee_id, shift_template_id, start_time, end_time, position, locked, is_published)
SELECT * FROM (VALUES
  ('11000000-0000-0000-0000-0000000000e1'::uuid, 'c0000000-0000-0000-0000-0000000ca001'::uuid, 'e0000000-0000-0000-0000-0000000ca001'::uuid, '7e000000-0000-0000-0000-00000000000e'::uuid,
   ((SELECT mon FROM test_config)::timestamp + interval '9 hours')  AT TIME ZONE 'America/Chicago',
   ((SELECT mon FROM test_config)::timestamp + interval '17 hours') AT TIME ZONE 'America/Chicago', 'Server', false, false)
) AS v
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Call A — baseline cascade, 09:00-17:00 -> 10:00-18:00
-- ============================================

SELECT set_config('request.jwt.claims',
  '{"sub":"a11ce000-0000-0000-0000-0000000ca001","role":"authenticated"}', true);

CREATE TEMP TABLE call_a AS
SELECT public.update_shift_template_with_cascade(
  '7a000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000ca001',
  'A Baseline', 'Server', NULL, '{1,2,3,4,5}'::int[], 30, 1,
  '10:00'::time, '18:00'::time, true, '{}'::uuid[]
) AS result;

-- Test 1
SELECT is(
  (SELECT (start_time AT TIME ZONE 'America/Chicago')::time FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000a1'),
  '10:00'::time,
  'matching future unlocked shift moves to the new template start'
);

-- Test 2
SELECT is(
  (SELECT (start_time AT TIME ZONE 'America/Chicago')::time FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000a2'),
  '09:00'::time,
  'past shift is never touched'
);

-- Test 3
SELECT is(
  (SELECT (start_time AT TIME ZONE 'America/Chicago')::time FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000a3'),
  '09:00'::time,
  'locked shift is never touched'
);

-- Test 4
SELECT is(
  (SELECT (start_time AT TIME ZONE 'America/Chicago')::time FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000a4'),
  '11:00'::time,
  'drifted shift not opted into is never touched'
);

-- Test 5
SELECT is(
  (SELECT (end_time AT TIME ZONE 'America/Chicago')::time FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000a5'),
  '18:00'::time,
  'published matching shift still moves'
);

-- Test 5b -- the cascade rewrites the time of day and NOTHING else. a5 sits on
-- mon + 3 while a1 sits on mon, so a single anchor date shared across the batch
-- (or an interval offset applied to the wrong row) would land a5 on the wrong
-- day. This is the observable half of deriving the new instants from each
-- shift's own local date; the other half -- a concurrent writer moving the day
-- between snapshot and UPDATE -- needs two sessions and cannot be reached from
-- a single pgTAP transaction.
SELECT is(
  (SELECT (start_time AT TIME ZONE 'America/Chicago')::date FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000a5'),
  ((SELECT mon FROM test_config) + 3),
  'the cascade moves the time of day and leaves the shift on its own date'
);

-- Test 6
SELECT is(
  (SELECT (result->>'updated_count')::int FROM call_a),
  2,
  'updated_count counts exactly the two matching future unlocked shifts'
);

-- Test 7
SELECT is(
  (SELECT jsonb_agg(elem->>'id') FROM call_a, jsonb_array_elements(result->'published_shifts') elem),
  '["11000000-0000-0000-0000-0000000000a5"]'::jsonb,
  'published_shifts carries exactly the one published shift that moved'
);

-- Test 7b -- the pre-cascade instant, not the post-cascade one, so the notify
-- email can render "Previous Start" without a second round trip. A5 was
-- seeded at mon + 3 days (line 123-125), not mon itself.
SELECT is(
  (SELECT (elem->>'previous_start_time')::timestamptz
     FROM call_a, jsonb_array_elements(result->'published_shifts') elem),
  (((SELECT mon FROM test_config) + 3)::timestamp + interval '9 hours') AT TIME ZONE 'America/Chicago',
  'a published moved shift carries its pre-cascade start time'
);

-- ============================================
-- Call B — drift opt-in
-- ============================================

CREATE TEMP TABLE call_b AS
SELECT public.update_shift_template_with_cascade(
  '7b000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-0000000ca001',
  'B Drift', 'Server', 'Cascade Test Zone B', '{1,2,3,4,5}'::int[], 30, 1,
  '10:00'::time, '18:00'::time, true,
  ARRAY['11000000-0000-0000-0000-0000000000b2', '11000000-0000-0000-0000-0000000000b3']::uuid[]
) AS result;

-- Test 8
SELECT is(
  (SELECT (start_time AT TIME ZONE 'America/Chicago')::time FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000b2'),
  '10:00'::time,
  'an opted-in drifted shift is moved onto the new template times'
);

-- Test 9
SELECT is(
  (SELECT (start_time AT TIME ZONE 'America/Chicago')::time FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000b1'),
  '10:00'::time,
  'the matching sibling still moves in the same call'
);

-- Test 10 -- b3 is drifted AND published. It was opted in like b2, but only
-- b3 is published, so it alone should appear in published_shifts: a
-- published drifted shift the manager opts in is exactly as visible to the
-- "already posted"/notify machinery as a published matching shift (a5 in
-- Call A), even though it never entered the `moving` bucket the way a5 did.
SELECT is(
  (SELECT jsonb_agg(elem->>'id') FROM call_b, jsonb_array_elements(result->'published_shifts') elem),
  '["11000000-0000-0000-0000-0000000000b3"]'::jsonb,
  'an opted-in drifted shift that is itself published appears in published_shifts'
);

-- Test 10b -- b3's pre-cascade start was 11:00, distinct from a5's 09:00
-- (Test 7b), so this is not just Test 7b passing by coincidence.
SELECT is(
  (SELECT (elem->>'previous_start_time')::timestamptz
     FROM call_b, jsonb_array_elements(result->'published_shifts') elem),
  (((SELECT mon FROM test_config) + 3)::timestamp + interval '11 hours') AT TIME ZONE 'America/Chicago',
  'a published opted-in drifted shift carries its pre-cascade start time'
);

-- Test 11 -- a1 belongs to template A, so it fails the shift_template_id
-- re-validation and is reported as skipped rather than silently retimed.
CREATE TEMP TABLE call_b_skip AS
SELECT public.update_shift_template_with_cascade(
  '7b000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-0000000ca001',
  'B Drift', 'Server', 'Cascade Test Zone B', '{1,2,3,4,5}'::int[], 30, 1,
  '10:00'::time, '18:00'::time, true,
  ARRAY['11000000-0000-0000-0000-0000000000a1']::uuid[]
) AS result;

SELECT is(
  (SELECT (result->>'skipped_count')::int FROM call_b_skip),
  1,
  'an opted-in id belonging to another template is re-validated away and counted as skipped'
);

-- ============================================
-- Call C — restaurant timezone is not the server's
-- ============================================

SELECT set_config('request.jwt.claims',
  '{"sub":"a11ce000-0000-0000-0000-0000000ca002","role":"authenticated"}', true);

SELECT public.update_shift_template_with_cascade(
  '7c000000-0000-0000-0000-00000000000c', 'c0000000-0000-0000-0000-0000000ca002',
  'C Tokyo', 'Server', NULL, '{1,2,3,4,5}'::int[], 30, 1,
  '10:00'::time, '18:00'::time, true, '{}'::uuid[]
);

-- Test 12
SELECT is(
  (SELECT (start_time AT TIME ZONE 'Asia/Tokyo')::time FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000c1'),
  '10:00'::time,
  'drift detection and the rewrite both use the restaurant wall clock, not UTC'
);

-- ============================================
-- Call D — midnight crossing
-- ============================================

SELECT set_config('request.jwt.claims',
  '{"sub":"a11ce000-0000-0000-0000-0000000ca001","role":"authenticated"}', true);

SELECT public.update_shift_template_with_cascade(
  '7d000000-0000-0000-0000-00000000000d', 'c0000000-0000-0000-0000-0000000ca001',
  'D Overnight', 'Server', NULL, '{1,2,3,4,5}'::int[], 30, 1,
  '23:00'::time, '03:00'::time, true, '{}'::uuid[]
);

-- Test 13
SELECT is(
  (SELECT (end_time AT TIME ZONE 'America/Chicago')::time FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000d1'),
  '03:00'::time,
  'overnight shift end lands on 03:00 local'
);

-- Test 14
SELECT is(
  (SELECT (end_time - start_time) FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000d1'),
  interval '4 hours',
  'overnight shift end is pushed to the NEXT local day, preserving the 4h length'
);

-- ============================================
-- Call E — p_cascade = false reproduces today's behaviour
-- ============================================

SELECT public.update_shift_template_with_cascade(
  '7e000000-0000-0000-0000-00000000000e', 'c0000000-0000-0000-0000-0000000ca001',
  'E NoCascade', 'Server', NULL, '{1,2,3,4,5}'::int[], 30, 1,
  '14:00'::time, '22:00'::time, false, '{}'::uuid[]
);

-- Test 15
SELECT is(
  (SELECT start_time FROM shift_templates WHERE id = '7e000000-0000-0000-0000-00000000000e'),
  '14:00'::time,
  'p_cascade = false still writes the template row'
);

-- Test 16
SELECT is(
  (SELECT (start_time AT TIME ZONE 'America/Chicago')::time FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000e1'),
  '09:00'::time,
  'p_cascade = false leaves every linked shift alone'
);

-- ============================================
-- Batch identity
-- ============================================

-- Test 17 -- selected by SHIFT, never by batch id. Filtering on
-- `cascade_batch_id = <call_a's id>` and then counting DISTINCT of that same
-- column returns 1 whenever any row matches, so it would pass just as well
-- against an RPC that minted a fresh id per row. a1 and a5 are the two shifts
-- Call A actually moved (Tests 1 and 5), and no later call tags them -- a1's
-- only other appearance is call_b_skip, where it is re-validated away without
-- a row written (Test 11). One distinct id across their tagged rows is
-- therefore the assertion a per-row id would fail.
SELECT is(
  (SELECT COUNT(DISTINCT cascade_batch_id)::int FROM schedule_change_logs
    WHERE cascade_batch_id IS NOT NULL
      AND shift_id IN ('11000000-0000-0000-0000-0000000000a1',
                       '11000000-0000-0000-0000-0000000000a5')),
  1,
  'one cascade call tags every row it wrote with a single batch id'
);

-- Test 18
SELECT isnt(
  (SELECT (result->>'batch_id')::uuid FROM call_a),
  (SELECT (result->>'batch_id')::uuid FROM call_b),
  'two cascade calls get distinct batch ids'
);

-- Test 19
SELECT is(
  (SELECT COUNT(*)::int FROM schedule_change_logs
    WHERE cascade_batch_id = (SELECT (result->>'batch_id')::uuid FROM call_a)),
  2,
  'the batch holds exactly one tagged row per moved shift'
);

-- ============================================
-- The log_shift_change trigger also fires on published shifts
-- ============================================

-- Test 20 -- a5 was published, so the AFTER UPDATE trigger wrote its own
-- untagged row on top of the RPC's tagged one. Two rows total, one tagged.
-- Documented so a reader counting rows does not conclude something broke.
SELECT is(
  (SELECT COUNT(*)::int FROM schedule_change_logs
    WHERE shift_id = '11000000-0000-0000-0000-0000000000a5'
      AND cascade_batch_id IS NULL),
  1,
  'log_shift_change writes one additional UNTAGGED row for the published shift'
);

-- ============================================
-- Authorization
-- ============================================

SELECT set_config('request.jwt.claims',
  '{"sub":"a11ce000-0000-0000-0000-0000000ca003","role":"authenticated"}', true);

-- Test 21
SELECT throws_ok(
  $$ SELECT public.update_shift_template_with_cascade(
       '7a000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000ca001',
       'A Baseline', 'Server', NULL, '{1,2,3,4,5}'::int[], 30, 1,
       '06:00'::time, '14:00'::time, true, '{}'::uuid[]) $$,
  '42501',
  NULL,
  'a member without edit:scheduling gets insufficient_privilege'
);

-- Cross-tenant: the Chicago owner names Chicago (so the capability guard
-- PASSES) but passes Tokyo's template and Tokyo's shift. Only the per-statement
-- restaurant_id scoping stops this.
SELECT set_config('request.jwt.claims',
  '{"sub":"a11ce000-0000-0000-0000-0000000ca001","role":"authenticated"}', true);

SELECT public.update_shift_template_with_cascade(
  '7c000000-0000-0000-0000-00000000000c', 'c0000000-0000-0000-0000-0000000ca001',
  'Hijacked', 'Server', NULL, '{1,2,3,4,5}'::int[], 30, 1,
  '05:00'::time, '13:00'::time, true,
  ARRAY['11000000-0000-0000-0000-0000000000c1']::uuid[]
);

-- Test 22
SELECT is(
  (SELECT (start_time AT TIME ZONE 'Asia/Tokyo')::time FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000c1'),
  '10:00'::time,
  'a caller authorized at restaurant A cannot retime restaurant B''s shifts'
);

-- Test 23
SELECT ok(
  NOT has_function_privilege('anon',
    'public.update_shift_template_with_cascade(uuid,uuid,text,text,text,integer[],integer,integer,time,time,boolean,uuid[])',
    'EXECUTE'),
  'anon cannot execute the cascade RPC'
);

-- ============================================
-- Undo
-- ============================================

SELECT set_config('request.jwt.claims',
  '{"sub":"a11ce000-0000-0000-0000-0000000ca001","role":"authenticated"}', true);

-- b1 and b2 were both moved to 10:00 by call B. Mutate b1 afterwards so undo
-- has one row it must refuse to restore and one it must restore.
UPDATE shifts
SET start_time = (((SELECT mon FROM test_config))::timestamp + interval '15 hours') AT TIME ZONE 'America/Chicago',
    end_time   = (((SELECT mon FROM test_config))::timestamp + interval '23 hours') AT TIME ZONE 'America/Chicago'
WHERE id = '11000000-0000-0000-0000-0000000000b1';

CREATE TEMP TABLE undo_b AS
SELECT public.undo_template_hours_cascade(
  (SELECT (result->>'batch_id')::uuid FROM call_b),
  'c0000000-0000-0000-0000-0000000ca001'
) AS result;

-- Test 24
SELECT is(
  (SELECT (start_time AT TIME ZONE 'America/Chicago')::time FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000b2'),
  '11:00'::time,
  'undo restores the opted-in drifted shift to its pre-cascade time'
);

-- Test 25
SELECT is(
  (SELECT (start_time AT TIME ZONE 'America/Chicago')::time FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000b1'),
  '15:00'::time,
  'undo refuses to overwrite a shift edited after the cascade'
);

-- Test 26
SELECT is(
  (SELECT (result->>'changed_since_count')::int FROM undo_b),
  1,
  'undo reports the changed-since skip rather than lumping it into restored'
);

-- Test 27 -- a NULL batch id must revert NOTHING. Plain `= p_batch_id` is
-- already NULL-safe on its own (NULL never equals anything, so a NULL
-- cascade_batch_id, or a NULL p_batch_id probing it, can never satisfy the
-- predicate); the early `IF p_batch_id IS NULL THEN RETURN` guard exists to
-- reject "no batch" as a valid revert target outright, not to prevent the
-- three queries below from matching rows they'd never match anyway.
SELECT is(
  (SELECT (result->>'restored_count')::int FROM (
    SELECT public.undo_template_hours_cascade(NULL, 'c0000000-0000-0000-0000-0000000ca001') AS result
  ) q),
  0,
  'a NULL batch id reverts nothing'
);

-- Test 28 -- cross-tenant: the Tokyo owner names Tokyo (capability guard
-- PASSES) but hands over Chicago's batch id.
SELECT set_config('request.jwt.claims',
  '{"sub":"a11ce000-0000-0000-0000-0000000ca002","role":"authenticated"}', true);

SELECT is(
  (SELECT (result->>'restored_count')::int FROM (
    SELECT public.undo_template_hours_cascade(
      (SELECT (result->>'batch_id')::uuid FROM call_a),
      'c0000000-0000-0000-0000-0000000ca002'
    ) AS result
  ) q),
  0,
  'a batch id from another restaurant reverts nothing'
);

-- Test 29/30 -- Undo is bound by the same two refusals as the cascade. Call A
-- moved a1 and a5; lock a1 afterwards, the way a manager would once they were
-- happy with it. Undo must leave the locked row exactly where the cascade put
-- it and report it under protected_count -- folding it into restored_count
-- would tell the manager a shift came back that never did, and rewriting it
-- would make `locked` mean nothing the moment a toast is on screen. Call A's
-- batch is still un-reverted here: Test 28 handed it to the Tokyo owner, who
-- was scoped out.
SELECT set_config('request.jwt.claims',
  '{"sub":"a11ce000-0000-0000-0000-0000000ca001","role":"authenticated"}', true);

UPDATE shifts SET locked = true WHERE id = '11000000-0000-0000-0000-0000000000a1';

CREATE TEMP TABLE undo_a AS
SELECT public.undo_template_hours_cascade(
  (SELECT (result->>'batch_id')::uuid FROM call_a),
  'c0000000-0000-0000-0000-0000000ca001'
) AS result;

-- Test 29
SELECT is(
  (SELECT (start_time AT TIME ZONE 'America/Chicago')::time FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000a1'),
  '10:00'::time,
  'undo refuses to restore a shift locked after the cascade'
);

-- Test 30
SELECT is(
  (SELECT (result->>'protected_count')::int FROM undo_a),
  1,
  'undo counts the locked shift under protected_count, not restored_count'
);

-- Test 31 -- the same call still restores everything it is allowed to, so a
-- single protected row does not sink the whole revert.
SELECT is(
  (SELECT (start_time AT TIME ZONE 'America/Chicago')::time FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000a5'),
  '09:00'::time,
  'undo still restores the eligible shifts in a batch that has a protected one'
);

-- ============================================
-- Undo restores the template's hours (Bug 1)
-- ============================================
--
-- Six fresh templates, each on its own singleton `days` value so none can
-- collide with each other or with A-E on uq_shift_templates_active_slot
-- (restaurant_id, position, start_time, end_time, days, area) regardless of
-- what hours a given call rewrites them to.

-- ---- Happy path: cascade, undo, recascade (Tests 35-38, 40-41) ----

INSERT INTO shift_templates (id, restaurant_id, name, days, start_time, end_time, break_duration, position, capacity, is_active, area) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'c0000000-0000-0000-0000-0000000ca001', 'Undo case', '{1,2}', '10:00', '16:30', 0, 'Server', 1, true, NULL)
ON CONFLICT (id) DO UPDATE
  SET restaurant_id = EXCLUDED.restaurant_id, days = EXCLUDED.days,
      start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, area = EXCLUDED.area;

INSERT INTO shifts (id, restaurant_id, employee_id, shift_template_id, start_time, end_time, position, locked, is_published)
SELECT * FROM (VALUES
  ('e1000000-0000-4000-8000-000000000011'::uuid, 'c0000000-0000-0000-0000-0000000ca001'::uuid, 'e0000000-0000-0000-0000-0000000ca001'::uuid, 'e1000000-0000-4000-8000-000000000001'::uuid,
   ((SELECT mon FROM test_config)::timestamp + interval '10 hours')                   AT TIME ZONE 'America/Chicago',
   ((SELECT mon FROM test_config)::timestamp + interval '16 hours 30 minutes')        AT TIME ZONE 'America/Chicago', 'Server', false, false),
  ('e1000000-0000-4000-8000-000000000012'::uuid, 'c0000000-0000-0000-0000-0000000ca001'::uuid, 'e0000000-0000-0000-0000-0000000ca001'::uuid, 'e1000000-0000-4000-8000-000000000001'::uuid,
   (((SELECT mon FROM test_config) + 1)::timestamp + interval '10 hours')             AT TIME ZONE 'America/Chicago',
   (((SELECT mon FROM test_config) + 1)::timestamp + interval '16 hours 30 minutes')  AT TIME ZONE 'America/Chicago', 'Server', false, false)
) AS v
ON CONFLICT (id) DO NOTHING;

-- Cascade: end 16:30 -> 17:30
CREATE TEMP TABLE undo_cascade_1 AS
SELECT public.update_shift_template_with_cascade(
  'e1000000-0000-4000-8000-000000000001', 'c0000000-0000-0000-0000-0000000ca001',
  'Undo case', 'Server', NULL, '{1,2}'::int[], 0, 1,
  '10:00'::time, '17:30'::time, true, '{}'::uuid[]
) AS result;

-- Test 35: a header row was written for this batch
SELECT is(
  (SELECT count(*)::int FROM template_hours_cascade_batches
   WHERE id = (SELECT (result->>'batch_id')::uuid FROM undo_cascade_1)),
  1,
  'cascade writes one batch header row'
);

-- Test 36: the header records the template hours from BEFORE the edit
SELECT results_eq(
  $q$SELECT before_start_time, before_end_time, after_start_time, after_end_time
     FROM template_hours_cascade_batches
     WHERE id = (SELECT (result->>'batch_id')::uuid FROM undo_cascade_1)$q$,
  $q$VALUES ('10:00'::time, '16:30'::time, '10:00'::time, '17:30'::time)$q$,
  'header records before and after template hours'
);

CREATE TEMP TABLE undo_result_1 AS
SELECT public.undo_template_hours_cascade(
  (SELECT (result->>'batch_id')::uuid FROM undo_cascade_1), 'c0000000-0000-0000-0000-0000000ca001'
) AS result;

-- Test 37: the template is back to its pre-cascade hours
SELECT results_eq(
  $q$SELECT start_time, end_time FROM shift_templates
     WHERE id = 'e1000000-0000-4000-8000-000000000001'$q$,
  $q$VALUES ('10:00'::time, '16:30'::time)$q$,
  'undo restores the template hours'
);

-- Test 38: and says so
SELECT results_eq(
  $q$SELECT (SELECT (result->>'template_restored')::boolean FROM undo_result_1),
            (SELECT (result->>'template_changed_since')::boolean FROM undo_result_1)$q$,
  $q$VALUES (true, false)$q$,
  'undo reports template_restored true and template_changed_since false on the happy path'
);

-- Test 39 -- legacy batch: a schedule_change_logs row tagged with a batch id
-- that has no header row (i.e. from before this migration). Undo must not
-- error, and both new flags come back false.
INSERT INTO schedule_change_logs (restaurant_id, shift_id, employee_id, change_type, changed_by, before_data, after_data, reason, cascade_batch_id)
VALUES (
  'c0000000-0000-0000-0000-0000000ca001', 'e1000000-0000-4000-8000-000000000011',
  'e0000000-0000-0000-0000-0000000ca001', 'updated', 'a11ce000-0000-0000-0000-0000000ca001',
  '{}'::jsonb, '{}'::jsonb, 'legacy batch (no header row)', 'f9000000-0000-4000-8000-000000000099'
);

CREATE TEMP TABLE undo_legacy AS
SELECT public.undo_template_hours_cascade(
  'f9000000-0000-4000-8000-000000000099', 'c0000000-0000-0000-0000-0000000ca001'
) AS result;

SELECT results_eq(
  $q$SELECT (SELECT (result->>'template_restored')::boolean FROM undo_legacy),
            (SELECT (result->>'template_changed_since')::boolean FROM undo_legacy)$q$,
  $q$VALUES (false, false)$q$,
  'a legacy batch with no header row reverts shifts as before and reports both new flags false'
);

-- Test 40: THE REPORTED BUG. A second cascade after the undo must move the shifts.
CREATE TEMP TABLE recascade_1 AS
SELECT public.update_shift_template_with_cascade(
  'e1000000-0000-4000-8000-000000000001', 'c0000000-0000-0000-0000-0000000ca001',
  'Undo case', 'Server', NULL, '{1,2}'::int[], 0, 1,
  '11:00'::time, '18:30'::time, true, '{}'::uuid[]
) AS result;

SELECT is(
  (SELECT (result->>'updated_count')::int FROM recascade_1),
  2,
  'a cascade after an undo still moves the shifts (the reported bug)'
);

-- Test 41: and the shifts really hold the new local hours
SELECT is(
  (SELECT count(*)::int FROM shifts
   WHERE shift_template_id = 'e1000000-0000-4000-8000-000000000001'
     AND (start_time AT TIME ZONE 'America/Chicago')::time = '11:00'
     AND (end_time   AT TIME ZONE 'America/Chicago')::time = '18:30'),
  2,
  'both shifts sit at the re-cascaded hours'
);

-- ---- Test 42: template changed since ----

INSERT INTO shift_templates (id, restaurant_id, name, days, start_time, end_time, break_duration, position, capacity, is_active, area) VALUES
  ('e1000000-0000-4000-8000-000000000002', 'c0000000-0000-0000-0000-0000000ca001', 'Changed since case', '{3}', '07:00', '15:00', 0, 'Server', 1, true, NULL)
ON CONFLICT (id) DO UPDATE
  SET restaurant_id = EXCLUDED.restaurant_id, days = EXCLUDED.days,
      start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, area = EXCLUDED.area;

INSERT INTO shifts (id, restaurant_id, employee_id, shift_template_id, start_time, end_time, position, locked, is_published)
SELECT * FROM (VALUES
  ('e1000000-0000-4000-8000-000000000021'::uuid, 'c0000000-0000-0000-0000-0000000ca001'::uuid, 'e0000000-0000-0000-0000-0000000ca001'::uuid, 'e1000000-0000-4000-8000-000000000002'::uuid,
   (((SELECT mon FROM test_config) + 2)::timestamp + interval '7 hours')  AT TIME ZONE 'America/Chicago',
   (((SELECT mon FROM test_config) + 2)::timestamp + interval '15 hours') AT TIME ZONE 'America/Chicago', 'Server', false, false)
) AS v
ON CONFLICT (id) DO NOTHING;

CREATE TEMP TABLE cascade_42 AS
SELECT public.update_shift_template_with_cascade(
  'e1000000-0000-4000-8000-000000000002', 'c0000000-0000-0000-0000-0000000ca001',
  'Changed since case', 'Server', NULL, '{3}'::int[], 0, 1,
  '10:00'::time, '18:00'::time, true, '{}'::uuid[]
) AS result;

-- A manager edits the template's hours by hand after the cascade, before
-- anyone clicks Undo.
UPDATE shift_templates SET start_time = '09:00'::time
WHERE id = 'e1000000-0000-4000-8000-000000000002';

CREATE TEMP TABLE undo_42 AS
SELECT public.undo_template_hours_cascade(
  (SELECT (result->>'batch_id')::uuid FROM cascade_42), 'c0000000-0000-0000-0000-0000000ca001'
) AS result;

SELECT results_eq(
  $q$SELECT (SELECT start_time FROM shift_templates WHERE id = 'e1000000-0000-4000-8000-000000000002'),
            (SELECT (result->>'template_restored')::boolean FROM undo_42),
            (SELECT (result->>'template_changed_since')::boolean FROM undo_42)$q$,
  $q$VALUES ('09:00'::time, false, true)$q$,
  'undo declines to restore a template hand-edited since the cascade, and reports template_changed_since'
);

-- ---- Test 43: template restored even when every shift is protected ----

INSERT INTO shift_templates (id, restaurant_id, name, days, start_time, end_time, break_duration, position, capacity, is_active, area) VALUES
  ('e1000000-0000-4000-8000-000000000003', 'c0000000-0000-0000-0000-0000000ca001', 'All-locked case', '{4}', '07:00', '15:00', 0, 'Server', 1, true, NULL)
ON CONFLICT (id) DO UPDATE
  SET restaurant_id = EXCLUDED.restaurant_id, days = EXCLUDED.days,
      start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, area = EXCLUDED.area;

INSERT INTO shifts (id, restaurant_id, employee_id, shift_template_id, start_time, end_time, position, locked, is_published)
SELECT * FROM (VALUES
  ('e1000000-0000-4000-8000-000000000031'::uuid, 'c0000000-0000-0000-0000-0000000ca001'::uuid, 'e0000000-0000-0000-0000-0000000ca001'::uuid, 'e1000000-0000-4000-8000-000000000003'::uuid,
   (((SELECT mon FROM test_config) + 3)::timestamp + interval '7 hours')  AT TIME ZONE 'America/Chicago',
   (((SELECT mon FROM test_config) + 3)::timestamp + interval '15 hours') AT TIME ZONE 'America/Chicago', 'Server', false, false)
) AS v
ON CONFLICT (id) DO NOTHING;

CREATE TEMP TABLE cascade_43 AS
SELECT public.update_shift_template_with_cascade(
  'e1000000-0000-4000-8000-000000000003', 'c0000000-0000-0000-0000-0000000ca001',
  'All-locked case', 'Server', NULL, '{4}'::int[], 0, 1,
  '08:00'::time, '16:00'::time, true, '{}'::uuid[]
) AS result;

-- The manager locks the shift after seeing it cascade, before clicking Undo.
UPDATE shifts SET locked = true WHERE id = 'e1000000-0000-4000-8000-000000000031';

CREATE TEMP TABLE undo_43 AS
SELECT public.undo_template_hours_cascade(
  (SELECT (result->>'batch_id')::uuid FROM cascade_43), 'c0000000-0000-0000-0000-0000000ca001'
) AS result;

SELECT results_eq(
  $q$SELECT (SELECT (result->>'restored_count')::int FROM undo_43),
            (SELECT (result->>'template_restored')::boolean FROM undo_43)$q$,
  $q$VALUES (0, true)$q$,
  'the template comes back even when every one of its shifts is protected'
);

-- ---- Test 44: no header when nothing moved ----

INSERT INTO shift_templates (id, restaurant_id, name, days, start_time, end_time, break_duration, position, capacity, is_active, area) VALUES
  ('e1000000-0000-4000-8000-000000000004', 'c0000000-0000-0000-0000-0000000ca001', 'Locked-only case', '{5}', '07:00', '15:00', 0, 'Server', 1, true, NULL)
ON CONFLICT (id) DO UPDATE
  SET restaurant_id = EXCLUDED.restaurant_id, days = EXCLUDED.days,
      start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, area = EXCLUDED.area;

-- Locked BEFORE the cascade call, so it never enters the `target` CTE at all.
INSERT INTO shifts (id, restaurant_id, employee_id, shift_template_id, start_time, end_time, position, locked, is_published)
SELECT * FROM (VALUES
  ('e1000000-0000-4000-8000-000000000041'::uuid, 'c0000000-0000-0000-0000-0000000ca001'::uuid, 'e0000000-0000-0000-0000-0000000ca001'::uuid, 'e1000000-0000-4000-8000-000000000004'::uuid,
   (((SELECT mon FROM test_config) + 4)::timestamp + interval '7 hours')  AT TIME ZONE 'America/Chicago',
   (((SELECT mon FROM test_config) + 4)::timestamp + interval '15 hours') AT TIME ZONE 'America/Chicago', 'Server', true, false)
) AS v
ON CONFLICT (id) DO NOTHING;

CREATE TEMP TABLE header_count_before_44 AS
SELECT count(*)::int AS n FROM template_hours_cascade_batches;

CREATE TEMP TABLE cascade_44 AS
SELECT public.update_shift_template_with_cascade(
  'e1000000-0000-4000-8000-000000000004', 'c0000000-0000-0000-0000-0000000ca001',
  'Locked-only case', 'Server', NULL, '{5}'::int[], 0, 1,
  '08:00'::time, '16:00'::time, true, '{}'::uuid[]
) AS result;

SELECT results_eq(
  $q$SELECT (SELECT (result->>'batch_id') FROM cascade_44),
            (SELECT count(*)::int FROM template_hours_cascade_batches)$q$,
  $q$SELECT (SELECT NULL::text), (SELECT n FROM header_count_before_44)$q$,
  'a cascade whose only linked shift is locked writes no batch header'
);

-- ---- Test 45: tenant isolation ----
--
-- recascade_1's batch belongs to restaurant A (Chicago). The Tokyo owner is
-- authorized at restaurant B (the capability guard passes), but hands over
-- Chicago's batch id -- the per-statement restaurant_id scoping must still
-- keep it out.
SELECT set_config('request.jwt.claims',
  '{"sub":"a11ce000-0000-0000-0000-0000000ca002","role":"authenticated"}', true);

CREATE TEMP TABLE undo_45 AS
SELECT public.undo_template_hours_cascade(
  (SELECT (result->>'batch_id')::uuid FROM recascade_1), 'c0000000-0000-0000-0000-0000000ca002'
) AS result;

SELECT results_eq(
  $q$SELECT (SELECT start_time FROM shift_templates WHERE id = 'e1000000-0000-4000-8000-000000000001'),
            (SELECT end_time   FROM shift_templates WHERE id = 'e1000000-0000-4000-8000-000000000001'),
            (SELECT (result->>'template_restored')::boolean FROM undo_45)$q$,
  $q$VALUES ('11:00'::time, '18:30'::time, false)$q$,
  'a batch id from another restaurant leaves restaurant A''s template untouched'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"a11ce000-0000-0000-0000-0000000ca001","role":"authenticated"}', true);

-- ---- Test 46: superseded batch ----

INSERT INTO shift_templates (id, restaurant_id, name, days, start_time, end_time, break_duration, position, capacity, is_active, area) VALUES
  ('e1000000-0000-4000-8000-000000000005', 'c0000000-0000-0000-0000-0000000ca001', 'Superseded case', '{6}', '07:00', '08:00', 0, 'Server', 1, true, NULL)
ON CONFLICT (id) DO UPDATE
  SET restaurant_id = EXCLUDED.restaurant_id, days = EXCLUDED.days,
      start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, area = EXCLUDED.area;

INSERT INTO shifts (id, restaurant_id, employee_id, shift_template_id, start_time, end_time, position, locked, is_published)
SELECT * FROM (VALUES
  ('e1000000-0000-4000-8000-000000000051'::uuid, 'c0000000-0000-0000-0000-0000000ca001'::uuid, 'e0000000-0000-0000-0000-0000000ca001'::uuid, 'e1000000-0000-4000-8000-000000000005'::uuid,
   (((SELECT mon FROM test_config) + 5)::timestamp + interval '7 hours') AT TIME ZONE 'America/Chicago',
   (((SELECT mon FROM test_config) + 5)::timestamp + interval '8 hours') AT TIME ZONE 'America/Chicago', 'Server', false, false)
) AS v
ON CONFLICT (id) DO NOTHING;

-- Cascade X: 07:00-08:00 -> 10:00-11:00
CREATE TEMP TABLE cascade_x_46 AS
SELECT public.update_shift_template_with_cascade(
  'e1000000-0000-4000-8000-000000000005', 'c0000000-0000-0000-0000-0000000ca001',
  'Superseded case', 'Server', NULL, '{6}'::int[], 0, 1,
  '10:00'::time, '11:00'::time, true, '{}'::uuid[]
) AS result;

-- Cascade Y, same template: 10:00-11:00 -> 11:00-12:00. The shift still
-- matches X's after-hours exactly, so Y moves it again.
CREATE TEMP TABLE cascade_y_46 AS
SELECT public.update_shift_template_with_cascade(
  'e1000000-0000-4000-8000-000000000005', 'c0000000-0000-0000-0000-0000000ca001',
  'Superseded case', 'Server', NULL, '{6}'::int[], 0, 1,
  '11:00'::time, '12:00'::time, true, '{}'::uuid[]
) AS result;

CREATE TEMP TABLE undo_x_46 AS
SELECT public.undo_template_hours_cascade(
  (SELECT (result->>'batch_id')::uuid FROM cascade_x_46), 'c0000000-0000-0000-0000-0000000ca001'
) AS result;

SELECT results_eq(
  $q$SELECT (SELECT end_time FROM shift_templates WHERE id = 'e1000000-0000-4000-8000-000000000005'),
            (SELECT (result->>'template_changed_since')::boolean FROM undo_x_46),
            (SELECT (result->>'changed_since_count')::int FROM undo_x_46)$q$,
  $q$VALUES ('12:00'::time, true, 1)$q$,
  'undoing a superseded batch leaves the newer cascade''s hours in place and reports changed_since'
);

SELECT * FROM finish();
ROLLBACK;
