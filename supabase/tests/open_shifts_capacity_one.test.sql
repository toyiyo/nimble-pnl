-- pgTAP regression test: capacity-1 templates must be claimable open shifts.
--
-- Bug: get_open_shifts filtered templates with `st.capacity > 1`, silently
-- excluding single-person crew allocations (e.g. the AI scheduler's "1 Server")
-- from the open-shift pool. They were applied to shift_templates and surfaced
-- an "open shifts created" toast, but never appeared as claimable shifts.
-- Fix changes the guard to `st.capacity > 0`.
--
-- Also pins that claim_open_shift's capacity guard
-- (`assigned + pending >= capacity`) correctly blocks the 2nd claim on a
-- capacity-1 template.

BEGIN;

SELECT plan(3);

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

-- Compute a target Sunday that is always in the future (never hardcode
-- future dates — see lessons 2026-04-21). DOW=0 is Sunday; when today is
-- Sunday, +7 avoids using today.
CREATE TEMP TABLE test_config AS
SELECT CURRENT_DATE + (7 - EXTRACT(DOW FROM CURRENT_DATE)::int) AS target_sunday;

-- Auth user for FK references (schedule_publications.published_by)
INSERT INTO auth.users (id, email)
VALUES ('dddddddd-ca01-0000-0000-000000000001', 'cap1-test@example.com')
ON CONFLICT DO NOTHING;

-- Restaurant in CDT timezone
INSERT INTO restaurants (id, name, timezone)
VALUES ('aaaaaaaa-ca01-0000-0000-000000000001', 'Cap1 Test Restaurant', 'America/Chicago')
ON CONFLICT (id) DO UPDATE SET timezone = 'America/Chicago';

-- Template: capacity = 1 (the regression case). Closing 3:30p-10p Sundays.
INSERT INTO shift_templates (id, restaurant_id, name, start_time, end_time, position, days, capacity, is_active)
VALUES (
  'bbbbbbbb-ca01-0000-0000-000000000001',
  'aaaaaaaa-ca01-0000-0000-000000000001',
  'Solo Closer',
  '15:30:00', '22:00:00',
  'Server',
  '{0}',  -- Sunday only
  1,      -- single-person crew
  true
)
ON CONFLICT (id) DO UPDATE SET capacity = 1, is_active = true;

-- Two employees (second one drives the "no open spots" 2nd-claim test).
INSERT INTO employees (id, restaurant_id, name, position, status, is_active)
VALUES
  ('cccccccc-ca01-0000-0000-000000000001', 'aaaaaaaa-ca01-0000-0000-000000000001', 'Cap1 Emp 1', 'Server', 'active', true),
  ('cccccccc-ca01-0000-0000-000000000002', 'aaaaaaaa-ca01-0000-0000-000000000001', 'Cap1 Emp 2', 'Server', 'active', true)
ON CONFLICT (id) DO NOTHING;

-- Enable open shifts, NO approval required (instant claim creates the shift).
INSERT INTO staffing_settings (restaurant_id, open_shifts_enabled, require_shift_claim_approval)
VALUES ('aaaaaaaa-ca01-0000-0000-000000000001', true, false)
ON CONFLICT (restaurant_id) DO UPDATE
SET open_shifts_enabled = true, require_shift_claim_approval = false;

-- Publish schedule for the week ending on target_sunday.
INSERT INTO schedule_publications (restaurant_id, week_start_date, week_end_date, published_by, shift_count)
SELECT
  'aaaaaaaa-ca01-0000-0000-000000000001',
  target_sunday - 6,
  target_sunday,
  'dddddddd-ca01-0000-0000-000000000001',
  0
FROM test_config
ON CONFLICT DO NOTHING;

-- ============================================
-- Test 1: capacity-1 template appears as a claimable open shift.
-- (Fails before the fix: `st.capacity > 1` excludes the template entirely,
--  so get_open_shifts returns NO row and open_spots comes back NULL.)
-- ============================================

SELECT is(
  (
    SELECT open_spots
    FROM get_open_shifts(
      'aaaaaaaa-ca01-0000-0000-000000000001',
      (SELECT target_sunday - 6 FROM test_config),
      (SELECT target_sunday FROM test_config)
    )
    WHERE shift_date = (SELECT target_sunday FROM test_config)
    LIMIT 1
  ),
  1::bigint,
  'capacity-1 template shows 1 open spot in get_open_shifts'
);

-- ============================================
-- Test 2: after one instant claim, the now-full capacity-1 template is no
-- longer returned by get_open_shifts.
--
-- Note on WHY it drops out: instant claim inserts an open_shift_claims row
-- with status='approved' (not 'pending_approval'), so the pending_claims CTE
-- stays 0. The slot count is driven to 0 by assigned_count (the shifts join
-- on position+time+date), then the final `open_spots > 0` WHERE filters it.
-- ============================================

-- Instant claim by employee 1.
SELECT claim_open_shift(
  'aaaaaaaa-ca01-0000-0000-000000000001',
  'bbbbbbbb-ca01-0000-0000-000000000001',
  (SELECT target_sunday FROM test_config),
  'cccccccc-ca01-0000-0000-000000000001'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM get_open_shifts(
      'aaaaaaaa-ca01-0000-0000-000000000001',
      (SELECT target_sunday - 6 FROM test_config),
      (SELECT target_sunday FROM test_config)
    )
    WHERE shift_date = (SELECT target_sunday FROM test_config)
  ),
  'fully-claimed capacity-1 template is filtered out of get_open_shifts'
);

-- ============================================
-- Test 3: a second claim on the full capacity-1 template is rejected by
-- claim_open_shift's capacity guard (assigned 1 + pending 0 >= capacity 1).
-- Uses employee 2 so the capacity guard — not the schedule-conflict check —
-- is what rejects it.
-- ============================================

SELECT is(
  (
    SELECT (result->>'success')::boolean
    FROM (
      SELECT claim_open_shift(
        'aaaaaaaa-ca01-0000-0000-000000000001',
        'bbbbbbbb-ca01-0000-0000-000000000001',
        (SELECT target_sunday FROM test_config),
        'cccccccc-ca01-0000-0000-000000000002'
      ) AS result
    ) sub
  ),
  false,
  'second claim on full capacity-1 template returns success=false'
);

SELECT * FROM finish();
ROLLBACK;
