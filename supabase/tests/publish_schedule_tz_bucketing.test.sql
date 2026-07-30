-- pgTAP tests for timezone-aware week bucketing in publish_schedule /
-- unpublish_schedule (supabase/migrations/20260729120000_publish_schedule_tz_bucketing.sql).
--
-- Both functions used to select shifts with a bare `start_time::date`, which
-- casts a timestamptz using the DATABASE SESSION TimeZone (UTC on Supabase)
-- rather than the restaurant's IANA zone. For a restaurant behind UTC, a 22:00
-- local closing shift already falls on the next UTC calendar day, so it landed
-- on the wrong side of p_week_start / p_week_end.
--
-- The two edge cases below are what make this suite non-vacuous:
--   * upper edge — Sunday (week_end) 22:00 America/Chicago = 03:00 UTC the
--     following Monday. The old code EXCLUDED it; it must be published.
--   * lower edge — Sunday (week_start - 1) 22:00 America/Chicago = 03:00 UTC on
--     week_start. The old code INCLUDED it; it belongs to the previous week and
--     must be left alone.
-- A "fix" that only widened the upper bound still fails the lower edge.
--
-- Auth context: publish_schedule writes auth.uid() into the NOT NULL column
-- schedule_publications.published_by, unpublish_schedule writes it into
-- schedule_change_logs.changed_by, and the log_shift_change trigger does the
-- same on every update to an already-published shift. Run as bare postgres,
-- auth.uid() is NULL and all three violate NOT NULL before any bucketing is
-- exercised. set_config('request.jwt.claims', ...) is what auth.uid() reads and
-- is role-independent, so the suite stays as postgres throughout and never
-- needs to re-enable RLS mid-file.
--
-- No hardcoded calendar dates: the week is anchored to the next Monday after
-- CURRENT_DATE. Instants are built as `<local timestamp> AT TIME ZONE '<iana>'`
-- rather than with a literal UTC offset, so the fixtures stay correct across
-- the CST/CDT and any other DST transition.

BEGIN;

SELECT plan(19);

-- ============================================
-- Setup
-- ============================================

SET LOCAL role TO postgres;
ALTER TABLE restaurants            DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees              DISABLE ROW LEVEL SECURITY;
ALTER TABLE shifts                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_publications  DISABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_change_logs   DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants       DISABLE ROW LEVEL SECURITY;

-- Next Monday from today. ISODOW: Monday = 1 ... Sunday = 7, so 8 - ISODOW is
-- always in [1, 7] and never resolves to today.
CREATE TEMP TABLE test_config AS
SELECT
  (CURRENT_DATE + (8 - EXTRACT(ISODOW FROM CURRENT_DATE)::int))     AS week_start,
  (CURRENT_DATE + (8 - EXTRACT(ISODOW FROM CURRENT_DATE)::int)) + 6 AS week_end;

-- auth.uid() source for published_by / changed_by.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES (
  'a11ce000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'publish-tz-test@example.com',
  crypt('password123', gen_salt('bf')),
  now(), now(), now(), '', '', '', ''
)
ON CONFLICT (id) DO NOTHING;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"a11ce000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

-- Three restaurants: behind UTC, ahead of UTC, and one with a garbage IANA
-- string to exercise the invalid_parameter_value fallback.
-- DO UPDATE, not DO NOTHING: these are fixed IDs, and the timezone is the whole
-- subject of this suite. A retained row from an earlier run with a different
-- zone would silently invalidate every bucketing assertion below.
INSERT INTO restaurants (id, name, timezone) VALUES
  ('a0000000-0000-0000-0000-00000000c001', 'Chicago Test Restaurant', 'America/Chicago'),
  ('a0000000-0000-0000-0000-00000000d002', 'Tokyo Test Restaurant',   'Asia/Tokyo'),
  ('a0000000-0000-0000-0000-00000000e003', 'Bad TZ Test Restaurant',  'Not/AZone')
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, timezone = EXCLUDED.timezone;

INSERT INTO employees (id, restaurant_id, name, position) VALUES
  ('e0000000-0000-0000-0000-00000000c001', 'a0000000-0000-0000-0000-00000000c001', 'Chicago Server', 'Server'),
  ('e0000000-0000-0000-0000-00000000d002', 'a0000000-0000-0000-0000-00000000d002', 'Tokyo Server',   'Server'),
  ('e0000000-0000-0000-0000-00000000e003', 'a0000000-0000-0000-0000-00000000e003', 'Bad TZ Server',  'Server')
ON CONFLICT (id) DO UPDATE
  SET restaurant_id = EXCLUDED.restaurant_id, name = EXCLUDED.name, position = EXCLUDED.position;

-- publish_schedule / unpublish_schedule now require the caller to be a member of
-- the target restaurant. Without these rows every publish below fails with
-- insufficient_privilege before any bucketing is exercised.
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('a11ce000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000c001', 'owner'),
  ('a11ce000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000d002', 'owner'),
  ('a11ce000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000e003', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- A second authenticated user who is a member of NOTHING, for the cross-tenant
-- denial assertions at the end of the file.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES (
  'b22de000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'publish-tz-outsider@example.com',
  crypt('password123', gen_salt('bf')),
  now(), now(), now(), '', '', '', ''
)
ON CONFLICT (id) DO NOTHING;

-- --- America/Chicago fixtures (UTC-5 / UTC-6) ---

-- Control: Monday (week_start) 10:00 local. Unambiguous in every zone.
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position)
SELECT
  'f0000000-0000-0000-0000-0000000c0001',
  'a0000000-0000-0000-0000-00000000c001',
  'e0000000-0000-0000-0000-00000000c001',
  (week_start::timestamp + interval '10 hours') AT TIME ZONE 'America/Chicago',
  (week_start::timestamp + interval '18 hours') AT TIME ZONE 'America/Chicago',
  'Server'
FROM test_config;

-- Upper edge: Sunday (week_end) 22:00 local -> 03:00 UTC the following Monday.
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position)
SELECT
  'f0000000-0000-0000-0000-0000000c0002',
  'a0000000-0000-0000-0000-00000000c001',
  'e0000000-0000-0000-0000-00000000c001',
  (week_end::timestamp + interval '22 hours') AT TIME ZONE 'America/Chicago',
  (week_end::timestamp + interval '26 hours') AT TIME ZONE 'America/Chicago',
  'Server'
FROM test_config;

-- Lower edge: Sunday (week_start - 1) 22:00 local -> 03:00 UTC on week_start.
-- Belongs to the PREVIOUS week.
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position)
SELECT
  'f0000000-0000-0000-0000-0000000c0003',
  'a0000000-0000-0000-0000-00000000c001',
  'e0000000-0000-0000-0000-00000000c001',
  ((week_start - 1)::timestamp + interval '22 hours') AT TIME ZONE 'America/Chicago',
  ((week_start - 1)::timestamp + interval '26 hours') AT TIME ZONE 'America/Chicago',
  'Server'
FROM test_config;

-- --- Asia/Tokyo fixtures (UTC+9) — the mirror-image slip ---

-- In-week: Monday (week_start) 06:00 JST -> 21:00 UTC the PREVIOUS Sunday.
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position)
SELECT
  'f0000000-0000-0000-0000-0000000d0001',
  'a0000000-0000-0000-0000-00000000d002',
  'e0000000-0000-0000-0000-00000000d002',
  (week_start::timestamp + interval '6 hours')  AT TIME ZONE 'Asia/Tokyo',
  (week_start::timestamp + interval '14 hours') AT TIME ZONE 'Asia/Tokyo',
  'Server'
FROM test_config;

-- Out-of-week: Monday (week_end + 1) 06:00 JST -> 21:00 UTC on week_end.
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position)
SELECT
  'f0000000-0000-0000-0000-0000000d0002',
  'a0000000-0000-0000-0000-00000000d002',
  'e0000000-0000-0000-0000-00000000d002',
  ((week_end + 1)::timestamp + interval '6 hours')  AT TIME ZONE 'Asia/Tokyo',
  ((week_end + 1)::timestamp + interval '14 hours') AT TIME ZONE 'Asia/Tokyo',
  'Server'
FROM test_config;

-- --- Invalid-IANA fixture: must behave as if UTC ---

INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position)
SELECT
  'f0000000-0000-0000-0000-0000000e0001',
  'a0000000-0000-0000-0000-00000000e003',
  'e0000000-0000-0000-0000-00000000e003',
  (week_start::timestamp + interval '10 hours') AT TIME ZONE 'UTC',
  (week_start::timestamp + interval '18 hours') AT TIME ZONE 'UTC',
  'Server'
FROM test_config;

-- ============================================
-- publish_schedule, America/Chicago
-- ============================================

CREATE TEMP TABLE chicago_publication AS
SELECT publish_schedule(
  'a0000000-0000-0000-0000-00000000c001',
  (SELECT week_start FROM test_config),
  (SELECT week_end   FROM test_config),
  'tz bucketing test'
) AS publication_id;

-- Test 1
SELECT is(
  (SELECT is_published FROM shifts WHERE id = 'f0000000-0000-0000-0000-0000000c0001'),
  true,
  'control shift (Mon 10:00 America/Chicago) is published'
);

-- Test 2 — the upper edge the old UTC bucketing dropped
SELECT is(
  (SELECT is_published FROM shifts WHERE id = 'f0000000-0000-0000-0000-0000000c0002'),
  true,
  'Sun 22:00 America/Chicago on week_end is published (03:00 UTC next Monday)'
);

-- Test 3 — the lower edge the old UTC bucketing swept in
SELECT is(
  (SELECT is_published FROM shifts WHERE id = 'f0000000-0000-0000-0000-0000000c0003'),
  false,
  'Sun 22:00 America/Chicago before week_start is NOT published (belongs to prior week)'
);

-- Test 4
SELECT is(
  (SELECT shift_count FROM schedule_publications
   WHERE id = (SELECT publication_id FROM chicago_publication)),
  2,
  'schedule_publications.shift_count counts exactly the two in-week shifts'
);

-- ============================================
-- unpublish_schedule, America/Chicago
-- ============================================

-- Mark the lower-edge shift published directly, so unpublish_schedule has
-- something out-of-week it could wrongly clear. OLD.is_published is false here,
-- so log_shift_change short-circuits and writes no audit row.
UPDATE shifts
SET is_published = true, locked = true, published_at = NOW(),
    published_by = 'a11ce000-0000-0000-0000-000000000001'
WHERE id = 'f0000000-0000-0000-0000-0000000c0003';

CREATE TEMP TABLE chicago_unpublish AS
SELECT unpublish_schedule(
  'a0000000-0000-0000-0000-00000000c001',
  (SELECT week_start FROM test_config),
  (SELECT week_end   FROM test_config),
  'tz bucketing test'
) AS unpublished_count;

-- Test 5
SELECT is(
  (SELECT is_published FROM shifts WHERE id = 'f0000000-0000-0000-0000-0000000c0002'),
  false,
  'unpublish clears the Sun 22:00 week_end shift it published'
);

-- Test 6
SELECT is(
  (SELECT is_published FROM shifts WHERE id = 'f0000000-0000-0000-0000-0000000c0003'),
  true,
  'unpublish leaves the prior-week Sun 22:00 shift alone'
);

-- Test 7
SELECT is(
  (SELECT unpublished_count FROM chicago_unpublish),
  2,
  'unpublish_schedule returns 2 (control + week_end closing shift)'
);

-- ============================================
-- publish_schedule, Asia/Tokyo — the mirror image
-- ============================================

SELECT publish_schedule(
  'a0000000-0000-0000-0000-00000000d002',
  (SELECT week_start FROM test_config),
  (SELECT week_end   FROM test_config),
  'tz bucketing test'
);

-- Test 8
SELECT is(
  (SELECT is_published FROM shifts WHERE id = 'f0000000-0000-0000-0000-0000000d0001'),
  true,
  'Mon 06:00 Asia/Tokyo on week_start is published (21:00 UTC previous Sunday)'
);

-- Test 9
SELECT is(
  (SELECT is_published FROM shifts WHERE id = 'f0000000-0000-0000-0000-0000000d0002'),
  false,
  'Mon 06:00 Asia/Tokyo after week_end is NOT published (21:00 UTC on week_end)'
);

-- ============================================
-- Invalid IANA zone falls back to UTC instead of raising
-- ============================================

CREATE TEMP TABLE badtz_publication AS
SELECT publish_schedule(
  'a0000000-0000-0000-0000-00000000e003',
  (SELECT week_start FROM test_config),
  (SELECT week_end   FROM test_config),
  'tz bucketing test'
) AS publication_id;

-- Test 10 -- ok(), not isnt(): an untyped NULL comparand is ambiguous for
-- pgTAP's polymorphic isnt().
SELECT ok(
  (SELECT publication_id FROM badtz_publication) IS NOT NULL,
  'publish_schedule succeeds for a restaurant with an invalid IANA timezone'
);

-- Test 11
SELECT is(
  (SELECT is_published FROM shifts WHERE id = 'f0000000-0000-0000-0000-0000000e0001'),
  true,
  'invalid timezone buckets as UTC rather than raising'
);

-- ============================================
-- EXECUTE privilege boundary
-- ============================================

-- Test 12
SELECT is(
  has_function_privilege('anon', 'public.publish_schedule(uuid,date,date,text)', 'EXECUTE'),
  false,
  'anon cannot execute publish_schedule'
);

-- Test 13
SELECT is(
  has_function_privilege('anon', 'public.unpublish_schedule(uuid,date,date,text)', 'EXECUTE'),
  false,
  'anon cannot execute unpublish_schedule'
);

-- Test 14
SELECT is(
  has_function_privilege('authenticated', 'public.publish_schedule(uuid,date,date,text)', 'EXECUTE'),
  true,
  'authenticated can execute publish_schedule'
);

-- Test 15
SELECT is(
  has_function_privilege('authenticated', 'public.unpublish_schedule(uuid,date,date,text)', 'EXECUTE'),
  true,
  'authenticated can execute unpublish_schedule'
);

-- ============================================
-- Cross-tenant authorization
-- ============================================
--
-- Both functions are SECURITY DEFINER and so bypass RLS on shifts. The EXECUTE
-- grants above stop `anon`, but every authenticated user shares the same
-- `authenticated` role — the grant cannot distinguish tenants. Only the
-- in-function membership check can, which is what these four assertions pin.
--
-- Tokyo is the target for the unpublish attempt because test 8 left
-- f...d0001 published: a successful cross-tenant call would be visibly
-- destructive, so "still published" is a real unchanged-state assertion rather
-- than a vacuous one.

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"b22de000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

-- Test 16
SELECT throws_ok(
  $$ SELECT publish_schedule(
       'a0000000-0000-0000-0000-00000000c001',
       (SELECT week_start FROM test_config),
       (SELECT week_end   FROM test_config),
       'cross-tenant attempt'
     ) $$,
  '42501',
  NULL,
  'a non-member authenticated caller cannot publish another restaurant''s week'
);

-- Test 17
SELECT throws_ok(
  $$ SELECT unpublish_schedule(
       'a0000000-0000-0000-0000-00000000d002',
       (SELECT week_start FROM test_config),
       (SELECT week_end   FROM test_config),
       'cross-tenant attempt'
     ) $$,
  '42501',
  NULL,
  'a non-member authenticated caller cannot unpublish another restaurant''s week'
);

-- Test 18
SELECT is(
  (SELECT is_published FROM shifts WHERE id = 'f0000000-0000-0000-0000-0000000d0001'),
  true,
  'the denied unpublish left the target restaurant''s published shift untouched'
);

-- Test 19 -- exactly the one publication from the Chicago block; the denied
-- publish must not have inserted a second.
SELECT is(
  (SELECT COUNT(*)::int FROM schedule_publications
    WHERE restaurant_id = 'a0000000-0000-0000-0000-00000000c001'),
  1,
  'the denied publish recorded no schedule_publications row'
);

SELECT * FROM finish();
ROLLBACK;
