-- pgTAP tests for the schedule_publications week-range invariant.
-- A correct Mon..Sun (6-day) span inserts; the Mon..Mon (7-day) spill raises.
--
-- Note: schedule_publications.published_by is NOT NULL with a FK to
-- auth.users(id), so (per the plan's Step 4 contingency) both inserts below
-- reference a dedicated auth.users row instead of the plan's literal NULL
-- literal, mirroring the established fixture pattern (see
-- open_shifts_capacity_one.test.sql's "Auth user for FK references" comment).

BEGIN;

SELECT plan(3);

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

-- Test 1: the constraint exists
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'schedule_publications_week_range_valid'
      AND conrelid = 'public.schedule_publications'::regclass
  ),
  'schedule_publications_week_range_valid constraint exists'
);

-- Test 2: a correct Mon..Sun span is accepted
SELECT lives_ok(
  $$
    INSERT INTO schedule_publications
      (restaurant_id, week_start_date, week_end_date, published_by)
    VALUES
      ('dddddddd-2222-0000-0000-000000000001', DATE '2026-07-27', DATE '2026-08-02', 'dddddddd-2222-0000-0000-000000000099')
  $$,
  'a 6-day Mon..Sun span is accepted'
);

-- Test 3: the Mon..Mon spill is rejected
SELECT throws_ok(
  $$
    INSERT INTO schedule_publications
      (restaurant_id, week_start_date, week_end_date, published_by)
    VALUES
      ('dddddddd-2222-0000-0000-000000000001', DATE '2026-07-27', DATE '2026-08-03', 'dddddddd-2222-0000-0000-000000000099')
  $$,
  '23514',
  NULL,
  'the 8-day Mon..Mon spill is rejected by the CHECK constraint'
);

SELECT * FROM finish();
ROLLBACK;
