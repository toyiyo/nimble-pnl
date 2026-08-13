-- ============================================================================
-- Test: create_shift_trade_for_employee authorization and validation.
--
-- create_shift_trade_for_employee(p_restaurant_id, p_offered_shift_id,
--   p_offered_by_employee_id, p_target_employee_id DEFAULT NULL,
--   p_reason DEFAULT NULL) RETURNS uuid is SECURITY DEFINER + GRANTed to
-- authenticated. It lets an owner or a manager post an employee's shift for
-- trade. It must reject any other caller (staff, no membership, wrong
-- restaurant), reject a non-tradeable shift status, reject an invalid directed
-- target, and reject a second active trade on the same shift.
--
-- This test impersonates callers via `SET LOCAL ROLE authenticated` +
-- request.jwt.claims so it exercises the real authenticated-role GRANT
-- boundary (the same pattern as 54_accept_shift_trade_authz.sql).
--
-- Fixture namespace: UUIDs starting with 55000000-...
--   Restaurants: R1 (owner O, staff ST); R2 (manager M2).
--   Employees on R1: empA (offerer), empB (active coworker),
--                    empBInactive (inactive coworker). Employee on R2: empX.
--   Shifts owned by empA on R1: shift1..shift4 (shift3 is 'cancelled').
--   Every allow scenario uses its own shift so an earlier insert never
--   changes a later scenario's starting state.
-- ============================================================================

BEGIN;
SELECT plan(10);

-- ============================================================================
-- Setup (as postgres/superuser — bypasses RLS regardless of enable state)
-- ============================================================================
SET LOCAL role TO postgres;

ALTER TABLE shift_trades DISABLE ROW LEVEL SECURITY;
ALTER TABLE shifts DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;

-- Restaurants
INSERT INTO restaurants (id, name) VALUES
  ('55000000-0000-0000-0000-000000000001', 'Manager Trade Restaurant'),
  ('55000000-0000-0000-0000-000000000002', 'Other Restaurant (Manager Trade)')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Auth users: O (owner R1), ST (staff R1), NM (no membership), M2 (manager R2)
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('55000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mtrade-o-55@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('55000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mtrade-st-55@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('55000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mtrade-nm-55@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('55000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mtrade-m2-55@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Employees: empA/empB/empBInactive on R1; empX on R2
-- status must stay in sync with is_active (employees_status_active_sync).
INSERT INTO employees (id, restaurant_id, user_id, name, email, position, is_active, status) VALUES
  ('55000000-0000-0000-0000-000000000021', '55000000-0000-0000-0000-000000000001', NULL, 'Offerer A', 'mtrade-a-55@test.com', 'Server', true, 'active'),
  ('55000000-0000-0000-0000-000000000022', '55000000-0000-0000-0000-000000000001', NULL, 'Coworker B', 'mtrade-b-55@test.com', 'Server', true, 'active'),
  ('55000000-0000-0000-0000-000000000023', '55000000-0000-0000-0000-000000000001', NULL, 'Inactive B2', 'mtrade-b2-55@test.com', 'Server', false, 'inactive'),
  ('55000000-0000-0000-0000-000000000024', '55000000-0000-0000-0000-000000000002', NULL, 'Other Restaurant X', 'mtrade-x-55@test.com', 'Server', true, 'active')
ON CONFLICT (id) DO UPDATE SET is_active = EXCLUDED.is_active, status = EXCLUDED.status;

-- Memberships: O owner of R1, ST staff of R1, M2 manager of R2. NM has none.
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('55000000-0000-0000-0000-000000000011', '55000000-0000-0000-0000-000000000001', 'owner'),
  ('55000000-0000-0000-0000-000000000012', '55000000-0000-0000-0000-000000000001', 'staff'),
  ('55000000-0000-0000-0000-000000000014', '55000000-0000-0000-0000-000000000002', 'manager')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- Four shifts owned by empA on R1. shift3 is cancelled (non-tradeable).
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, break_duration, status) VALUES
  ('55000000-0000-0000-0000-000000000041', '55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000021', '2026-09-01 09:00:00+00', '2026-09-01 17:00:00+00', 'Server', 30, 'scheduled'),
  ('55000000-0000-0000-0000-000000000042', '55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000021', '2026-09-02 09:00:00+00', '2026-09-02 17:00:00+00', 'Server', 30, 'scheduled'),
  ('55000000-0000-0000-0000-000000000043', '55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000021', '2026-09-03 09:00:00+00', '2026-09-03 17:00:00+00', 'Server', 30, 'cancelled'),
  ('55000000-0000-0000-0000-000000000044', '55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000021', '2026-09-04 09:00:00+00', '2026-09-04 17:00:00+00', 'Server', 30, 'scheduled')
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status;

DELETE FROM shift_trades WHERE restaurant_id IN (
  '55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000002'
);

-- CRITICAL: re-enable RLS on every table before switching to authenticated.
ALTER TABLE shift_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants ENABLE ROW LEVEL SECURITY;

RESET ROLE;

-- ============================================================================
-- Scenario 1 (assertions 1-2): Owner O posts a marketplace trade for empA's
-- shift1. Must succeed and create one OPEN trade with a NULL target.
-- ============================================================================
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"55000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

SELECT lives_ok(
  $$ SELECT create_shift_trade_for_employee('55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000041', '55000000-0000-0000-0000-000000000021') $$,
  'Scenario 1: owner can post a marketplace trade for an employee'
);

RESET ROLE;
SET LOCAL role TO postgres;
SELECT is(
  (SELECT count(*)::int FROM shift_trades WHERE offered_shift_id = '55000000-0000-0000-0000-000000000041' AND status = 'open' AND target_employee_id IS NULL),
  1,
  'Scenario 1: one open marketplace trade exists for shift1'
);

-- ============================================================================
-- Scenario 2 (assertions 3-4): Owner O posts a directed trade to empB for
-- shift2. Must succeed and record target_employee_id = empB.
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"55000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

SELECT lives_ok(
  $$ SELECT create_shift_trade_for_employee('55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000042', '55000000-0000-0000-0000-000000000021', '55000000-0000-0000-0000-000000000022') $$,
  'Scenario 2: owner can post a directed trade to a coworker'
);

RESET ROLE;
SET LOCAL role TO postgres;
SELECT is(
  (SELECT target_employee_id FROM shift_trades WHERE offered_shift_id = '55000000-0000-0000-0000-000000000042'),
  '55000000-0000-0000-0000-000000000022'::uuid,
  'Scenario 2: directed trade records the target coworker'
);

-- ============================================================================
-- Scenario 3 (assertion 5): Staff ST posts for shift4 -> denied (authz).
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"55000000-0000-0000-0000-000000000012","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT create_shift_trade_for_employee('55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000044', '55000000-0000-0000-0000-000000000021') $$,
  'P0001', NULL,
  'Scenario 3: staff cannot post a trade for an employee'
);

-- ============================================================================
-- Scenario 4 (assertion 6): No-membership user NM posts for shift4 -> denied
-- (NULL-safe role check). A plain NOT IN would fail open here.
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"55000000-0000-0000-0000-000000000015","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT create_shift_trade_for_employee('55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000044', '55000000-0000-0000-0000-000000000021') $$,
  'P0001', NULL,
  'Scenario 4: a caller with no membership cannot post a trade'
);

-- ============================================================================
-- Scenario 5 (assertion 7): Owner O posts for shift3 (cancelled) -> denied
-- (status allow-list).
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"55000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT create_shift_trade_for_employee('55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000043', '55000000-0000-0000-0000-000000000021') $$,
  'P0001', NULL,
  'Scenario 5: a cancelled shift cannot be traded'
);

-- ============================================================================
-- Scenario 6 (assertion 8): Owner O posts a SECOND trade for shift1, which
-- already has an active trade from scenario 1 -> denied (unique_violation).
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"55000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT create_shift_trade_for_employee('55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000041', '55000000-0000-0000-0000-000000000021') $$,
  'P0001', NULL,
  'Scenario 6: a shift with an active trade cannot be posted again'
);

-- ============================================================================
-- Scenario 7 (assertion 9): Owner O posts a directed trade to empBInactive
-- for shift4 -> denied (inactive target).
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"55000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT create_shift_trade_for_employee('55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000044', '55000000-0000-0000-0000-000000000021', '55000000-0000-0000-0000-000000000023') $$,
  'P0001', NULL,
  'Scenario 7: a directed trade to an inactive coworker is rejected'
);

-- ============================================================================
-- Scenario 8 (assertion 10): M2 (manager of R2 only) posts for an R1 shift
-- with p_restaurant_id = R1 -> denied (no R1 membership -> NULL role).
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"55000000-0000-0000-0000-000000000014","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT create_shift_trade_for_employee('55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000044', '55000000-0000-0000-0000-000000000021') $$,
  'P0001', NULL,
  'Scenario 8: a manager of another restaurant cannot post a trade here'
);

-- ============================================================================
-- Cleanup
-- ============================================================================
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
