-- ============================================================================
-- Test: trade approval moves to the edit:scheduling capability
--
-- approve_shift_trade, reject_shift_trade, and the shift_trades RLS
-- policies now gate on user_has_capability(restaurant_id, 'edit:scheduling')
-- instead of a hardcoded owner/manager role check. This covers every
-- audience shape that check now admits or still denies:
--   1. A custom role at scheduling:manage (edit:scheduling) — approve,
--      reject, SELECT (all trades), and DELETE all succeed.
--   2. A custom role at scheduling:view only (view:scheduling, NOT
--      edit:scheduling) — approve, reject, SELECT (non-participant), and
--      DELETE all fail closed.
--   3. A legacy operations_manager (role_id NULL) — approve succeeds,
--      confirming the legacy CASE fallback still grants edit:scheduling to
--      this role string.
--   4. A caller with no user_restaurants row at all — approve and reject
--      fail closed with the SAME error for a real trade ID and a random
--      one, proving there is no trade-ID existence oracle.
--
-- Design: docs/superpowers/specs/2026-08-20-trade-approval-area-grant-design.md
-- Migration under test: supabase/migrations/20260820120000_trade_approval_area_grant.sql
--
-- Fixture namespace: UUIDs starting with 65000000-...
-- Function calls stay as role postgres (RLS bypassed) and impersonate only
-- via set_config('request.jwt.claims', ...) — approve_shift_trade and
-- reject_shift_trade are SECURITY DEFINER, so their own internal guard is
-- what is under test, not RLS. SELECT/DELETE assertions switch to
-- SET LOCAL role = 'authenticated' so they exercise the real RLS policies.
-- ============================================================================

BEGIN;
SELECT plan(13);

-- ============================================================================
-- Setup (as postgres/superuser — bypasses RLS regardless of enable state)
-- ============================================================================
SET LOCAL role TO postgres;

ALTER TABLE shift_trades DISABLE ROW LEVEL SECURITY;
ALTER TABLE shifts DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE role_areas DISABLE ROW LEVEL SECURITY;

-- Restaurant
INSERT INTO restaurants (id, name) VALUES
  ('65000000-0000-0000-0000-000000000001', 'Trade Area Grant Restaurant')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Auth users: U1 (custom, manage), U2 (custom, view), U3 (legacy
-- operations_manager), U4 (no membership), OE (offerer), AE (accepter)
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('65000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tag-u1-65@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('65000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tag-u2-65@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('65000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tag-u3-65@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('65000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tag-u4-65@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('65000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tag-oe-65@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('65000000-0000-0000-0000-000000000016', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tag-ae-65@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Employees: offerer OE and accepter AE. U1/U2/U3/U4 deliberately get no
-- employees row — they must qualify (or be denied) purely on the
-- edit:scheduling capability, not on being a trade participant.
INSERT INTO employees (id, restaurant_id, user_id, name, email, position, is_active) VALUES
  ('65000000-0000-0000-0000-000000000021', '65000000-0000-0000-0000-000000000001', '65000000-0000-0000-0000-000000000015', 'Offerer OE', 'tag-oe-65@test.com', 'Server', true),
  ('65000000-0000-0000-0000-000000000022', '65000000-0000-0000-0000-000000000001', '65000000-0000-0000-0000-000000000016', 'Accepter AE', 'tag-ae-65@test.com', 'Server', true)
ON CONFLICT (id) DO UPDATE SET is_active = true;

-- Two custom roles: one at scheduling:manage (grants edit:scheduling), one
-- at scheduling:view only (grants view:scheduling but NOT edit:scheduling).
INSERT INTO public.roles (id, restaurant_id, name, description, flavor, builtin) VALUES
  ('65000000-0000-0000-0000-0000000000c1', '65000000-0000-0000-0000-000000000001', 'Trade Manage Role', 'pgTAP fixture — scheduling:manage', 'platform', false),
  ('65000000-0000-0000-0000-0000000000c2', '65000000-0000-0000-0000-000000000001', 'Trade View Role', 'pgTAP fixture — scheduling:view', 'platform', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.role_areas (role_id, area_key, level) VALUES
  ('65000000-0000-0000-0000-0000000000c1', 'scheduling', 'manage'),
  ('65000000-0000-0000-0000-0000000000c2', 'scheduling', 'view')
ON CONFLICT (role_id, area_key) DO UPDATE SET level = EXCLUDED.level;

-- Memberships: U1 (custom manage), U2 (custom view), U3 (legacy
-- operations_manager, role_id NULL). U4 gets no user_restaurants row.
INSERT INTO user_restaurants (id, user_id, restaurant_id, role, role_id) VALUES
  ('65000000-0000-0000-0000-000000000031', '65000000-0000-0000-0000-000000000011', '65000000-0000-0000-0000-000000000001', 'collaborator_custom', '65000000-0000-0000-0000-0000000000c1'),
  ('65000000-0000-0000-0000-000000000032', '65000000-0000-0000-0000-000000000012', '65000000-0000-0000-0000-000000000001', 'collaborator_custom', '65000000-0000-0000-0000-0000000000c2'),
  ('65000000-0000-0000-0000-000000000033', '65000000-0000-0000-0000-000000000013', '65000000-0000-0000-0000-000000000001', 'operations_manager', NULL)
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role, role_id = EXCLUDED.role_id;

-- Four shifts owned by OE, one per trade, so the unique-active-trade-per-
-- shift index never blocks a fixture insert.
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, break_duration) VALUES
  -- Relative dates (lesson: hardcoded dates rot). The original literal
  -- dates went stale and approve_shift_trade now reports a shift_started
  -- finding for a past shift, which fails the authz assertions for the
  -- wrong reason. Far-future starts keep every deadline rule quiet too.
  ('65000000-0000-0000-0000-000000000041', '65000000-0000-0000-0000-000000000001', '65000000-0000-0000-0000-000000000021', now() + interval '3 days', now() + interval '3 days 8 hours', 'Server', 30),
  ('65000000-0000-0000-0000-000000000042', '65000000-0000-0000-0000-000000000001', '65000000-0000-0000-0000-000000000021', now() + interval '4 days', now() + interval '4 days 8 hours', 'Server', 30),
  ('65000000-0000-0000-0000-000000000043', '65000000-0000-0000-0000-000000000001', '65000000-0000-0000-0000-000000000021', now() + interval '5 days', now() + interval '5 days 8 hours', 'Server', 30),
  ('65000000-0000-0000-0000-000000000044', '65000000-0000-0000-0000-000000000001', '65000000-0000-0000-0000-000000000021', now() + interval '6 days', now() + interval '6 days 8 hours', 'Server', 30)
ON CONFLICT (id) DO UPDATE SET
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  position = EXCLUDED.position;

DELETE FROM shift_trades WHERE restaurant_id = '65000000-0000-0000-0000-000000000001';

-- tradeApprove / tradeReject: pending_approval with AE already accepted, so
-- approve/reject can act on them. tradeDelete: open, for the DELETE
-- assertions. tradeLegacyApprove: pending_approval, for the legacy-role
-- approve assertion.
INSERT INTO shift_trades (id, restaurant_id, offered_shift_id, offered_by_employee_id, target_employee_id, accepted_by_employee_id, status) VALUES
  ('65000000-0000-0000-0000-000000000051', '65000000-0000-0000-0000-000000000001', '65000000-0000-0000-0000-000000000041', '65000000-0000-0000-0000-000000000021', NULL, '65000000-0000-0000-0000-000000000022', 'pending_approval'),
  ('65000000-0000-0000-0000-000000000052', '65000000-0000-0000-0000-000000000001', '65000000-0000-0000-0000-000000000042', '65000000-0000-0000-0000-000000000021', NULL, '65000000-0000-0000-0000-000000000022', 'pending_approval'),
  ('65000000-0000-0000-0000-000000000053', '65000000-0000-0000-0000-000000000001', '65000000-0000-0000-0000-000000000043', '65000000-0000-0000-0000-000000000021', NULL, NULL, 'open'),
  ('65000000-0000-0000-0000-000000000054', '65000000-0000-0000-0000-000000000001', '65000000-0000-0000-0000-000000000044', '65000000-0000-0000-0000-000000000021', NULL, '65000000-0000-0000-0000-000000000022', 'pending_approval');

-- CRITICAL: re-enable RLS on every table we disabled above (see
-- 53_directed_shift_trade_rls.sql precedent).
ALTER TABLE shift_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_areas ENABLE ROW LEVEL SECURITY;

RESET ROLE;

-- ============================================================================
-- Scenario 1 (assertions 1-4): U1, custom role at scheduling:manage
-- (edit:scheduling). Approve tradeApprove, reject tradeReject, SELECT sees
-- every restaurant trade, DELETE removes tradeDelete.
-- ============================================================================
SET LOCAL role TO postgres;
SELECT set_config('request.jwt.claims', '{"sub":"65000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

SELECT is(
  (SELECT (approve_shift_trade('65000000-0000-0000-0000-000000000051', '65000000-0000-0000-0000-000000000011')->>'success')::boolean),
  true,
  'Scenario 1: custom role at scheduling:manage can approve a trade'
);

SELECT is(
  (SELECT (reject_shift_trade('65000000-0000-0000-0000-000000000052', '65000000-0000-0000-0000-000000000011')->>'success')::boolean),
  true,
  'Scenario 1: custom role at scheduling:manage can reject a trade'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"65000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM shift_trades WHERE restaurant_id = '65000000-0000-0000-0000-000000000001'),
  4::bigint,
  'Scenario 1: custom role at scheduling:manage sees all four restaurant trades via the manager SELECT policy'
);

WITH deleted AS (
  DELETE FROM shift_trades WHERE id = '65000000-0000-0000-0000-000000000053' RETURNING id
)
SELECT COUNT(*) AS deleted_count FROM deleted \gset

SELECT is(
  :deleted_count::bigint,
  1::bigint,
  'Scenario 1: custom role at scheduling:manage can delete a trade'
);

-- ============================================================================
-- Scenario 2 (assertions 5-8): U2, custom role at scheduling:view only
-- (view:scheduling, NOT edit:scheduling). Approve and reject on the still-
-- pending tradeLegacyApprove must both fail closed; SELECT sees zero
-- non-participant trades; DELETE removes zero rows.
-- ============================================================================
RESET ROLE;
SET LOCAL role TO postgres;
SELECT set_config('request.jwt.claims', '{"sub":"65000000-0000-0000-0000-000000000012","role":"authenticated"}', true);

SELECT is(
  (SELECT approve_shift_trade('65000000-0000-0000-0000-000000000054', '65000000-0000-0000-0000-000000000012')->>'error'),
  'Unauthorized: schedule manage access required',
  'Scenario 2: custom role at scheduling:view only is denied approve'
);

SELECT is(
  (SELECT reject_shift_trade('65000000-0000-0000-0000-000000000054', '65000000-0000-0000-0000-000000000012')->>'error'),
  'Unauthorized: schedule manage access required',
  'Scenario 2: custom role at scheduling:view only is denied reject'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"65000000-0000-0000-0000-000000000012","role":"authenticated"}', true);

SELECT is(
  (SELECT COUNT(*) FROM shift_trades WHERE restaurant_id = '65000000-0000-0000-0000-000000000001'),
  0::bigint,
  'Scenario 2: custom role at scheduling:view only, a non-participant, sees zero restaurant trades'
);

WITH deleted AS (
  DELETE FROM shift_trades WHERE id = '65000000-0000-0000-0000-000000000054' RETURNING id
)
SELECT COUNT(*) AS deleted_count FROM deleted \gset

SELECT is(
  :deleted_count::bigint,
  0::bigint,
  'Scenario 2: custom role at scheduling:view only deletes zero rows'
);

-- ============================================================================
-- Scenario 3 (assertion 9): U3, legacy operations_manager (role_id NULL).
-- The legacy CASE fallback still grants edit:scheduling to this role
-- string, so approve of the still-pending tradeLegacyApprove succeeds.
-- ============================================================================
RESET ROLE;
SET LOCAL role TO postgres;
SELECT set_config('request.jwt.claims', '{"sub":"65000000-0000-0000-0000-000000000013","role":"authenticated"}', true);

SELECT is(
  (SELECT (approve_shift_trade('65000000-0000-0000-0000-000000000054', '65000000-0000-0000-0000-000000000013')->>'success')::boolean),
  true,
  'Scenario 3: legacy operations_manager (role_id NULL) can approve a trade'
);

-- ============================================================================
-- Scenario 4 (assertions 10-13): U4, no user_restaurants row at all. Approve
-- and reject must both fail closed with the SAME generic error for a real
-- trade ID and for a random one — proving there is no trade-ID existence
-- oracle.
-- ============================================================================
RESET ROLE;
SET LOCAL role TO postgres;
SELECT set_config('request.jwt.claims', '{"sub":"65000000-0000-0000-0000-000000000014","role":"authenticated"}', true);

SELECT is(
  (SELECT approve_shift_trade('65000000-0000-0000-0000-000000000054', '65000000-0000-0000-0000-000000000014')->>'error'),
  'Unauthorized: schedule manage access required',
  'Scenario 4: no membership, approve on a real trade ID fails closed'
);

SELECT is(
  (SELECT approve_shift_trade('65000000-0000-0000-0000-000000000099', '65000000-0000-0000-0000-000000000014')->>'error'),
  'Unauthorized: schedule manage access required',
  'Scenario 4: no membership, approve on a random trade ID fails closed with the same error'
);

SELECT is(
  (SELECT reject_shift_trade('65000000-0000-0000-0000-000000000054', '65000000-0000-0000-0000-000000000014')->>'error'),
  'Unauthorized: schedule manage access required',
  'Scenario 4: no membership, reject on a real trade ID fails closed'
);

SELECT is(
  (SELECT reject_shift_trade('65000000-0000-0000-0000-000000000099', '65000000-0000-0000-0000-000000000014')->>'error'),
  'Unauthorized: schedule manage access required',
  'Scenario 4: no membership, reject on a random trade ID fails closed with the same error'
);

-- ============================================================================
-- Cleanup
-- ============================================================================
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
