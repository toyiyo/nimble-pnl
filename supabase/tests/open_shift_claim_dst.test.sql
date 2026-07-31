-- pgTAP tests: cross-surface agreement on DST transition dates.
--
-- Task 9 of the shift-creation-timezone plan. Every other test in this
-- workflow (unit, e2e, wall_clock_parity.sql) verifies ONE surface in
-- isolation. That's not enough: the superseded design used `fromZonedTime`
-- on the client (assign-template path) while `claim_open_shift` /
-- `approve_open_shift_claim` always resolved DST server-side via
-- `(...)::timestamp AT TIME ZONE tz`. A single-surface test whose expected
-- value is derived from the same implementation under test can pass even
-- when that implementation disagrees with the other production surface for
-- the *same* template and date — exactly what shipped as the Rush Bowls bug.
--
-- This file asserts three things stay in lockstep, independently pinned
-- (not copied from either function's own output), for both 2026 DST
-- transition dates:
--   1. the "assign template" path — simulated here via the identical
--      `(date || ' ' || time)::timestamp AT TIME ZONE tz` formula that
--      `wallClockToInstant` is Postgres-parity with (verified byte-for-byte
--      by tests/unit/restaurantClock.test.ts and wall_clock_parity.sql);
--   2. `claim_open_shift`'s instant-approval path;
--   3. `approve_open_shift_claim`'s approved-claim path.
-- All three must land on the same hand-derived UTC instant for the same
-- template + shift_date, on both the spring-forward (2026-03-08) and
-- fall-back (2026-11-01) transition dates.
--
-- Expected UTC instants below were derived independently via Python's
-- zoneinfo (America/Chicago), not copied from any SQL or TypeScript output:
--   2026-03-08 (spring-forward, template unambiguous at 15:30 CDT/UTC-5):
--     15:30 local -> 2026-03-08T20:30:00Z, 22:00 local -> 2026-03-09T03:00:00Z
--   2026-11-01 (fall-back, template unambiguous at 15:30 CST/UTC-6):
--     15:30 local -> 2026-11-01T21:30:00Z, 22:00 local -> 2026-11-02T04:00:00Z
--
-- Auth-context pattern (dedicated auth.users rows for RPC callers, RLS
-- re-enabled before the authenticated role switch) follows
-- open_shift_claim_timezone.test.sql / 60_claim_open_shift_active_guard.test.sql
-- / 61_approve_open_shift_claim_active_guard.test.sql / 62_open_shift_claim_authz.test.sql.

BEGIN;

SELECT plan(18);

-- ============================================
-- Setup
-- ============================================

SET LOCAL role TO postgres;
ALTER TABLE restaurants           DISABLE ROW LEVEL SECURITY;
ALTER TABLE shift_templates       DISABLE ROW LEVEL SECURITY;
ALTER TABLE shifts                DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees             DISABLE ROW LEVEL SECURITY;
ALTER TABLE staffing_settings     DISABLE ROW LEVEL SECURITY;
ALTER TABLE open_shift_claims     DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants      DISABLE ROW LEVEL SECURITY;

-- Restaurant in America/Chicago (CDT/UTC-5 in summer, CST/UTC-6 in winter) —
-- the case that actually crosses both 2026 transitions under test.
INSERT INTO restaurants (id, name, timezone)
VALUES ('a1111111-1111-1111-1111-111111111111', 'DST Cross-Surface Test Restaurant', 'America/Chicago')
ON CONFLICT (id) DO NOTHING;

-- Template: 15:30-22:00, every Sunday, capacity 5. Both 2026-03-08 and
-- 2026-11-01 are Sundays.
INSERT INTO shift_templates (id, restaurant_id, name, start_time, end_time, position, days, capacity)
VALUES (
  'b1111111-1111-1111-1111-111111111111',
  'a1111111-1111-1111-1111-111111111111',
  'DST Cross-Surface Template',
  '15:30:00', '22:00:00',
  'Server',
  '{0}',
  5
);

-- Employee A: stands in for the "assign template" client path. No RPC call
-- is made as this employee, so no auth.users row is required — the shift is
-- inserted directly, mirroring how the client writes the row it computed.
INSERT INTO employees (id, restaurant_id, name, position, status, is_active)
VALUES (
  'c1111111-1111-1111-1111-111111111111',
  'a1111111-1111-1111-1111-111111111111',
  'Assign-Path Employee', 'Server', 'active', true
);

-- Employee B: calls claim_open_shift directly (instant-approval path).
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES (
  'e2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'dst-test-emp-b@example.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO employees (id, restaurant_id, user_id, name, position, status, is_active)
VALUES (
  'c2222222-2222-2222-2222-222222222222',
  'a1111111-1111-1111-1111-111111111111',
  'e2222222-2222-2222-2222-222222222222',
  'Instant-Claim Employee', 'Server', 'active', true
);

-- Employee C: calls claim_open_shift under require_shift_claim_approval, then
-- gets approved by the manager (approve_open_shift_claim path).
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES (
  'e3333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'dst-test-emp-c@example.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO employees (id, restaurant_id, user_id, name, position, status, is_active)
VALUES (
  'c3333333-3333-3333-3333-333333333333',
  'a1111111-1111-1111-1111-111111111111',
  'e3333333-3333-3333-3333-333333333333',
  'Approve-Claim Employee', 'Server', 'active', true
);

-- Manager: approves employee C's pending claim.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES (
  'e9999999-9999-9999-9999-999999999999', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'dst-test-mgr@example.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_restaurants (user_id, restaurant_id, role)
VALUES ('e9999999-9999-9999-9999-999999999999', 'a1111111-1111-1111-1111-111111111111', 'manager')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO staffing_settings (restaurant_id, open_shifts_enabled, require_shift_claim_approval)
VALUES ('a1111111-1111-1111-1111-111111111111', true, false)
ON CONFLICT (restaurant_id) DO UPDATE
SET open_shifts_enabled = true, require_shift_claim_approval = false;

ALTER TABLE restaurants           ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_templates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees             ENABLE ROW LEVEL SECURITY;
ALTER TABLE staffing_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE open_shift_claims     ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants      ENABLE ROW LEVEL SECURITY;

RESET ROLE;

-- ============================================
-- 2026-03-08 (spring-forward): expected 2026-03-08T20:30:00Z / 2026-03-09T03:00:00Z
-- ============================================

SET LOCAL role TO postgres;

-- Assign-template path (simulated): identical Postgres-parity formula to
-- what wallClockToInstant/ShiftInterval.create compute client-side.
INSERT INTO shifts (restaurant_id, employee_id, shift_template_id, start_time, end_time, position, status, source, is_published)
VALUES (
  'a1111111-1111-1111-1111-111111111111',
  'c1111111-1111-1111-1111-111111111111',
  'b1111111-1111-1111-1111-111111111111',
  ('2026-03-08 15:30:00')::timestamp AT TIME ZONE 'America/Chicago',
  ('2026-03-08 22:00:00')::timestamp AT TIME ZONE 'America/Chicago',
  'Server', 'scheduled', 'template', true
);

SELECT is(
  (SELECT start_time::timestamptz FROM shifts WHERE employee_id = 'c1111111-1111-1111-1111-111111111111'),
  '2026-03-08T20:30:00Z'::timestamptz,
  '2026-03-08: assign-template start_time matches independently-derived UTC instant'
);

SELECT is(
  (SELECT end_time::timestamptz FROM shifts WHERE employee_id = 'c1111111-1111-1111-1111-111111111111'),
  '2026-03-09T03:00:00Z'::timestamptz,
  '2026-03-08: assign-template end_time matches independently-derived UTC instant'
);

RESET ROLE;

-- claim_open_shift, instant approval (employee B)
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"e2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

SELECT is(
  (SELECT (result->>'success')::boolean FROM (
    SELECT claim_open_shift(
      'a1111111-1111-1111-1111-111111111111',
      'b1111111-1111-1111-1111-111111111111',
      '2026-03-08'::date,
      'c2222222-2222-2222-2222-222222222222'
    ) AS result
  ) sub),
  true,
  '2026-03-08: claim_open_shift (instant) returns success=true'
);

RESET ROLE;
SET LOCAL role TO postgres;

SELECT is(
  (SELECT start_time::timestamptz FROM shifts WHERE employee_id = 'c2222222-2222-2222-2222-222222222222'),
  '2026-03-08T20:30:00Z'::timestamptz,
  '2026-03-08: claim_open_shift start_time matches independently-derived UTC instant'
);

SELECT is(
  (SELECT start_time::timestamptz FROM shifts WHERE employee_id = 'c2222222-2222-2222-2222-222222222222'),
  (SELECT start_time::timestamptz FROM shifts WHERE employee_id = 'c1111111-1111-1111-1111-111111111111'),
  '2026-03-08: claim_open_shift agrees with the assign-template path'
);

RESET ROLE;

-- approve_open_shift_claim (employee C claims, manager approves)
SET LOCAL role TO postgres;
UPDATE staffing_settings SET require_shift_claim_approval = true
WHERE restaurant_id = 'a1111111-1111-1111-1111-111111111111';
RESET ROLE;

SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"e3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);

SELECT is(
  (SELECT (result->>'success')::boolean FROM (
    SELECT claim_open_shift(
      'a1111111-1111-1111-1111-111111111111',
      'b1111111-1111-1111-1111-111111111111',
      '2026-03-08'::date,
      'c3333333-3333-3333-3333-333333333333'
    ) AS result
  ) sub),
  true,
  '2026-03-08: claim_open_shift (pending approval) returns success=true'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"e9999999-9999-9999-9999-999999999999","role":"authenticated"}', true);

SELECT is(
  (SELECT (result->>'success')::boolean FROM (
    SELECT approve_open_shift_claim(
      (SELECT id FROM open_shift_claims
       WHERE claimed_by_employee_id = 'c3333333-3333-3333-3333-333333333333'
         AND shift_date = '2026-03-08'::date
         AND status = 'pending_approval'
       LIMIT 1)
    ) AS result
  ) sub),
  true,
  '2026-03-08: approve_open_shift_claim returns success=true'
);

RESET ROLE;
SET LOCAL role TO postgres;

SELECT is(
  (SELECT start_time::timestamptz FROM shifts WHERE employee_id = 'c3333333-3333-3333-3333-333333333333'),
  '2026-03-08T20:30:00Z'::timestamptz,
  '2026-03-08: approve_open_shift_claim start_time matches independently-derived UTC instant'
);

SELECT is(
  (SELECT start_time::timestamptz FROM shifts WHERE employee_id = 'c3333333-3333-3333-3333-333333333333'),
  (SELECT start_time::timestamptz FROM shifts WHERE employee_id = 'c1111111-1111-1111-1111-111111111111'),
  '2026-03-08: approve_open_shift_claim agrees with the assign-template path'
);

-- Reset approval setting for the next date's instant-claim phase.
UPDATE staffing_settings SET require_shift_claim_approval = false
WHERE restaurant_id = 'a1111111-1111-1111-1111-111111111111';

RESET ROLE;

-- ============================================
-- 2026-11-01 (fall-back): expected 2026-11-01T21:30:00Z / 2026-11-02T04:00:00Z
-- ============================================

SET LOCAL role TO postgres;

INSERT INTO shifts (restaurant_id, employee_id, shift_template_id, start_time, end_time, position, status, source, is_published)
SELECT
  'a1111111-1111-1111-1111-111111111111',
  'c1111111-1111-1111-1111-111111111111',
  'b1111111-1111-1111-1111-111111111111',
  ('2026-11-01 15:30:00')::timestamp AT TIME ZONE 'America/Chicago',
  ('2026-11-01 22:00:00')::timestamp AT TIME ZONE 'America/Chicago',
  'Server', 'scheduled', 'template', true;

SELECT is(
  (SELECT start_time::timestamptz FROM shifts
   WHERE employee_id = 'c1111111-1111-1111-1111-111111111111' AND start_time::date IN ('2026-11-01', '2026-11-02')),
  '2026-11-01T21:30:00Z'::timestamptz,
  '2026-11-01: assign-template start_time matches independently-derived UTC instant'
);

SELECT is(
  (SELECT end_time::timestamptz FROM shifts
   WHERE employee_id = 'c1111111-1111-1111-1111-111111111111' AND start_time::timestamptz = '2026-11-01T21:30:00Z'::timestamptz),
  '2026-11-02T04:00:00Z'::timestamptz,
  '2026-11-01: assign-template end_time matches independently-derived UTC instant'
);

RESET ROLE;

SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"e2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

SELECT is(
  (SELECT (result->>'success')::boolean FROM (
    SELECT claim_open_shift(
      'a1111111-1111-1111-1111-111111111111',
      'b1111111-1111-1111-1111-111111111111',
      '2026-11-01'::date,
      'c2222222-2222-2222-2222-222222222222'
    ) AS result
  ) sub),
  true,
  '2026-11-01: claim_open_shift (instant) returns success=true'
);

RESET ROLE;
SET LOCAL role TO postgres;

SELECT is(
  (SELECT start_time::timestamptz FROM shifts
   WHERE employee_id = 'c2222222-2222-2222-2222-222222222222' AND start_time::timestamptz = '2026-11-01T21:30:00Z'::timestamptz),
  '2026-11-01T21:30:00Z'::timestamptz,
  '2026-11-01: claim_open_shift start_time matches independently-derived UTC instant'
);

SELECT is(
  (SELECT start_time::timestamptz FROM shifts WHERE employee_id = 'c2222222-2222-2222-2222-222222222222'
     AND start_time::timestamptz = '2026-11-01T21:30:00Z'::timestamptz),
  (SELECT start_time::timestamptz FROM shifts WHERE employee_id = 'c1111111-1111-1111-1111-111111111111'
     AND start_time::timestamptz = '2026-11-01T21:30:00Z'::timestamptz),
  '2026-11-01: claim_open_shift agrees with the assign-template path'
);

RESET ROLE;

SET LOCAL role TO postgres;
UPDATE staffing_settings SET require_shift_claim_approval = true
WHERE restaurant_id = 'a1111111-1111-1111-1111-111111111111';
RESET ROLE;

SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"e3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);

SELECT is(
  (SELECT (result->>'success')::boolean FROM (
    SELECT claim_open_shift(
      'a1111111-1111-1111-1111-111111111111',
      'b1111111-1111-1111-1111-111111111111',
      '2026-11-01'::date,
      'c3333333-3333-3333-3333-333333333333'
    ) AS result
  ) sub),
  true,
  '2026-11-01: claim_open_shift (pending approval) returns success=true'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"e9999999-9999-9999-9999-999999999999","role":"authenticated"}', true);

SELECT is(
  (SELECT (result->>'success')::boolean FROM (
    SELECT approve_open_shift_claim(
      (SELECT id FROM open_shift_claims
       WHERE claimed_by_employee_id = 'c3333333-3333-3333-3333-333333333333'
         AND shift_date = '2026-11-01'::date
         AND status = 'pending_approval'
       LIMIT 1)
    ) AS result
  ) sub),
  true,
  '2026-11-01: approve_open_shift_claim returns success=true'
);

RESET ROLE;
SET LOCAL role TO postgres;

SELECT is(
  (SELECT start_time::timestamptz FROM shifts
   WHERE employee_id = 'c3333333-3333-3333-3333-333333333333' AND start_time::timestamptz = '2026-11-01T21:30:00Z'::timestamptz),
  '2026-11-01T21:30:00Z'::timestamptz,
  '2026-11-01: approve_open_shift_claim start_time matches independently-derived UTC instant'
);

SELECT is(
  (SELECT start_time::timestamptz FROM shifts WHERE employee_id = 'c3333333-3333-3333-3333-333333333333'
     AND start_time::timestamptz = '2026-11-01T21:30:00Z'::timestamptz),
  (SELECT start_time::timestamptz FROM shifts WHERE employee_id = 'c1111111-1111-1111-1111-111111111111'
     AND start_time::timestamptz = '2026-11-01T21:30:00Z'::timestamptz),
  '2026-11-01: approve_open_shift_claim agrees with the assign-template path'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
