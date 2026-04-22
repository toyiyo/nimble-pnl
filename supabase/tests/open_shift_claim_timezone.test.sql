-- pgTAP tests for timezone-aware open shift claim functions.
-- Verifies: claim_open_shift and approve_open_shift_claim create shifts
-- with correct UTC timestamps, and get_open_shifts counts shifts correctly
-- regardless of how they were created (planner vs claim).

BEGIN;

SELECT plan(8);

-- ============================================
-- Setup: disable RLS and seed test data
-- ============================================

SET LOCAL role TO postgres;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE shift_templates DISABLE ROW LEVEL SECURITY;
ALTER TABLE shifts DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE staffing_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_publications DISABLE ROW LEVEL SECURITY;
ALTER TABLE open_shift_claims DISABLE ROW LEVEL SECURITY;

-- Compute a target Sunday that is always in the future.
-- Formula: CURRENT_DATE + (7 - DOW) gives the next Sunday from today;
-- when today is Sunday (DOW=0), adds 7 to avoid using today.
CREATE TEMP TABLE test_config AS
SELECT
  CURRENT_DATE + (7 - EXTRACT(DOW FROM CURRENT_DATE)::int) AS target_sunday,
  (CURRENT_DATE + (7 - EXTRACT(DOW FROM CURRENT_DATE)::int))::timestamp + interval '15 hours 30 minutes' AS local_start,
  (CURRENT_DATE + (7 - EXTRACT(DOW FROM CURRENT_DATE)::int))::timestamp + interval '22 hours' AS local_end;

-- Auth user for FK references
INSERT INTO auth.users (id, email)
VALUES ('dddddddd-d001-0000-0000-000000000001', 'tz-test@example.com')
ON CONFLICT DO NOTHING;

-- Restaurant in CDT timezone (UTC-5 in summer, UTC-6 in winter)
INSERT INTO restaurants (id, name, timezone)
VALUES ('aaaaaaaa-a001-0000-0000-000000000001', 'TZ Test Restaurant', 'America/Chicago')
ON CONFLICT (id) DO NOTHING;

-- Template: Closing shift 3:30p-10p on Sundays (day 0), capacity 3
INSERT INTO shift_templates (id, restaurant_id, name, start_time, end_time, position, days, capacity)
VALUES (
  'bbbbbbbb-b001-0000-0000-000000000001',
  'aaaaaaaa-a001-0000-0000-000000000001',
  'Closing - Weekend',
  '15:30:00', '22:00:00',
  'Server',
  '{0}',  -- Sunday only
  3
);

-- Employee
INSERT INTO employees (id, restaurant_id, name, position, status, is_active)
VALUES (
  'cccccccc-c001-0000-0000-000000000001',
  'aaaaaaaa-a001-0000-0000-000000000001',
  'Test Employee', 'Server', 'active', true
);

-- Second employee (for approve test)
INSERT INTO employees (id, restaurant_id, name, position, status, is_active)
VALUES (
  'cccccccc-c001-0000-0000-000000000002',
  'aaaaaaaa-a001-0000-0000-000000000001',
  'Test Employee 2', 'Server', 'active', true
);

-- Enable open shifts, NO approval required (instant claim)
INSERT INTO staffing_settings (restaurant_id, open_shifts_enabled, require_shift_claim_approval)
VALUES ('aaaaaaaa-a001-0000-0000-000000000001', true, false)
ON CONFLICT (restaurant_id) DO UPDATE
SET open_shifts_enabled = true, require_shift_claim_approval = false;

-- Publish schedule for the week ending on target_sunday
INSERT INTO schedule_publications (restaurant_id, week_start_date, week_end_date, published_by, shift_count)
SELECT
  'aaaaaaaa-a001-0000-0000-000000000001',
  target_sunday - 6,
  target_sunday,
  'dddddddd-d001-0000-0000-000000000001',
  0
FROM test_config;

-- ============================================
-- Test 1: claim_open_shift (instant) creates shift with correct UTC start
-- Template 15:30 local → UTC equivalent depends on DST at target date
-- ============================================

SELECT is(
  (
    SELECT (result->>'success')::boolean
    FROM (
      SELECT claim_open_shift(
        'aaaaaaaa-a001-0000-0000-000000000001',
        'bbbbbbbb-b001-0000-0000-000000000001',
        (SELECT target_sunday FROM test_config),
        'cccccccc-c001-0000-0000-000000000001'
      ) AS result
    ) sub
  ),
  true,
  'claim_open_shift returns success=true'
);

-- ============================================
-- Test 2: Resulting shift start_time matches 15:30 local converted to UTC
-- ============================================

SELECT is(
  (
    SELECT start_time::timestamptz
    FROM shifts
    WHERE restaurant_id = 'aaaaaaaa-a001-0000-0000-000000000001'
      AND employee_id = 'cccccccc-c001-0000-0000-000000000001'
      AND source = 'template'
    ORDER BY created_at DESC LIMIT 1
  ),
  (SELECT local_start AT TIME ZONE 'America/Chicago' FROM test_config),
  'claim shift start_time matches 15:30 local converted to UTC'
);

-- ============================================
-- Test 3: Resulting shift end_time matches 22:00 local converted to UTC
-- ============================================

SELECT is(
  (
    SELECT end_time::timestamptz
    FROM shifts
    WHERE restaurant_id = 'aaaaaaaa-a001-0000-0000-000000000001'
      AND employee_id = 'cccccccc-c001-0000-0000-000000000001'
      AND source = 'template'
    ORDER BY created_at DESC LIMIT 1
  ),
  (SELECT local_end AT TIME ZONE 'America/Chicago' FROM test_config),
  'claim shift end_time matches 22:00 local converted to UTC'
);

-- ============================================
-- Test 4: get_open_shifts counts the claimed shift correctly (2 spots left, not 3)
-- ============================================

SELECT is(
  (
    SELECT open_spots
    FROM get_open_shifts(
      'aaaaaaaa-a001-0000-0000-000000000001',
      (SELECT target_sunday - 6 FROM test_config),
      (SELECT target_sunday FROM test_config)
    )
    WHERE shift_date = (SELECT target_sunday FROM test_config)
    LIMIT 1
  ),
  2::bigint,
  'get_open_shifts shows 2 open spots after 1 claim (not 3)'
);

-- ============================================
-- Test 5: Planner-created shift (proper UTC) is also counted by get_open_shifts
-- Insert a shift as if created by the planner: 15:30 local = UTC equivalent
-- ============================================

INSERT INTO shifts (restaurant_id, employee_id, start_time, end_time, position, status, source)
SELECT
  'aaaaaaaa-a001-0000-0000-000000000001',
  'cccccccc-c001-0000-0000-000000000002',
  local_start AT TIME ZONE 'America/Chicago',
  local_end AT TIME ZONE 'America/Chicago',
  'Server', 'scheduled', 'manual'
FROM test_config;

SELECT is(
  (
    SELECT open_spots
    FROM get_open_shifts(
      'aaaaaaaa-a001-0000-0000-000000000001',
      (SELECT target_sunday - 6 FROM test_config),
      (SELECT target_sunday FROM test_config)
    )
    WHERE shift_date = (SELECT target_sunday FROM test_config)
    LIMIT 1
  ),
  1::bigint,
  'get_open_shifts counts planner-created (proper UTC) shifts correctly — 1 spot left'
);

-- ============================================
-- Test 6: approve_open_shift_claim creates shift with correct UTC timestamps
-- Switch to approval-required mode and test the approve path
-- ============================================

UPDATE staffing_settings
SET require_shift_claim_approval = true
WHERE restaurant_id = 'aaaaaaaa-a001-0000-0000-000000000001';

-- Create a third employee for the approve test
INSERT INTO employees (id, restaurant_id, name, position, status, is_active)
VALUES (
  'cccccccc-c001-0000-0000-000000000003',
  'aaaaaaaa-a001-0000-0000-000000000001',
  'Test Employee 3', 'Server', 'active', true
);

-- Claim (this time it creates a pending claim, not an instant shift)
SELECT is(
  (
    SELECT (result->>'success')::boolean
    FROM (
      SELECT claim_open_shift(
        'aaaaaaaa-a001-0000-0000-000000000001',
        'bbbbbbbb-b001-0000-0000-000000000001',
        (SELECT target_sunday FROM test_config),
        'cccccccc-c001-0000-0000-000000000003'
      ) AS result
    ) sub
  ),
  true,
  'claim_open_shift with approval required returns success=true (pending claim)'
);

-- ============================================
-- Test 7: Approve the claim and check resulting shift timestamps
-- ============================================

SELECT is(
  (
    SELECT (result->>'success')::boolean
    FROM (
      SELECT approve_open_shift_claim(
        (SELECT id FROM open_shift_claims
         WHERE claimed_by_employee_id = 'cccccccc-c001-0000-0000-000000000003'
           AND status = 'pending_approval'
         LIMIT 1)
      ) AS result
    ) sub
  ),
  true,
  'approve_open_shift_claim returns success=true'
);

-- ============================================
-- Test 8: Approved shift has correct UTC start time
-- ============================================

SELECT is(
  (
    SELECT start_time::timestamptz
    FROM shifts
    WHERE restaurant_id = 'aaaaaaaa-a001-0000-0000-000000000001'
      AND employee_id = 'cccccccc-c001-0000-0000-000000000003'
      AND source = 'template'
    ORDER BY created_at DESC LIMIT 1
  ),
  (SELECT local_start AT TIME ZONE 'America/Chicago' FROM test_config),
  'approved claim shift start_time matches 15:30 local converted to UTC'
);

SELECT * FROM finish();
ROLLBACK;
