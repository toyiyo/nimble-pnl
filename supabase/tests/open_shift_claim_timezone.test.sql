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

-- Restaurant in CDT timezone (UTC-5 in April)
INSERT INTO restaurants (id, name, timezone)
VALUES ('aaaaaaaa-tz01-0000-0000-000000000001', 'TZ Test Restaurant', 'America/Chicago')
ON CONFLICT (id) DO NOTHING;

-- Template: Closing shift 3:30p-10p on Sundays (day 0), capacity 3
INSERT INTO shift_templates (id, restaurant_id, name, start_time, end_time, position, days, capacity)
VALUES (
  'bbbbbbbb-tz01-0000-0000-000000000001',
  'aaaaaaaa-tz01-0000-0000-000000000001',
  'Closing - Weekend',
  '15:30:00', '22:00:00',
  'Server',
  '{0}',  -- Sunday only
  3
);

-- Employee
INSERT INTO employees (id, restaurant_id, name, position, status, is_active)
VALUES (
  'cccccccc-tz01-0000-0000-000000000001',
  'aaaaaaaa-tz01-0000-0000-000000000001',
  'Test Employee', 'Server', 'active', true
);

-- Second employee (for approve test)
INSERT INTO employees (id, restaurant_id, name, position, status, is_active)
VALUES (
  'cccccccc-tz01-0000-0000-000000000002',
  'aaaaaaaa-tz01-0000-0000-000000000001',
  'Test Employee 2', 'Server', 'active', true
);

-- Enable open shifts, NO approval required (instant claim)
INSERT INTO staffing_settings (restaurant_id, open_shifts_enabled, require_shift_claim_approval)
VALUES ('aaaaaaaa-tz01-0000-0000-000000000001', true, false)
ON CONFLICT (restaurant_id) DO UPDATE
SET open_shifts_enabled = true, require_shift_claim_approval = false;

-- Publish schedule for April 13-19, 2026 (Sun Apr 19 is day-of-week 0)
INSERT INTO schedule_publications (restaurant_id, week_start_date, week_end_date, published_by, shift_count)
VALUES (
  'aaaaaaaa-tz01-0000-0000-000000000001',
  '2026-04-13', '2026-04-19',
  '00000000-0000-0000-0000-000000000000',
  0
);

-- ============================================
-- Test 1: claim_open_shift (instant) creates shift with correct UTC start
-- In April, CDT = UTC-5. Template 15:30 local → 20:30 UTC
-- ============================================

SELECT is(
  (
    SELECT (result->>'success')::boolean
    FROM (
      SELECT claim_open_shift(
        'aaaaaaaa-tz01-0000-0000-000000000001',
        'bbbbbbbb-tz01-0000-0000-000000000001',
        '2026-04-19'::date,
        'cccccccc-tz01-0000-0000-000000000001'
      ) AS result
    ) sub
  ),
  true,
  'claim_open_shift returns success=true'
);

-- ============================================
-- Test 2: Resulting shift start_time is 20:30 UTC (15:30 CDT), not 15:30 UTC
-- ============================================

SELECT is(
  (
    SELECT start_time::timestamptz
    FROM shifts
    WHERE restaurant_id = 'aaaaaaaa-tz01-0000-0000-000000000001'
      AND employee_id = 'cccccccc-tz01-0000-0000-000000000001'
      AND source = 'template'
    ORDER BY created_at DESC LIMIT 1
  ),
  '2026-04-19 20:30:00+00'::timestamptz,
  'claim shift start_time is 20:30 UTC (15:30 CDT), not 15:30 UTC'
);

-- ============================================
-- Test 3: Resulting shift end_time is 03:00 UTC next day (22:00 CDT)
-- ============================================

SELECT is(
  (
    SELECT end_time::timestamptz
    FROM shifts
    WHERE restaurant_id = 'aaaaaaaa-tz01-0000-0000-000000000001'
      AND employee_id = 'cccccccc-tz01-0000-0000-000000000001'
      AND source = 'template'
    ORDER BY created_at DESC LIMIT 1
  ),
  '2026-04-20 03:00:00+00'::timestamptz,
  'claim shift end_time is 03:00 UTC next day (22:00 CDT), not 22:00 UTC'
);

-- ============================================
-- Test 4: get_open_shifts counts the claimed shift correctly (2 spots left, not 3)
-- ============================================

SELECT is(
  (
    SELECT open_spots
    FROM get_open_shifts(
      'aaaaaaaa-tz01-0000-0000-000000000001',
      '2026-04-13'::date,
      '2026-04-19'::date
    )
    WHERE shift_date = '2026-04-19'
    LIMIT 1
  ),
  2::bigint,
  'get_open_shifts shows 2 open spots after 1 claim (not 3)'
);

-- ============================================
-- Test 5: Planner-created shift (proper UTC) is also counted by get_open_shifts
-- Insert a shift as if created by the planner: 15:30 CDT = 20:30 UTC
-- ============================================

INSERT INTO shifts (restaurant_id, employee_id, start_time, end_time, position, status, source)
VALUES (
  'aaaaaaaa-tz01-0000-0000-000000000001',
  'cccccccc-tz01-0000-0000-000000000002',
  '2026-04-19 20:30:00+00',  -- 15:30 CDT as proper UTC
  '2026-04-20 03:00:00+00',  -- 22:00 CDT as proper UTC
  'Server', 'scheduled', 'manual'
);

SELECT is(
  (
    SELECT open_spots
    FROM get_open_shifts(
      'aaaaaaaa-tz01-0000-0000-000000000001',
      '2026-04-13'::date,
      '2026-04-19'::date
    )
    WHERE shift_date = '2026-04-19'
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
WHERE restaurant_id = 'aaaaaaaa-tz01-0000-0000-000000000001';

-- Create a third employee for the approve test
INSERT INTO employees (id, restaurant_id, name, position, status, is_active)
VALUES (
  'cccccccc-tz01-0000-0000-000000000003',
  'aaaaaaaa-tz01-0000-0000-000000000001',
  'Test Employee 3', 'Server', 'active', true
);

-- Claim (this time it creates a pending claim, not an instant shift)
SELECT is(
  (
    SELECT (result->>'success')::boolean
    FROM (
      SELECT claim_open_shift(
        'aaaaaaaa-tz01-0000-0000-000000000001',
        'bbbbbbbb-tz01-0000-0000-000000000001',
        '2026-04-19'::date,
        'cccccccc-tz01-0000-0000-000000000003'
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
         WHERE claimed_by_employee_id = 'cccccccc-tz01-0000-0000-000000000003'
           AND status = 'pending_approval'
         LIMIT 1)
      ) AS result
    ) sub
  ),
  true,
  'approve_open_shift_claim returns success=true'
);

-- ============================================
-- Test 8: Approved shift has correct UTC start time (20:30 UTC, not 15:30 UTC)
-- ============================================

SELECT is(
  (
    SELECT start_time::timestamptz
    FROM shifts
    WHERE restaurant_id = 'aaaaaaaa-tz01-0000-0000-000000000001'
      AND employee_id = 'cccccccc-tz01-0000-0000-000000000003'
      AND source = 'template'
    ORDER BY created_at DESC LIMIT 1
  ),
  '2026-04-19 20:30:00+00'::timestamptz,
  'approved claim shift start_time is 20:30 UTC (15:30 CDT), not 15:30 UTC'
);

SELECT * FROM finish();
ROLLBACK;
