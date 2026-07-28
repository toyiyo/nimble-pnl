-- pgTAP tests for the schedule_publications week-range invariant.
--
-- A correct Mon..Sun (6-day) span inserts; the Mon..Mon (7-day) spill raises.
-- The guard is a pair of triggers rather than a CHECK constraint precisely so
-- that non-date updates to the 44 pre-existing 8-day rows keep working — tests
-- 5 and 6 below are that regression, and they are the reason for the mechanism.
--
-- Note: schedule_publications.published_by is NOT NULL with a FK to
-- auth.users(id), so both inserts below reference a dedicated auth.users row
-- instead of a NULL literal, mirroring the established fixture pattern (see
-- open_shifts_capacity_one.test.sql's "Auth user for FK references" comment).

BEGIN;

SELECT plan(7);

SET LOCAL role TO postgres;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_publications DISABLE ROW LEVEL SECURITY;

INSERT INTO restaurants (id, name)
VALUES ('dddddddd-2222-0000-0000-000000000001', 'Week Range Test Restaurant')
ON CONFLICT (id) DO NOTHING;

-- Auth user for FK reference (schedule_publications.published_by is NOT NULL)
INSERT INTO auth.users (id, email)
VALUES ('dddddddd-2222-0000-0000-000000000099', 'week-range-test@example.com')
ON CONFLICT DO NOTHING;

-- Test 1: the insert trigger exists
SELECT has_trigger(
  'public',
  'schedule_publications',
  'schedule_publications_week_range_insert',
  'the week-range insert trigger exists'
);

-- Test 2: the update trigger exists
SELECT has_trigger(
  'public',
  'schedule_publications',
  'schedule_publications_week_range_update',
  'the week-range update trigger exists'
);

-- Test 3: a correct Mon..Sun span is accepted
SELECT lives_ok(
  $$
    INSERT INTO schedule_publications
      (restaurant_id, week_start_date, week_end_date, published_by)
    VALUES
      ('dddddddd-2222-0000-0000-000000000001', DATE '2026-07-27', DATE '2026-08-02', 'dddddddd-2222-0000-0000-000000000099')
  $$,
  'a 6-day Mon..Sun span is accepted'
);

-- Test 4: the Mon..Mon spill is rejected
SELECT throws_ok(
  $$
    INSERT INTO schedule_publications
      (restaurant_id, week_start_date, week_end_date, published_by)
    VALUES
      ('dddddddd-2222-0000-0000-000000000001', DATE '2026-07-27', DATE '2026-08-03', 'dddddddd-2222-0000-0000-000000000099')
  $$,
  '23514',
  NULL,
  'the 8-day Mon..Mon spill is rejected on insert'
);

-- Seed a legacy 8-day row, the shape all 44 production rows already have. The
-- insert trigger is what stops it, so drop out of its way to plant the fixture.
ALTER TABLE schedule_publications DISABLE TRIGGER schedule_publications_week_range_insert;
INSERT INTO schedule_publications
  (id, restaurant_id, week_start_date, week_end_date, published_by)
VALUES
  ('dddddddd-2222-0000-0000-0000000000aa', 'dddddddd-2222-0000-0000-000000000001', DATE '2026-07-20', DATE '2026-07-27', 'dddddddd-2222-0000-0000-000000000099');
ALTER TABLE schedule_publications ENABLE TRIGGER schedule_publications_week_range_insert;

-- Test 5: THE REGRESSION. broadcast-open-shifts stamps only these two columns
-- when a manager re-broadcasts open shifts for an already-published week. A
-- CHECK constraint — even NOT VALID — would reject this on every legacy row.
SELECT lives_ok(
  $$
    UPDATE schedule_publications
    SET open_shifts_broadcast_at = NOW(),
        open_shifts_broadcast_by = 'dddddddd-2222-0000-0000-000000000099'
    WHERE id = 'dddddddd-2222-0000-0000-0000000000aa'
  $$,
  'a broadcast-columns-only update still succeeds on a legacy 8-day row'
);

-- Test 6: but moving the dates on that same row into a bad span is rejected
SELECT throws_ok(
  $$
    UPDATE schedule_publications
    SET week_end_date = DATE '2026-07-28'
    WHERE id = 'dddddddd-2222-0000-0000-0000000000aa'
  $$,
  '23514',
  NULL,
  'an update that widens the span past 6 days is rejected'
);

-- Test 7: and repairing a legacy row to a correct span is still allowed, so a
-- backfill remains possible later without dropping the guard
SELECT lives_ok(
  $$
    UPDATE schedule_publications
    SET week_end_date = DATE '2026-07-26'
    WHERE id = 'dddddddd-2222-0000-0000-0000000000aa'
  $$,
  'repairing a legacy row to a 6-day span is allowed'
);

SELECT * FROM finish();
ROLLBACK;
