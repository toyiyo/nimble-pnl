-- pgTAP tests for timezone-aware open shift claim functions.
-- Verifies: claim_open_shift and approve_open_shift_claim create shifts
-- with correct UTC timestamps, and get_open_shifts counts shifts correctly
-- regardless of how they were created (planner vs claim).
--
-- Auth-context update (2026-07-21, alongside
-- supabase/migrations/20260721000000_open_shift_claim_authz_guard.sql):
-- get_open_shifts, claim_open_shift and approve_open_shift_claim are now
-- guarded (caller must belong to the restaurant / own the employee row they
-- claim as / be an owner-manager-operations_manager to approve). This file
-- previously ran every RPC call as `SET LOCAL role TO postgres`
-- (auth.uid() NULL throughout), which the new guards would reject outright
-- for a reason unrelated to the UTC-timestamp behavior under test. Employees
-- 1 and 3 (the ones that actually call claim_open_shift) get a dedicated
-- auth.users row + employees.user_id, and a manager gets an auth.users row +
-- user_restaurants row, mirroring the 54_accept_shift_trade_authz.sql /
-- 60_claim_open_shift_active_guard.test.sql / 61_approve_open_shift_claim_
-- active_guard.test.sql / 62_open_shift_claim_authz.test.sql precedent. RLS
-- is re-enabled on every table before the first role switch; admin-only
-- steps (setup inserts, the require_shift_claim_approval UPDATE, and the
-- final read-back of the approved shift) run back under `postgres`, which
-- bypasses RLS as a superuser without needing to re-disable it. Only the
-- caller context changes — the timezone/UTC semantics under test are
-- untouched.

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
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;

-- Compute a target Sunday that is always in the future.
-- Formula: CURRENT_DATE + (7 - DOW) gives the next Sunday from today;
-- when today is Sunday (DOW=0), adds 7 to avoid using today.
CREATE TEMP TABLE test_config AS
SELECT
  CURRENT_DATE + (7 - EXTRACT(DOW FROM CURRENT_DATE)::int) AS target_sunday,
  (CURRENT_DATE + (7 - EXTRACT(DOW FROM CURRENT_DATE)::int))::timestamp + interval '15 hours 30 minutes' AS local_start,
  (CURRENT_DATE + (7 - EXTRACT(DOW FROM CURRENT_DATE)::int))::timestamp + interval '22 hours' AS local_end;

-- test_config is read from `authenticated`-impersonated RPC-call assertions
-- below (Tests 1, 4, 5, 6), so the `authenticated` role needs SELECT on it.
GRANT SELECT ON test_config TO authenticated;

-- Auth user for FK references (schedule_publications.published_by).
INSERT INTO auth.users (id, email)
VALUES ('dddddddd-d001-0000-0000-000000000001', 'tz-test@example.com')
ON CONFLICT DO NOTHING;

-- Dedicated auth.users rows for employees 1 and 3 (the callers of
-- claim_open_shift below) and for a manager (the caller of
-- approve_open_shift_claim), so the guarded RPCs can be exercised as real
-- `authenticated` callers instead of `postgres` (auth.uid() NULL). Full
-- column set matches the 54/60/61/62 precedent for a row Supabase auth
-- considers well-formed.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('eeeeeeee-e001-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tz-test-emp1@example.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('eeeeeeee-e001-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tz-test-emp3@example.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('eeeeeeee-e001-0000-0000-000000000099', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tz-test-mgr@example.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

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

-- Employee 1 (claims in Test 1) — linked to its own auth.users row.
INSERT INTO employees (id, restaurant_id, user_id, name, position, status, is_active)
VALUES (
  'cccccccc-c001-0000-0000-000000000001',
  'aaaaaaaa-a001-0000-0000-000000000001',
  'eeeeeeee-e001-0000-0000-000000000001',
  'Test Employee', 'Server', 'active', true
);

-- Second employee (for approve test) — no RPC call is made as this employee,
-- so no auth.users row is required.
INSERT INTO employees (id, restaurant_id, name, position, status, is_active)
VALUES (
  'cccccccc-c001-0000-0000-000000000002',
  'aaaaaaaa-a001-0000-0000-000000000001',
  'Test Employee 2', 'Server', 'active', true
);

-- Manager (approves the claim in Test 7) — owner/manager/operations_manager
-- of this restaurant.
INSERT INTO user_restaurants (user_id, restaurant_id, role)
VALUES ('eeeeeeee-e001-0000-0000-000000000099', 'aaaaaaaa-a001-0000-0000-000000000001', 'manager')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

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

-- CRITICAL: re-enable RLS on every table disabled above before switching to
-- the authenticated role (54_accept_shift_trade_authz.sql /
-- 60_claim_open_shift_active_guard.test.sql /
-- 61_approve_open_shift_claim_active_guard.test.sql /
-- 62_open_shift_claim_authz.test.sql precedent). `postgres` still bypasses
-- RLS as a superuser, so the admin-only steps later in this file don't need
-- it disabled again.
ALTER TABLE restaurants           ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_templates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees             ENABLE ROW LEVEL SECURITY;
ALTER TABLE staffing_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE open_shift_claims     ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants      ENABLE ROW LEVEL SECURITY;

RESET ROLE;

-- ============================================
-- Test 1: claim_open_shift (instant) creates shift with correct UTC start
-- Template 15:30 local → UTC equivalent depends on DST at target date
-- Impersonate employee 1 — the caller-owns-employee-row guard requires
-- auth.uid() to match p_employee_id.
-- ============================================

SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"eeeeeeee-e001-0000-0000-000000000001","role":"authenticated"}', true);

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

RESET ROLE;

-- ============================================
-- Test 2: Resulting shift start_time matches 15:30 local converted to UTC
-- Read-back only, no RPC call — stays postgres.
-- ============================================

SET LOCAL role TO postgres;

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
-- Read-back only, no RPC call — stays postgres.
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
-- Impersonate employee 1 (linked to the restaurant) — get_open_shifts'
-- membership guard requires a real authenticated caller belonging to the
-- restaurant, not postgres (auth.uid() NULL).
-- ============================================

RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"eeeeeeee-e001-0000-0000-000000000001","role":"authenticated"}', true);

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

RESET ROLE;

-- ============================================
-- Test 5: Planner-created shift (proper UTC) is also counted by get_open_shifts
-- Insert a shift as if created by the planner: 15:30 local = UTC equivalent.
-- The raw INSERT runs as postgres (admin/planner action, no RPC call); the
-- get_open_shifts read-back is impersonated as employee 1 for the same
-- membership-guard reason as Test 4.
-- ============================================

SET LOCAL role TO postgres;

INSERT INTO shifts (restaurant_id, employee_id, start_time, end_time, position, status, source)
SELECT
  'aaaaaaaa-a001-0000-0000-000000000001',
  'cccccccc-c001-0000-0000-000000000002',
  local_start AT TIME ZONE 'America/Chicago',
  local_end AT TIME ZONE 'America/Chicago',
  'Server', 'scheduled', 'manual'
FROM test_config;

RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"eeeeeeee-e001-0000-0000-000000000001","role":"authenticated"}', true);

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

RESET ROLE;

-- ============================================
-- Test 6: approve_open_shift_claim creates shift with correct UTC timestamps
-- Switch to approval-required mode and test the approve path.
-- Admin steps (the UPDATE and the new employee 3 fixture) run as postgres;
-- the claim_open_shift call is impersonated as employee 3 (a fresh
-- auth.users-linked employee) since the caller-owns-employee-row guard
-- requires auth.uid() to match p_employee_id.
-- ============================================

SET LOCAL role TO postgres;

UPDATE staffing_settings
SET require_shift_claim_approval = true
WHERE restaurant_id = 'aaaaaaaa-a001-0000-0000-000000000001';

-- Create a third employee for the approve test — linked to its own
-- auth.users row.
INSERT INTO employees (id, restaurant_id, user_id, name, position, status, is_active)
VALUES (
  'cccccccc-c001-0000-0000-000000000003',
  'aaaaaaaa-a001-0000-0000-000000000001',
  'eeeeeeee-e001-0000-0000-000000000003',
  'Test Employee 3', 'Server', 'active', true
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"eeeeeeee-e001-0000-0000-000000000003","role":"authenticated"}', true);

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

RESET ROLE;

-- ============================================
-- Test 7: Approve the claim and check resulting shift timestamps
-- Impersonate the manager (owner/manager/operations_manager guard).
-- ============================================

SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"eeeeeeee-e001-0000-0000-000000000099","role":"authenticated"}', true);

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

RESET ROLE;

-- ============================================
-- Test 8: Approved shift has correct UTC start time
-- Read-back only, no RPC call — stays postgres.
-- ============================================

SET LOCAL role TO postgres;

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
