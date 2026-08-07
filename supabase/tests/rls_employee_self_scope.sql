-- ============================================================================
-- Test: employee self-scoped reads on the six per-employee payroll/scheduling
-- tables (RLS)
--
-- Today each of these six tables carries a single SELECT policy that checks
-- restaurant *membership* only, so ANY active employee (including staff) can
-- read every other employee's row. This test proves that gap (RED) for a
-- staff subject and locks in correct visibility once the follow-up migration
-- replaces the membership-only policy with an own-row clause plus a
-- `view:scheduling OR view:payroll` privileged clause (GREEN).
--
-- Design: docs/superpowers/specs/2026-08-05-employee-self-scoped-data-design.md
-- Plan:   docs/superpowers/plans/2026-08-05-employee-self-scoped-data-plan.md
--
-- Fixture namespace: UUIDs starting with 70000000-...
-- Seeds: restaurant R1; staff S and coworker CW (both `employees` rows +
--        `user_restaurants` role='staff'); a `chef` member C (no employees
--        row — isolates the view:scheduling arm); a collaborator_accountant
--        member A (no employees row — isolates the view:payroll arm); a
--        manager member M (holds BOTH capabilities, so per the plan it is
--        NOT used to isolate either arm — included only because the plan
--        lists it as a required fixture).
--
-- Six tables, one row owned by S and one by CW each: shifts,
-- employee_compensation_history, time_punches, employee_tips,
-- overtime_adjustments, daily_labor_allocations.
--
-- shifts also gets a dedicated shift-trade case: a staff user must reach a
-- coworker's shift ONLY when a shift_trades row references it (via
-- offered_shift_id or requested_shift_id) — exercising the third "shifts
-- needs a shift-trade clause" policy this design adds. The baseline CW shift
-- (no trade referencing it) doubles as the "no trade -> not visible" case.
-- ============================================================================

BEGIN;
SELECT plan(26);

-- ============================================================================
-- Setup (as postgres/superuser — bypasses RLS regardless of enable state)
-- ============================================================================
SET LOCAL role TO postgres;

ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE shifts DISABLE ROW LEVEL SECURITY;
ALTER TABLE shift_trades DISABLE ROW LEVEL SECURITY;
ALTER TABLE employee_compensation_history DISABLE ROW LEVEL SECURITY;
ALTER TABLE time_punches DISABLE ROW LEVEL SECURITY;
ALTER TABLE employee_tips DISABLE ROW LEVEL SECURITY;
ALTER TABLE overtime_adjustments DISABLE ROW LEVEL SECURITY;
ALTER TABLE daily_labor_allocations DISABLE ROW LEVEL SECURITY;

-- Restaurant
INSERT INTO restaurants (id, name) VALUES
  ('70000000-0000-0000-0000-000000000001', 'Employee Self-Scope RLS Restaurant')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Auth users: S(staff), CW(coworker/staff), C(chef), A(collaborator_accountant), M(manager)
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('70000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ess-staff-70@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('70000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ess-coworker-70@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('70000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ess-chef-70@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('70000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ess-accountant-70@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('70000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ess-manager-70@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Employees: only S and CW need employees rows. Chef/accountant/manager are
-- pure user_restaurants members here — the six tables' own-row clause joins
-- through `employees`, so a subject with no employees row can only ever
-- reach a row via the privileged clause, which is exactly what isolates the
-- capability arms.
INSERT INTO employees (id, restaurant_id, user_id, name, email, position, is_active) VALUES
  ('70000000-0000-0000-0000-000000000021', '70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000011', 'Staff S', 'ess-staff-70@test.com', 'Server', true),
  ('70000000-0000-0000-0000-000000000022', '70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000012', 'Coworker CW', 'ess-coworker-70@test.com', 'Server', true)
ON CONFLICT (id) DO UPDATE SET is_active = true;

-- Memberships: S and CW are legacy-role 'staff' (also required for the
-- shifts/other membership-only policy and for user_has_capability's legacy
-- CASE fallback); C is 'chef' (view:scheduling, NOT view:payroll); A is
-- 'collaborator_accountant' (view:payroll, NOT view:scheduling); M is
-- 'manager' (holds both — included as a fixture only, unused for isolation).
INSERT INTO user_restaurants (id, user_id, restaurant_id, role) VALUES
  ('70000000-0000-0000-0000-000000000031', '70000000-0000-0000-0000-000000000011', '70000000-0000-0000-0000-000000000001', 'staff'),
  ('70000000-0000-0000-0000-000000000032', '70000000-0000-0000-0000-000000000012', '70000000-0000-0000-0000-000000000001', 'staff'),
  ('70000000-0000-0000-0000-000000000033', '70000000-0000-0000-0000-000000000013', '70000000-0000-0000-0000-000000000001', 'chef'),
  ('70000000-0000-0000-0000-000000000034', '70000000-0000-0000-0000-000000000014', '70000000-0000-0000-0000-000000000001', 'collaborator_accountant'),
  ('70000000-0000-0000-0000-000000000035', '70000000-0000-0000-0000-000000000015', '70000000-0000-0000-0000-000000000001', 'manager')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- ----------------------------------------------------------------------------
-- shifts: S's own shift, CW's baseline shift (no trade referencing it), plus
-- two more CW shifts that are ONLY reachable through a shift_trades row.
-- ----------------------------------------------------------------------------
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, break_duration) VALUES
  ('70000000-0000-0000-0000-000000000041', '70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000021', '2026-08-10 09:00:00+00', '2026-08-10 17:00:00+00', 'Server', 30),
  ('70000000-0000-0000-0000-000000000042', '70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000022', '2026-08-11 09:00:00+00', '2026-08-11 17:00:00+00', 'Server', 30),
  ('70000000-0000-0000-0000-000000000043', '70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000022', '2026-08-12 09:00:00+00', '2026-08-12 17:00:00+00', 'Server', 30),
  ('70000000-0000-0000-0000-000000000044', '70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000022', '2026-08-13 09:00:00+00', '2026-08-13 17:00:00+00', 'Server', 30)
ON CONFLICT (id) DO UPDATE SET position = 'Server';

DELETE FROM shift_trades WHERE restaurant_id = '70000000-0000-0000-0000-000000000001';

-- OPEN trade (target NULL): CW offers shift ...043 to the marketplace.
-- Visible to S via shift_trades' own "active employee, open trade" policy,
-- so it isolates the shifts.offered_shift_id clause rather than assuming it.
INSERT INTO shift_trades (id, restaurant_id, offered_shift_id, offered_by_employee_id, requested_shift_id, target_employee_id, status) VALUES
  ('70000000-0000-0000-0000-000000000051', '70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000043', '70000000-0000-0000-0000-000000000022', NULL, NULL, 'open');

-- OPEN trade (target NULL): S offers their own shift ...041 and directly
-- requests CW's shift ...044 in return. `requested_shift_id` is never
-- written by application code today (design §5.2) — inserted directly here
-- to exercise that arm of the shifts policy.
INSERT INTO shift_trades (id, restaurant_id, offered_shift_id, offered_by_employee_id, requested_shift_id, target_employee_id, status) VALUES
  ('70000000-0000-0000-0000-000000000052', '70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000041', '70000000-0000-0000-0000-000000000021', '70000000-0000-0000-0000-000000000044', NULL, 'open');

-- ----------------------------------------------------------------------------
-- employee_compensation_history
-- ----------------------------------------------------------------------------
INSERT INTO employee_compensation_history (id, employee_id, restaurant_id, compensation_type, amount_cents, effective_date) VALUES
  ('70000000-0000-0000-0000-000000000061', '70000000-0000-0000-0000-000000000021', '70000000-0000-0000-0000-000000000001', 'hourly', 2000, '2026-08-01'),
  ('70000000-0000-0000-0000-000000000062', '70000000-0000-0000-0000-000000000022', '70000000-0000-0000-0000-000000000001', 'hourly', 2200, '2026-08-01')
ON CONFLICT (id) DO UPDATE SET amount_cents = EXCLUDED.amount_cents;

-- ----------------------------------------------------------------------------
-- time_punches
-- ----------------------------------------------------------------------------
INSERT INTO time_punches (id, restaurant_id, employee_id, punch_type, punch_time) VALUES
  ('70000000-0000-0000-0000-000000000071', '70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000021', 'clock_in', '2026-08-10 09:00:00+00'),
  ('70000000-0000-0000-0000-000000000072', '70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000022', 'clock_in', '2026-08-11 09:00:00+00')
ON CONFLICT (id) DO UPDATE SET punch_time = EXCLUDED.punch_time;

-- ----------------------------------------------------------------------------
-- employee_tips
-- ----------------------------------------------------------------------------
INSERT INTO employee_tips (id, restaurant_id, employee_id, tip_amount, tip_source, recorded_at) VALUES
  ('70000000-0000-0000-0000-000000000081', '70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000021', 1000, 'cash', '2026-08-10 20:00:00+00'),
  ('70000000-0000-0000-0000-000000000082', '70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000022', 1500, 'cash', '2026-08-11 20:00:00+00')
ON CONFLICT (id) DO UPDATE SET tip_amount = EXCLUDED.tip_amount;

-- ----------------------------------------------------------------------------
-- overtime_adjustments
-- ----------------------------------------------------------------------------
INSERT INTO overtime_adjustments (id, restaurant_id, employee_id, punch_date, adjustment_type, hours, adjusted_by) VALUES
  ('70000000-0000-0000-0000-000000000091', '70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000021', '2026-08-10', 'regular_to_overtime', 2.0, '70000000-0000-0000-0000-000000000015'),
  ('70000000-0000-0000-0000-000000000092', '70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000022', '2026-08-11', 'regular_to_overtime', 2.5, '70000000-0000-0000-0000-000000000015')
ON CONFLICT (id) DO UPDATE SET hours = EXCLUDED.hours;

-- ----------------------------------------------------------------------------
-- daily_labor_allocations
-- ----------------------------------------------------------------------------
INSERT INTO daily_labor_allocations (id, restaurant_id, employee_id, date, allocated_cost, compensation_type, source) VALUES
  ('70000000-0000-0000-0000-000000000101', '70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000021', '2026-08-10', 5000, 'salary', 'per-job'),
  ('70000000-0000-0000-0000-000000000102', '70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000022', '2026-08-11', 5500, 'salary', 'per-job')
ON CONFLICT (id) DO UPDATE SET allocated_cost = EXCLUDED.allocated_cost;

-- CRITICAL: re-enable RLS on every table we disabled above before switching
-- to the authenticated role (see 53_directed_shift_trade_rls.sql's own
-- warning about the sibling test that forgot this and passed vacuously).
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_compensation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_punches ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_tips ENABLE ROW LEVEL SECURITY;
ALTER TABLE overtime_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_labor_allocations ENABLE ROW LEVEL SECURITY;

RESET ROLE;

-- ============================================================================
-- shifts (6 assertions: the generic 4 + the two shift-trade-only arms)
-- ============================================================================
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM shifts WHERE id = '70000000-0000-0000-0000-000000000041'),
  1::bigint,
  'shifts: staff S sees own shift'
);

SELECT is(
  (SELECT COUNT(*) FROM shifts WHERE id = '70000000-0000-0000-0000-000000000042'),
  0::bigint,
  'shifts: staff S does NOT see coworker CW''s untraded shift (the fix)'
);

SELECT is(
  (SELECT COUNT(*) FROM shifts WHERE id = '70000000-0000-0000-0000-000000000043'),
  1::bigint,
  'shifts: staff S sees CW''s shift referenced by shift_trades.offered_shift_id'
);

SELECT is(
  (SELECT COUNT(*) FROM shifts WHERE id = '70000000-0000-0000-0000-000000000044'),
  1::bigint,
  'shifts: staff S sees CW''s shift referenced by shift_trades.requested_shift_id'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000013","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM shifts WHERE id IN ('70000000-0000-0000-0000-000000000041', '70000000-0000-0000-0000-000000000042')),
  2::bigint,
  'shifts: chef (view:scheduling only) sees both S and CW rows'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000014","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM shifts WHERE id IN ('70000000-0000-0000-0000-000000000041', '70000000-0000-0000-0000-000000000042')),
  2::bigint,
  'shifts: collaborator_accountant (view:payroll only) sees both S and CW rows'
);

-- ============================================================================
-- employee_compensation_history
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM employee_compensation_history WHERE id = '70000000-0000-0000-0000-000000000061'),
  1::bigint,
  'employee_compensation_history: staff S sees own row'
);

SELECT is(
  (SELECT COUNT(*) FROM employee_compensation_history WHERE id = '70000000-0000-0000-0000-000000000062'),
  0::bigint,
  'employee_compensation_history: staff S does NOT see coworker CW''s row (the fix)'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000013","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM employee_compensation_history WHERE id IN ('70000000-0000-0000-0000-000000000061', '70000000-0000-0000-0000-000000000062')),
  2::bigint,
  'employee_compensation_history: chef (view:scheduling only) sees both rows'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000014","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM employee_compensation_history WHERE id IN ('70000000-0000-0000-0000-000000000061', '70000000-0000-0000-0000-000000000062')),
  2::bigint,
  'employee_compensation_history: collaborator_accountant (view:payroll only) sees both rows'
);

-- ============================================================================
-- time_punches
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM time_punches WHERE id = '70000000-0000-0000-0000-000000000071'),
  1::bigint,
  'time_punches: staff S sees own row'
);

SELECT is(
  (SELECT COUNT(*) FROM time_punches WHERE id = '70000000-0000-0000-0000-000000000072'),
  0::bigint,
  'time_punches: staff S does NOT see coworker CW''s row (the fix)'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000013","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM time_punches WHERE id IN ('70000000-0000-0000-0000-000000000071', '70000000-0000-0000-0000-000000000072')),
  2::bigint,
  'time_punches: chef (view:scheduling only) sees both rows'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000014","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM time_punches WHERE id IN ('70000000-0000-0000-0000-000000000071', '70000000-0000-0000-0000-000000000072')),
  2::bigint,
  'time_punches: collaborator_accountant (view:payroll only) sees both rows'
);

-- ============================================================================
-- employee_tips
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM employee_tips WHERE id = '70000000-0000-0000-0000-000000000081'),
  1::bigint,
  'employee_tips: staff S sees own row'
);

SELECT is(
  (SELECT COUNT(*) FROM employee_tips WHERE id = '70000000-0000-0000-0000-000000000082'),
  0::bigint,
  'employee_tips: staff S does NOT see coworker CW''s row (the fix)'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000013","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM employee_tips WHERE id IN ('70000000-0000-0000-0000-000000000081', '70000000-0000-0000-0000-000000000082')),
  2::bigint,
  'employee_tips: chef (view:scheduling only) sees both rows'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000014","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM employee_tips WHERE id IN ('70000000-0000-0000-0000-000000000081', '70000000-0000-0000-0000-000000000082')),
  2::bigint,
  'employee_tips: collaborator_accountant (view:payroll only) sees both rows'
);

-- ============================================================================
-- overtime_adjustments
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM overtime_adjustments WHERE id = '70000000-0000-0000-0000-000000000091'),
  1::bigint,
  'overtime_adjustments: staff S sees own row'
);

SELECT is(
  (SELECT COUNT(*) FROM overtime_adjustments WHERE id = '70000000-0000-0000-0000-000000000092'),
  0::bigint,
  'overtime_adjustments: staff S does NOT see coworker CW''s row (the fix)'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000013","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM overtime_adjustments WHERE id IN ('70000000-0000-0000-0000-000000000091', '70000000-0000-0000-0000-000000000092')),
  2::bigint,
  'overtime_adjustments: chef (view:scheduling only) sees both rows'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000014","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM overtime_adjustments WHERE id IN ('70000000-0000-0000-0000-000000000091', '70000000-0000-0000-0000-000000000092')),
  2::bigint,
  'overtime_adjustments: collaborator_accountant (view:payroll only) sees both rows'
);

-- ============================================================================
-- daily_labor_allocations
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM daily_labor_allocations WHERE id = '70000000-0000-0000-0000-000000000101'),
  1::bigint,
  'daily_labor_allocations: staff S sees own row'
);

SELECT is(
  (SELECT COUNT(*) FROM daily_labor_allocations WHERE id = '70000000-0000-0000-0000-000000000102'),
  0::bigint,
  'daily_labor_allocations: staff S does NOT see coworker CW''s row (the fix)'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000013","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM daily_labor_allocations WHERE id IN ('70000000-0000-0000-0000-000000000101', '70000000-0000-0000-0000-000000000102')),
  2::bigint,
  'daily_labor_allocations: chef (view:scheduling only) sees both rows'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000014","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM daily_labor_allocations WHERE id IN ('70000000-0000-0000-0000-000000000101', '70000000-0000-0000-0000-000000000102')),
  2::bigint,
  'daily_labor_allocations: collaborator_accountant (view:payroll only) sees both rows'
);

-- ============================================================================
-- Cleanup
-- ============================================================================
SELECT * FROM finish();
ROLLBACK;
