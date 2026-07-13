-- ============================================================================
-- Test: directed shift_trades visibility (RLS)
--
-- Directed trades (target_employee_id set) must be private to the target,
-- offerer, and accepter — plus managers/owners/operations_managers who see
-- everything via the separate "Managers can view all shift trades" policy.
-- Today, Policy 1 ("Employees can view shift trades in their restaurant")
-- only checks restaurant membership, so ANY active employee (a bystander)
-- can read a directed trade. This test proves that gap (RED) and locks in
-- correct visibility once the follow-up migration tightens Policy 1 and
-- widens Policy 4 to operations_manager (GREEN).
--
-- Migration under test (not yet applied when this test is written):
--   supabase/migrations/<ts>_restrict_directed_shift_trade_visibility.sql
--
-- Design: docs/superpowers/specs/2026-07-13-shift-trade-directed-rls-design.md
-- Ticket: task_35a15d77
--
-- Fixture namespace: UUIDs starting with 53000000-...
-- Seeds: restaurant R1 + employees A(offerer)/B(target)/C(bystander),
--        R1 manager M (user_restaurants role=owner) and operations_manager O
--        (user_restaurants role=operations_manager), a second restaurant R2
--        + employee X. One DIRECTED trade (offered_by A, target B) and one
--        OPEN trade (offered_by A, target NULL), both on R1.
-- ============================================================================

BEGIN;
SELECT plan(12);

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
  ('53000000-0000-0000-0000-000000000001', 'Directed Trade RLS Restaurant'),
  ('53000000-0000-0000-0000-000000000002', 'Other Restaurant (Directed Trade RLS)')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Auth users: A(offerer), B(target), C(bystander), M(owner), O(ops_manager), X(other restaurant)
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('53000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'trade-a-53@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('53000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'trade-b-53@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('53000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'trade-c-53@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('53000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'trade-m-53@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('53000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'trade-o-53@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('53000000-0000-0000-0000-000000000016', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'trade-x-53@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Employees: A, B, C on R1; X on R2. M and O are manager-tier via user_restaurants
-- only (no employees row needed — Policy 4 doesn't require one).
INSERT INTO employees (id, restaurant_id, user_id, name, email, position, is_active) VALUES
  ('53000000-0000-0000-0000-000000000021', '53000000-0000-0000-0000-000000000001', '53000000-0000-0000-0000-000000000011', 'Offerer A', 'trade-a-53@test.com', 'Server', true),
  ('53000000-0000-0000-0000-000000000022', '53000000-0000-0000-0000-000000000001', '53000000-0000-0000-0000-000000000012', 'Target B', 'trade-b-53@test.com', 'Server', true),
  ('53000000-0000-0000-0000-000000000023', '53000000-0000-0000-0000-000000000001', '53000000-0000-0000-0000-000000000013', 'Bystander C', 'trade-c-53@test.com', 'Server', true),
  ('53000000-0000-0000-0000-000000000024', '53000000-0000-0000-0000-000000000002', '53000000-0000-0000-0000-000000000016', 'Other Restaurant X', 'trade-x-53@test.com', 'Server', true)
ON CONFLICT (id) DO UPDATE SET is_active = true;

-- Manager-tier memberships on R1: M is owner, O is operations_manager
INSERT INTO user_restaurants (id, user_id, restaurant_id, role) VALUES
  ('53000000-0000-0000-0000-000000000031', '53000000-0000-0000-0000-000000000014', '53000000-0000-0000-0000-000000000001', 'owner'),
  ('53000000-0000-0000-0000-000000000032', '53000000-0000-0000-0000-000000000015', '53000000-0000-0000-0000-000000000001', 'operations_manager')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- Two shifts owned by A (distinct shifts so both trades can be 'open'
-- simultaneously — idx_unique_active_trade_per_shift is per-shift, not per-employee)
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, break_duration) VALUES
  ('53000000-0000-0000-0000-000000000041', '53000000-0000-0000-0000-000000000001', '53000000-0000-0000-0000-000000000021', '2026-07-20 09:00:00+00', '2026-07-20 17:00:00+00', 'Server', 30),
  ('53000000-0000-0000-0000-000000000042', '53000000-0000-0000-0000-000000000001', '53000000-0000-0000-0000-000000000021', '2026-07-21 09:00:00+00', '2026-07-21 17:00:00+00', 'Server', 30)
ON CONFLICT (id) DO UPDATE SET position = 'Server';

DELETE FROM shift_trades WHERE restaurant_id IN (
  '53000000-0000-0000-0000-000000000001', '53000000-0000-0000-0000-000000000002'
);

-- DIRECTED trade: A offers shift1 to B specifically
INSERT INTO shift_trades (id, restaurant_id, offered_shift_id, offered_by_employee_id, target_employee_id, status)
  VALUES ('53000000-0000-0000-0000-000000000051', '53000000-0000-0000-0000-000000000001', '53000000-0000-0000-0000-000000000041', '53000000-0000-0000-0000-000000000021', '53000000-0000-0000-0000-000000000022', 'open');

-- OPEN (marketplace) trade: A offers shift2 to anyone
INSERT INTO shift_trades (id, restaurant_id, offered_shift_id, offered_by_employee_id, target_employee_id, status)
  VALUES ('53000000-0000-0000-0000-000000000052', '53000000-0000-0000-0000-000000000001', '53000000-0000-0000-0000-000000000042', '53000000-0000-0000-0000-000000000021', NULL, 'open');

-- CRITICAL: re-enable RLS on every table we disabled above before switching
-- to the authenticated role. The sibling 16_shift_trades_security.sql
-- disables shift_trades RLS for fixture setup and never re-enables it, so
-- its assertions pass vacuously. We must not repeat that mistake.
ALTER TABLE shift_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants ENABLE ROW LEVEL SECURITY;

RESET ROLE;

-- ============================================================================
-- Test 1: Bystander C sees the DIRECTED trade → 0 rows.
-- RED against current Policy 1 (restaurant-membership-only) — currently 1.
-- ============================================================================
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"53000000-0000-0000-0000-000000000013","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM shift_trades WHERE id = '53000000-0000-0000-0000-000000000051'),
  0::bigint,
  'Bystander C should NOT see a directed trade they are not party to'
);

-- ============================================================================
-- Test 2: Target B sees the DIRECTED trade → 1 row.
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"53000000-0000-0000-0000-000000000012","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM shift_trades WHERE id = '53000000-0000-0000-0000-000000000051'),
  1::bigint,
  'Target B should see the directed trade addressed to them'
);

-- ============================================================================
-- Test 3: Offerer A sees the DIRECTED trade → 1 row.
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"53000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM shift_trades WHERE id = '53000000-0000-0000-0000-000000000051'),
  1::bigint,
  'Offerer A should see the directed trade they posted'
);

-- ============================================================================
-- Test 4: Accepter case — mark B as the accepter of the directed trade, then
-- confirm B (target-and-accepter) still sees it → 1 row.
-- ============================================================================
RESET ROLE;
SET LOCAL role TO postgres;
UPDATE shift_trades
  SET accepted_by_employee_id = '53000000-0000-0000-0000-000000000022'
  WHERE id = '53000000-0000-0000-0000-000000000051';
RESET ROLE;

SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"53000000-0000-0000-0000-000000000012","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM shift_trades WHERE id = '53000000-0000-0000-0000-000000000051'),
  1::bigint,
  'Accepter B still sees the directed trade after accepting it'
);

-- ============================================================================
-- Test 5: Manager M sees the DIRECTED trade → 1 row (Policy 4).
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"53000000-0000-0000-0000-000000000014","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM shift_trades WHERE id = '53000000-0000-0000-0000-000000000051'),
  1::bigint,
  'Manager/owner M sees the directed trade via the manager policy'
);

-- ============================================================================
-- Test 6: Operations_manager O sees the DIRECTED trade → 1 row.
-- RED against current Policy 4 (role IN ('owner','manager') only) —
-- currently 0, since O has no employees row and isn't owner/manager.
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"53000000-0000-0000-0000-000000000015","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM shift_trades WHERE id = '53000000-0000-0000-0000-000000000051'),
  1::bigint,
  'Operations_manager O sees the directed trade (manager-tier visibility)'
);

-- ============================================================================
-- Test 7-9: OPEN (marketplace) trade stays visible to every active employee
-- of the restaurant — A, B, and C each see it.
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"53000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM shift_trades WHERE id = '53000000-0000-0000-0000-000000000052'),
  1::bigint,
  'Offerer A sees the open marketplace trade'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"53000000-0000-0000-0000-000000000012","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM shift_trades WHERE id = '53000000-0000-0000-0000-000000000052'),
  1::bigint,
  'Employee B sees the open marketplace trade'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"53000000-0000-0000-0000-000000000013","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM shift_trades WHERE id = '53000000-0000-0000-0000-000000000052'),
  1::bigint,
  'Bystander C sees the open marketplace trade (open trades are for everyone)'
);

-- ============================================================================
-- Test 10-11: Cross-restaurant isolation — employee X (restaurant R2) sees
-- neither the directed nor the open trade (both belong to R1).
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"53000000-0000-0000-0000-000000000016","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM shift_trades WHERE id = '53000000-0000-0000-0000-000000000051'),
  0::bigint,
  'Other-restaurant employee X does not see the directed trade'
);

SELECT is(
  (SELECT COUNT(*) FROM shift_trades WHERE id = '53000000-0000-0000-0000-000000000052'),
  0::bigint,
  'Other-restaurant employee X does not see the open trade'
);

-- ============================================================================
-- Test 12: Sanity — Policy 1 still exists and is still a SELECT policy
-- (the follow-up migration DROPs + recreates it under the same name).
-- ============================================================================
RESET ROLE;
SET LOCAL role TO postgres;

SELECT policy_cmd_is(
  'public',
  'shift_trades',
  'Employees can view shift trades in their restaurant',
  'select',
  'Policy 1 should still exist as a SELECT policy on shift_trades'
);

-- ============================================================================
-- Cleanup
-- ============================================================================
SELECT * FROM finish();
ROLLBACK;
