-- pgTAP tests for the retraction audience snapshot
-- (supabase/migrations/20260802120000_schedule_retractions.sql).
--
-- Unpublishing a live week told nobody, because after the fact there is nothing
-- left to tell: unpublish_schedule flips is_published to false on every affected
-- row, erasing the only record of who was on the published version. So the
-- audience is captured inside the function's own transaction, from the UPDATE's
-- RETURNING clause, and these tests pin the three ways that capture can be wrong:
--
--   * the count regresses to the retraction INSERT's row count (the GET
--     DIAGNOSTICS trap once the UPDATE feeds a CTE),
--   * the audience includes people it must not — drafts, prior-week shifts — or
--     double-counts someone who worked twice that week,
--   * the routine double-unpublish aborts the transaction, because array_agg
--     over zero rows is NULL rather than '{}' and the column is NOT NULL.
--
-- The last three assertions are a different subject: neither this table nor
-- schedule_publications may be written by a client. A table with no UPDATE
-- policy does not RAISE on UPDATE — RLS silently filters it to zero rows, which
-- is exactly the mechanism that let notify-schedule-published believe it had
-- recorded notification_sent for a year. So they assert an affected-row count of
-- zero, not throws_ok.
--
-- Auth context follows publish_schedule_tz_bucketing.test.sql: the suite stays
-- as postgres and drives auth.uid() through request.jwt.claims, which is
-- role-independent. Only the closing RLS block switches role, after the last
-- ALTER TABLE.
--
-- No hardcoded calendar dates: the week is anchored to the next Monday after
-- CURRENT_DATE, and instants are built as `<local timestamp> AT TIME ZONE
-- '<iana>'` so the fixtures survive the CST/CDT transition.

BEGIN;

SELECT plan(21);

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
CREATE TEMP TABLE retraction_config AS
SELECT
  (CURRENT_DATE + (8 - EXTRACT(ISODOW FROM CURRENT_DATE)::int))     AS week_start,
  (CURRENT_DATE + (8 - EXTRACT(ISODOW FROM CURRENT_DATE)::int)) + 6 AS week_end;

-- auth.uid() source for retracted_by / changed_by.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES (
  'c0117000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'retraction-test@example.com',
  crypt('password123', gen_salt('bf')),
  now(), now(), now(), '', '', '', ''
)
ON CONFLICT (id) DO NOTHING;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"c0117000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

-- America/Chicago, so the Sunday-night closing shift below lands on the
-- following UTC day and the restaurant-local bucketing is actually exercised.
-- DO UPDATE, not DO NOTHING: a retained row from an earlier run carrying a
-- different zone would silently invalidate the week-edge assertion.
INSERT INTO restaurants (id, name, timezone) VALUES
  ('c0000000-0000-0000-0000-00000000a001', 'Retraction Test Restaurant', 'America/Chicago')
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, timezone = EXCLUDED.timezone;

INSERT INTO employees (id, restaurant_id, name, position) VALUES
  ('c0000000-0000-0000-0000-0000000000e1', 'c0000000-0000-0000-0000-00000000a001', 'Two Shift Server', 'Server'),
  ('c0000000-0000-0000-0000-0000000000e2', 'c0000000-0000-0000-0000-00000000a001', 'Closing Server',   'Server'),
  ('c0000000-0000-0000-0000-0000000000e3', 'c0000000-0000-0000-0000-00000000a001', 'Draft Only Cook',  'Cook')
ON CONFLICT (id) DO UPDATE
  SET restaurant_id = EXCLUDED.restaurant_id, name = EXCLUDED.name, position = EXCLUDED.position;

-- unpublish_schedule requires the caller to be a member of the target
-- restaurant; without this every call below fails with insufficient_privilege
-- before any audience capture is exercised.
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('c0117000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000a001', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- --- Shift fixtures ---
--
-- Published, in-week:
--   s1, s2  e1, two shifts    -> e1 must appear ONCE, not twice
--   s3      e2, Sun 22:00     -> in-week only under restaurant-local bucketing
-- Excluded:
--   s4      e3, draft         -> never announced, so never retracted
--   s6      e3, prior week    -> published, but belongs to the week before
--
-- There is deliberately no unassigned-shift fixture: shifts.employee_id is NOT
-- NULL, so the FILTER in the RPC has nothing to catch here and a test for it
-- would only assert the column constraint.

INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, is_published, locked)
SELECT
  'c0000000-0000-0000-0000-00000000f001',
  'c0000000-0000-0000-0000-00000000a001',
  'c0000000-0000-0000-0000-0000000000e1',
  (week_start::timestamp + interval '10 hours') AT TIME ZONE 'America/Chicago',
  (week_start::timestamp + interval '18 hours') AT TIME ZONE 'America/Chicago',
  'Server', true, true
FROM retraction_config;

INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, is_published, locked)
SELECT
  'c0000000-0000-0000-0000-00000000f002',
  'c0000000-0000-0000-0000-00000000a001',
  'c0000000-0000-0000-0000-0000000000e1',
  ((week_start + 1)::timestamp + interval '10 hours') AT TIME ZONE 'America/Chicago',
  ((week_start + 1)::timestamp + interval '18 hours') AT TIME ZONE 'America/Chicago',
  'Server', true, true
FROM retraction_config;

-- Sunday (week_end) 22:00 local -> 03:00 UTC the following Monday.
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, is_published, locked)
SELECT
  'c0000000-0000-0000-0000-00000000f003',
  'c0000000-0000-0000-0000-00000000a001',
  'c0000000-0000-0000-0000-0000000000e2',
  (week_end::timestamp + interval '22 hours') AT TIME ZONE 'America/Chicago',
  (week_end::timestamp + interval '26 hours') AT TIME ZONE 'America/Chicago',
  'Server', true, true
FROM retraction_config;

INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, is_published, locked)
SELECT
  'c0000000-0000-0000-0000-00000000f004',
  'c0000000-0000-0000-0000-00000000a001',
  'c0000000-0000-0000-0000-0000000000e3',
  ((week_start + 2)::timestamp + interval '10 hours') AT TIME ZONE 'America/Chicago',
  ((week_start + 2)::timestamp + interval '18 hours') AT TIME ZONE 'America/Chicago',
  'Cook', false, false
FROM retraction_config;

-- Sunday (week_start - 1) 22:00 local -> 03:00 UTC on week_start: previous week.
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, is_published, locked)
SELECT
  'c0000000-0000-0000-0000-00000000f006',
  'c0000000-0000-0000-0000-00000000a001',
  'c0000000-0000-0000-0000-0000000000e3',
  ((week_start - 1)::timestamp + interval '22 hours') AT TIME ZONE 'America/Chicago',
  ((week_start - 1)::timestamp + interval '26 hours') AT TIME ZONE 'America/Chicago',
  'Cook', true, true
FROM retraction_config;

-- Two publications for the same week: republishing appends rather than
-- replaces, so the retraction must link the LATEST one, not an arbitrary row.
INSERT INTO schedule_publications
  (id, restaurant_id, week_start_date, week_end_date, published_by, published_at, shift_count, notification_sent)
SELECT
  'c0000000-0000-0000-0000-00000000b001',
  'c0000000-0000-0000-0000-00000000a001',
  week_start, week_end,
  'c0117000-0000-0000-0000-000000000001',
  now(), 3, true
FROM retraction_config;

INSERT INTO schedule_publications
  (id, restaurant_id, week_start_date, week_end_date, published_by, published_at, shift_count, notification_sent)
SELECT
  'c0000000-0000-0000-0000-00000000b000',
  'c0000000-0000-0000-0000-00000000a001',
  week_start, week_end,
  'c0117000-0000-0000-0000-000000000001',
  now() - interval '2 days', 3, true
FROM retraction_config;

-- ============================================
-- Structure
-- ============================================

-- Test 1
SELECT has_table('public', 'schedule_retractions', 'schedule_retractions table exists');

-- Test 2
SELECT ok(
  (SELECT relrowsecurity FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'schedule_retractions'),
  'schedule_retractions has RLS enabled'
);

-- Test 3 -- a client-writable employee_ids would let a manager choose who gets
-- mailed; a client-writable notified_at would let one suppress the notice.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'schedule_retractions'
      AND cmd IN ('UPDATE', 'INSERT', 'DELETE', 'ALL')),
  0,
  'schedule_retractions has no client write policy'
);

-- Test 4 -- the shape that caused the original bug, pinned so a later migration
-- cannot "helpfully" add the UPDATE policy the edge function seemed to want.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'schedule_publications'
      AND cmd IN ('UPDATE', 'ALL')),
  0,
  'schedule_publications still has no UPDATE policy'
);

-- ============================================
-- Audience capture
-- ============================================

CREATE TEMP TABLE retraction_result AS
SELECT unpublish_schedule(
  'c0000000-0000-0000-0000-00000000a001',
  (SELECT week_start FROM retraction_config),
  (SELECT week_end   FROM retraction_config),
  'coverage gap'
) AS unpublished_count;

-- Test 5 -- s1, s2 and s3. A 1 here means GET DIAGNOSTICS crept back in and is
-- reporting the retraction INSERT's row count instead of the UPDATE's.
SELECT is(
  (SELECT unpublished_count FROM retraction_result),
  3,
  'unpublish_schedule returns the shift count, not the retraction INSERT count'
);

-- Test 6
SELECT is(
  (SELECT count(*)::int FROM schedule_retractions
    WHERE restaurant_id = 'c0000000-0000-0000-0000-00000000a001'),
  1,
  'one retraction row recorded'
);

-- Test 7
SELECT is(
  (SELECT shift_count FROM schedule_retractions
    WHERE restaurant_id = 'c0000000-0000-0000-0000-00000000a001'),
  3,
  'the retraction records the same shift count the RPC returned'
);

-- Test 8 -- e1 holds two of the three retracted shifts, so a missing DISTINCT
-- gives 3 here.
SELECT is(
  (SELECT array_length(employee_ids, 1) FROM schedule_retractions
    WHERE restaurant_id = 'c0000000-0000-0000-0000-00000000a001'),
  2,
  'the audience is deduped rather than one entry per retracted shift'
);

-- Test 9
SELECT ok(
  (SELECT employee_ids @> ARRAY[
            'c0000000-0000-0000-0000-0000000000e1'::uuid,
            'c0000000-0000-0000-0000-0000000000e2'::uuid]
     FROM schedule_retractions
    WHERE restaurant_id = 'c0000000-0000-0000-0000-00000000a001'),
  'the audience contains both employees who had published shifts, including the week-edge closer'
);

-- Test 10 -- e3 had only a draft this week and a published shift LAST week.
-- Mailing them "your schedule was taken down" would be the notification bug
-- inverted: a retraction notice for a schedule they were never promised.
SELECT ok(
  (SELECT NOT (employee_ids @> ARRAY['c0000000-0000-0000-0000-0000000000e3'::uuid])
     FROM schedule_retractions
    WHERE restaurant_id = 'c0000000-0000-0000-0000-00000000a001'),
  'the audience excludes an employee with only a draft and a prior-week shift'
);

-- Test 11
SELECT is(
  (SELECT publication_id FROM schedule_retractions
    WHERE restaurant_id = 'c0000000-0000-0000-0000-00000000a001'),
  'c0000000-0000-0000-0000-00000000b001'::uuid,
  'the retraction links the most recent publication for the week'
);

-- Test 12
SELECT is(
  (SELECT retracted_by FROM schedule_retractions
    WHERE restaurant_id = 'c0000000-0000-0000-0000-00000000a001'),
  'c0117000-0000-0000-0000-000000000001'::uuid,
  'the retraction records who retracted it'
);

-- Test 13 -- ok() rather than is(), since an untyped NULL comparand is ambiguous
-- for pgTAP's polymorphic is().
SELECT ok(
  (SELECT notified_at IS NULL FROM schedule_retractions
    WHERE restaurant_id = 'c0000000-0000-0000-0000-00000000a001'),
  'the retraction starts unnotified so the notifier can claim it'
);

-- Test 14 -- the prior-week shift is untouched, so test 10 is a real exclusion
-- rather than an employee who simply had nothing published anywhere.
SELECT is(
  (SELECT is_published FROM shifts
    WHERE id = 'c0000000-0000-0000-0000-00000000f006'
      AND restaurant_id = 'c0000000-0000-0000-0000-00000000a001'),
  true,
  'the prior-week Sun 22:00 shift is left published'
);

-- ============================================
-- The routine no-op
-- ============================================
--
-- Unpublishing a week with nothing published is a double-tap, not an error.
-- Without the COALESCE, array_agg over zero rows returns NULL and the NOT NULL
-- employee_ids column aborts the whole transaction; without the count guard, an
-- empty retraction row leaves the notifier an audience of nobody to special-case.

CREATE TEMP TABLE second_retraction_result AS
SELECT unpublish_schedule(
  'c0000000-0000-0000-0000-00000000a001',
  (SELECT week_start FROM retraction_config),
  (SELECT week_end   FROM retraction_config),
  NULL
) AS unpublished_count;

-- Test 15
SELECT is(
  (SELECT unpublished_count FROM second_retraction_result),
  0,
  'unpublishing a week with nothing published returns 0 and does not raise'
);

-- Test 16
SELECT is(
  (SELECT count(*)::int FROM schedule_retractions
    WHERE restaurant_id = 'c0000000-0000-0000-0000-00000000a001'),
  1,
  'a no-op unpublish records no second retraction'
);

-- ============================================
-- Neither table is client-writable
-- ============================================
--
-- Re-enable RLS and drop to `authenticated` — this must be the last block in the
-- file, since ALTER TABLE is not available to that role. The caller is a genuine
-- member of the restaurant and can SELECT both rows, so a passing assertion here
-- is about the write path and nothing else.
--
-- The two tables are blocked by different mechanisms, and the assertions differ
-- to match. schedule_publications grants UPDATE to `authenticated` and relies on
-- the absent policy, which silently filters to zero rows rather than raising --
-- that silence is precisely what let the original bug run undetected in
-- production for months. schedule_retractions grants no UPDATE at all, so it
-- raises 42501 before RLS is consulted.

ALTER TABLE schedule_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_retractions  ENABLE ROW LEVEL SECURITY;

SET LOCAL role TO authenticated;

-- Test 17 -- without this, tests 18 and 19 would also pass if `authenticated`
-- simply lacked the table grant, which is a different (and unpinned) reason.
SELECT ok(
  has_table_privilege('authenticated', 'public.schedule_publications', 'UPDATE'),
  'authenticated holds the table-level UPDATE grant, so RLS is what stops the write'
);

-- Test 18 -- THE ORIGINAL BUG. notify-schedule-published issued exactly this
-- write with a user-scoped client and never checked the result, so every
-- publication row in production still reads notification_sent = false.
WITH attempted AS (
  UPDATE schedule_publications
  SET notification_sent = true
  WHERE id = 'c0000000-0000-0000-0000-00000000b001'
    AND restaurant_id = 'c0000000-0000-0000-0000-00000000a001'
  RETURNING 1
)
SELECT is(
  (SELECT count(*)::int FROM attempted),
  0,
  'an authenticated client cannot UPDATE schedule_publications.notification_sent'
);

-- Test 19 -- the SELECT policy on schedule_retractions is only live because the
-- migration grants SELECT explicitly; default privileges in this database give
-- new public tables no DML at all. Without this the policy would be dead code
-- and test 20 would pass for the wrong reason.
SELECT is(
  (SELECT count(*)::int FROM schedule_retractions
    WHERE restaurant_id = 'c0000000-0000-0000-0000-00000000a001'),
  1,
  'a member of the restaurant can read its retraction'
);

-- Test 20 -- the other half of test 19, and the half that actually matters.
-- "A member can read it" passes just as happily under a policy of USING (true);
-- only a non-member coming back empty proves the tenant scope is real. The
-- audience snapshot is a roster of employee ids, so a leak here is a leak of
-- who works at somebody else's restaurant.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"c0117000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

SELECT is(
  (SELECT count(*)::int FROM schedule_retractions
    WHERE restaurant_id = 'c0000000-0000-0000-0000-00000000a001'),
  0,
  'a user with no user_restaurants row cannot read the restaurant''s retractions'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"c0117000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

-- Test 21
SELECT throws_ok(
  $$ UPDATE schedule_retractions SET notified_at = now()
       WHERE restaurant_id = 'c0000000-0000-0000-0000-00000000a001' $$,
  '42501',
  NULL,
  'an authenticated client cannot claim a retraction by setting notified_at'
);

SET LOCAL role TO postgres;

SELECT * FROM finish();
ROLLBACK;
