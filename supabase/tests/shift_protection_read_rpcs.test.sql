-- ============================================================================
-- Test: Shift Protection read RPCs
--
-- get_shift_protection_settings — members and active employees read the
--   knobs; outsiders are denied.
-- get_timeoff_day_counts — the owner-of-employee branch binds to
--   p_restaurant_id (no cross-tenant read); counts are per day, approved
--   only, same position only, other employees only.
-- get_timeoff_coverage_impact — edit:scheduling only; a bad request id
--   fails with the same error as a real one (no existence oracle).
--
-- Migration under test: 20260903034600_shift_protection_read_rpcs.sql
-- Design: docs/superpowers/specs/2026-09-03-shift-protection-design.md
--
-- Fixture namespace: UUIDs starting with 72000000-...
-- Function calls run as postgres and impersonate via
-- set_config('request.jwt.claims', ...) — every function under test is
-- SECURITY DEFINER, so its internal guard is what is under test.
-- ============================================================================

BEGIN;
SELECT plan(13);

-- ============================================================================
-- Setup
-- ============================================================================
SET LOCAL role TO postgres;

ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE staffing_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE time_off_requests DISABLE ROW LEVEL SECURITY;
ALTER TABLE shifts DISABLE ROW LEVEL SECURITY;
ALTER TABLE shift_templates DISABLE ROW LEVEL SECURITY;

INSERT INTO restaurants (id, name, timezone) VALUES
  ('72000000-0000-0000-0000-000000000001', 'Read RPC Restaurant A', 'America/Chicago'),
  ('72000000-0000-0000-0000-000000000002', 'Read RPC Restaurant B', 'America/Chicago')
ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

-- Users: M (owner of A), E1 (employee in A), OUT (no rows anywhere)
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('72000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sp-m-72@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('72000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sp-e1-72@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('72000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sp-out-72@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_restaurants (id, user_id, restaurant_id, role) VALUES
  ('72000000-0000-0000-0000-000000000031', '72000000-0000-0000-0000-000000000011', '72000000-0000-0000-0000-000000000001', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- Employees in A: E1/E2/E3 Servers, E4 Cook. Only E1 has a user account.
INSERT INTO employees (id, restaurant_id, user_id, name, email, position, is_active) VALUES
  ('72000000-0000-0000-0000-000000000021', '72000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000012', 'Server E1', 'sp-e1-72@test.com', 'Server', true),
  ('72000000-0000-0000-0000-000000000022', '72000000-0000-0000-0000-000000000001', NULL, 'Server E2', 'sp-e2-72@test.com', 'Server', true),
  ('72000000-0000-0000-0000-000000000023', '72000000-0000-0000-0000-000000000001', NULL, 'Server E3', 'sp-e3-72@test.com', 'Server', true),
  ('72000000-0000-0000-0000-000000000024', '72000000-0000-0000-0000-000000000001', NULL, 'Cook E4', 'sp-e4-72@test.com', 'Cook', true)
ON CONFLICT (id) DO UPDATE SET is_active = true;

-- Time off: E2 + E3 approved over Oct 10-11 (Servers), E4 approved (Cook),
-- E3 also has a PENDING row (must not raise the count), E1 has a pending
-- request Oct 10-11 (the coverage-impact subject).
DELETE FROM time_off_requests WHERE restaurant_id IN
  ('72000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000002');
INSERT INTO time_off_requests (id, restaurant_id, employee_id, start_date, end_date, status) VALUES
  ('72000000-0000-0000-0000-000000000041', '72000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000022', '2026-10-10', '2026-10-11', 'approved'),
  ('72000000-0000-0000-0000-000000000042', '72000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000023', '2026-10-09', '2026-10-10', 'approved'),
  ('72000000-0000-0000-0000-000000000043', '72000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000024', '2026-10-10', '2026-10-10', 'approved'),
  ('72000000-0000-0000-0000-000000000044', '72000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000023', '2026-10-12', '2026-10-12', 'pending'),
  ('72000000-0000-0000-0000-000000000045', '72000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000021', '2026-10-10', '2026-10-11', 'pending');

-- Coverage fixture: a Server template with capacity 2, E1 + E2 overlapping
-- Server shifts on Oct 10 (17:00-23:00 UTC = noon-6pm Chicago).
INSERT INTO shift_templates (id, restaurant_id, name, start_time, end_time, position, capacity) VALUES
  ('72000000-0000-0000-0000-000000000051', '72000000-0000-0000-0000-000000000001', 'SP Dinner Server', '12:00', '18:00', 'Server', 2)
ON CONFLICT (id) DO UPDATE SET capacity = 2;

INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, break_duration, status, shift_template_id) VALUES
  ('72000000-0000-0000-0000-000000000061', '72000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000021', '2026-10-10 17:00:00+00', '2026-10-10 23:00:00+00', 'Server', 30, 'scheduled', '72000000-0000-0000-0000-000000000051'),
  ('72000000-0000-0000-0000-000000000062', '72000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000022', '2026-10-10 17:00:00+00', '2026-10-10 23:00:00+00', 'Server', 30, 'scheduled', NULL)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE staffing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_off_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_templates ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- get_shift_protection_settings
-- ============================================================================

-- 1. Active employee reads the defaults (no settings row exists yet).
SELECT set_config('request.jwt.claims', '{"sub":"72000000-0000-0000-0000-000000000012","role":"authenticated"}', true);
SELECT is(
  (SELECT get_shift_protection_settings('72000000-0000-0000-0000-000000000001')->>'trade_deadline_mode'),
  'off',
  'active employee reads the default rules when no settings row exists'
);

-- Insert a settings row with warn modes.
DELETE FROM staffing_settings WHERE restaurant_id = '72000000-0000-0000-0000-000000000001';
INSERT INTO staffing_settings (restaurant_id, timeoff_notice_mode, timeoff_notice_days)
VALUES ('72000000-0000-0000-0000-000000000001', 'warn', 10);

-- 2. Member reads the stored values.
SELECT set_config('request.jwt.claims', '{"sub":"72000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
SELECT is(
  (SELECT get_shift_protection_settings('72000000-0000-0000-0000-000000000001')->>'timeoff_notice_days'),
  '10',
  'member reads the stored notice days'
);

-- 3. Outsider is denied.
SELECT set_config('request.jwt.claims', '{"sub":"72000000-0000-0000-0000-000000000013","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT get_shift_protection_settings('72000000-0000-0000-0000-000000000001')$$,
  'P0001',
  'Unauthorized',
  'outsider cannot read the rules'
);

-- ============================================================================
-- get_timeoff_day_counts
-- ============================================================================

-- 4. E1 reads own counts: Oct 10 has two other approved Servers (E2, E3).
SELECT set_config('request.jwt.claims', '{"sub":"72000000-0000-0000-0000-000000000012","role":"authenticated"}', true);
SELECT is(
  (SELECT approved_count FROM get_timeoff_day_counts(
     '72000000-0000-0000-0000-000000000001',
     '72000000-0000-0000-0000-000000000021',
     '2026-10-10', '2026-10-12') WHERE day = '2026-10-10'),
  2,
  'two other approved same-position requests count on Oct 10'
);

-- 5. Oct 12 has only a pending request — count 0.
SELECT is(
  (SELECT approved_count FROM get_timeoff_day_counts(
     '72000000-0000-0000-0000-000000000001',
     '72000000-0000-0000-0000-000000000021',
     '2026-10-10', '2026-10-12') WHERE day = '2026-10-12'),
  0,
  'a pending request does not raise the count'
);

-- 6. Cross-tenant: E1 owns an employee row in A only; restaurant B is denied.
SELECT throws_ok(
  $$SELECT * FROM get_timeoff_day_counts(
      '72000000-0000-0000-0000-000000000002',
      '72000000-0000-0000-0000-000000000021',
      '2026-10-10', '2026-10-11')$$,
  'P0001',
  'Unauthorized',
  'an employee of restaurant A cannot read counts for restaurant B'
);

-- 7. E1 cannot pass another employee id without the capability.
SELECT throws_ok(
  $$SELECT * FROM get_timeoff_day_counts(
      '72000000-0000-0000-0000-000000000001',
      '72000000-0000-0000-0000-000000000022',
      '2026-10-10', '2026-10-11')$$,
  'P0001',
  'Unauthorized',
  'an employee cannot read counts for a coworker'
);

-- 8. Manager reads the Cook's counts: no other approved Cook — 0.
SELECT set_config('request.jwt.claims', '{"sub":"72000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
SELECT is(
  (SELECT approved_count FROM get_timeoff_day_counts(
     '72000000-0000-0000-0000-000000000001',
     '72000000-0000-0000-0000-000000000024',
     '2026-10-10', '2026-10-10') WHERE day = '2026-10-10'),
  0,
  'position filter: Server requests do not count for a Cook'
);

-- ============================================================================
-- get_timeoff_coverage_impact
-- ============================================================================

-- 9-11. Manager reads the impact of E1's pending request.
SELECT is(
  (SELECT jsonb_array_length(get_timeoff_coverage_impact('72000000-0000-0000-0000-000000000045')->'shifts')),
  1,
  'one affected shift inside the request range'
);

SELECT is(
  (SELECT (s->>'required') || '/' || (s->>'current_count') || '/' || (s->>'after_count')
   FROM jsonb_array_elements(get_timeoff_coverage_impact('72000000-0000-0000-0000-000000000045')->'shifts') s
   LIMIT 1),
  '2/2/1',
  'coverage math: required 2, current 2, after 1'
);

SELECT is(
  (SELECT (get_timeoff_coverage_impact('72000000-0000-0000-0000-000000000045')->>'overlapping_approved')::integer),
  3,
  'three other approved requests overlap the range'
);

-- 12. A caller without edit:scheduling is denied.
SELECT set_config('request.jwt.claims', '{"sub":"72000000-0000-0000-0000-000000000012","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT get_timeoff_coverage_impact('72000000-0000-0000-0000-000000000045')$$,
  'P0001',
  'Unauthorized: schedule manage access required',
  'a plain employee cannot read the coverage impact'
);

-- 13. A random id fails with the same error — no existence oracle.
SELECT throws_ok(
  $$SELECT get_timeoff_coverage_impact('72000000-0000-0000-0000-000000000099')$$,
  'P0001',
  'Unauthorized: schedule manage access required',
  'a random request id fails with the same error'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
