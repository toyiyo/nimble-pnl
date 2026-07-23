-- ============================================================================
-- Test: accept_shift_trade authorization (caller must own the accepting
-- employee row; a directed trade may only be accepted by its target)
--
-- accept_shift_trade(p_trade_id UUID, p_accepting_employee_id UUID) is
-- SECURITY DEFINER + GRANTed to authenticated, but today trusts the
-- client-supplied p_accepting_employee_id: it never checks that the caller
-- (auth.uid()) owns that employee row, nor (for a directed trade) that it
-- equals target_employee_id. This test impersonates callers via
-- `SET LOCAL ROLE authenticated` + request.jwt.claims so it exercises the
-- real authenticated-role GRANT boundary (unlike 17_shift_trade_functions_
-- security.sql, which runs as postgres/superuser throughout).
--
-- Each scenario asserts BOTH the returned jsonb->>'success' AND the
-- resulting shift_trades.accepted_by_employee_id, as two separate top-level
-- statements (a function call that writes, then a fresh SELECT to observe
-- the write — combining both into one CTE-based statement hits a Postgres
-- planning artifact where an uncorrelated subquery can be evaluated as an
-- InitPlan that doesn't see the CTE's own write; verified directly against
-- local Postgres before settling on this two-statement form). The
-- accepted_by_employee_id follow-up SELECT always runs as `postgres`
-- (RLS bypassed), not as the calling employee: a cross-restaurant caller
-- (scenario 5) can be denied RLS visibility of the row even when the RPC
-- did mutate it, which would make a caller-scoped check pass vacuously for
-- the wrong reason (also confirmed directly before settling on this form).
--   1. Attacker: C accepts the OPEN trade as B (not C).       -> RED today
--   2. Legit self-accept: C accepts the OPEN trade as C.      -> already green
--   3. Non-target self-accept: C accepts the DIRECTED trade
--      (A->B) as C.                                            -> RED today
--   4. Target self-accept: B accepts the DIRECTED trade
--      (A->B) as B.                                            -> already green
--   5. Cross-restaurant: X (R2) accepts an R1 OPEN trade as X. -> RED today
--
-- Migration under test (not yet applied when this test is written):
--   supabase/migrations/<ts-after-20260713000000>_harden_accept_shift_trade.sql
--
-- Design: docs/superpowers/specs/2026-07-13-accept-trade-authz-design.md
-- Ticket: task_d9ab7984
--
-- Fixture namespace: UUIDs starting with 54000000-...
-- Seeds: restaurant R1 + employees A(offerer)/B(target)/C(bystander), a
--        second restaurant R2 + employee X. Each scenario gets its OWN
--        trade + shift, entirely independent of the others: a trade
--        consumed (or left open) by an earlier scenario would otherwise
--        change a later scenario's expected pre-patch outcome purely via
--        the pre-existing status check, not the authz check under test —
--        e.g. sharing one trade between scenarios 1 and 2 made scenario 2
--        fail pre-patch too (for the wrong reason: "trade no longer open"),
--        which was caught by running this file before writing it up here.
--          - trade51 (OPEN, shift1)          -> scenario 1 (attacker)
--          - trade54 (OPEN, shift4)          -> scenario 2 (legit self-accept)
--          - trade52 (DIRECTED A->B, shift2) -> scenario 3 (non-target self-accept)
--          - trade55 (DIRECTED A->B, shift5) -> scenario 4 (target self-accept)
--          - trade53 (OPEN, shift3)          -> scenario 5 (cross-restaurant)
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
  ('54000000-0000-0000-0000-000000000001', 'Accept Trade Authz Restaurant'),
  ('54000000-0000-0000-0000-000000000002', 'Other Restaurant (Accept Trade Authz)')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Auth users: A(offerer), B(target), C(bystander), X(other restaurant)
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('54000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'trade-a-54@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('54000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'trade-b-54@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('54000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'trade-c-54@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('54000000-0000-0000-0000-000000000016', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'trade-x-54@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Employees: A, B, C on R1; X on R2
INSERT INTO employees (id, restaurant_id, user_id, name, email, position, is_active) VALUES
  ('54000000-0000-0000-0000-000000000021', '54000000-0000-0000-0000-000000000001', '54000000-0000-0000-0000-000000000011', 'Offerer A', 'trade-a-54@test.com', 'Server', true),
  ('54000000-0000-0000-0000-000000000022', '54000000-0000-0000-0000-000000000001', '54000000-0000-0000-0000-000000000012', 'Target B', 'trade-b-54@test.com', 'Server', true),
  ('54000000-0000-0000-0000-000000000023', '54000000-0000-0000-0000-000000000001', '54000000-0000-0000-0000-000000000013', 'Bystander C', 'trade-c-54@test.com', 'Server', true),
  ('54000000-0000-0000-0000-000000000024', '54000000-0000-0000-0000-000000000002', '54000000-0000-0000-0000-000000000016', 'Other Restaurant X', 'trade-x-54@test.com', 'Server', true)
ON CONFLICT (id) DO UPDATE SET is_active = true;

-- Five shifts owned by A, on distinct days so no accepter ever has a
-- schedule conflict with the shift being traded.
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, break_duration, status) VALUES
  ('54000000-0000-0000-0000-000000000041', '54000000-0000-0000-0000-000000000001', '54000000-0000-0000-0000-000000000021', '2026-08-01 09:00:00+00', '2026-08-01 17:00:00+00', 'Server', 30, 'scheduled'),
  ('54000000-0000-0000-0000-000000000042', '54000000-0000-0000-0000-000000000001', '54000000-0000-0000-0000-000000000021', '2026-08-02 09:00:00+00', '2026-08-02 17:00:00+00', 'Server', 30, 'scheduled'),
  ('54000000-0000-0000-0000-000000000043', '54000000-0000-0000-0000-000000000001', '54000000-0000-0000-0000-000000000021', '2026-08-03 09:00:00+00', '2026-08-03 17:00:00+00', 'Server', 30, 'scheduled'),
  ('54000000-0000-0000-0000-000000000044', '54000000-0000-0000-0000-000000000001', '54000000-0000-0000-0000-000000000021', '2026-08-04 09:00:00+00', '2026-08-04 17:00:00+00', 'Server', 30, 'scheduled'),
  ('54000000-0000-0000-0000-000000000045', '54000000-0000-0000-0000-000000000001', '54000000-0000-0000-0000-000000000021', '2026-08-05 09:00:00+00', '2026-08-05 17:00:00+00', 'Server', 30, 'scheduled')
ON CONFLICT (id) DO UPDATE SET position = 'Server';

DELETE FROM shift_trades WHERE restaurant_id IN (
  '54000000-0000-0000-0000-000000000001', '54000000-0000-0000-0000-000000000002'
);

-- trade51: OPEN (marketplace) trade on shift1 — used only by scenario 1
INSERT INTO shift_trades (id, restaurant_id, offered_shift_id, offered_by_employee_id, target_employee_id, status)
  VALUES ('54000000-0000-0000-0000-000000000051', '54000000-0000-0000-0000-000000000001', '54000000-0000-0000-0000-000000000041', '54000000-0000-0000-0000-000000000021', NULL, 'open');

-- trade52: DIRECTED trade (A->B) on shift2 — used only by scenario 3
INSERT INTO shift_trades (id, restaurant_id, offered_shift_id, offered_by_employee_id, target_employee_id, status)
  VALUES ('54000000-0000-0000-0000-000000000052', '54000000-0000-0000-0000-000000000001', '54000000-0000-0000-0000-000000000042', '54000000-0000-0000-0000-000000000021', '54000000-0000-0000-0000-000000000022', 'open');

-- trade53: OPEN (marketplace) trade on shift3 — used only by scenario 5
INSERT INTO shift_trades (id, restaurant_id, offered_shift_id, offered_by_employee_id, target_employee_id, status)
  VALUES ('54000000-0000-0000-0000-000000000053', '54000000-0000-0000-0000-000000000001', '54000000-0000-0000-0000-000000000043', '54000000-0000-0000-0000-000000000021', NULL, 'open');

-- trade54: OPEN (marketplace) trade on shift4 — used only by scenario 2
INSERT INTO shift_trades (id, restaurant_id, offered_shift_id, offered_by_employee_id, target_employee_id, status)
  VALUES ('54000000-0000-0000-0000-000000000054', '54000000-0000-0000-0000-000000000001', '54000000-0000-0000-0000-000000000044', '54000000-0000-0000-0000-000000000021', NULL, 'open');

-- trade55: DIRECTED trade (A->B) on shift5 — used only by scenario 4
INSERT INTO shift_trades (id, restaurant_id, offered_shift_id, offered_by_employee_id, target_employee_id, status)
  VALUES ('54000000-0000-0000-0000-000000000055', '54000000-0000-0000-0000-000000000001', '54000000-0000-0000-0000-000000000045', '54000000-0000-0000-0000-000000000021', '54000000-0000-0000-0000-000000000022', 'open');

-- CRITICAL: re-enable RLS on every table we disabled above before switching
-- to the authenticated role (see 53_directed_shift_trade_rls.sql precedent —
-- the sibling 16_shift_trades_security.sql forgets this and its assertions
-- pass vacuously).
ALTER TABLE shift_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants ENABLE ROW LEVEL SECURITY;

RESET ROLE;

-- ============================================================================
-- Scenario 1 (assertions 1-2): Bystander C calls
-- accept_shift_trade(trade51 OPEN, B's employee_id) — i.e. accepting AS B
-- while authenticated as C. Today's unguarded function lets this through
-- (RED); the hardened function must reject it and leave
-- accepted_by_employee_id untouched.
-- ============================================================================
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"54000000-0000-0000-0000-000000000013","role":"authenticated"}', true);

SELECT is(
  (SELECT (accept_shift_trade('54000000-0000-0000-0000-000000000051', '54000000-0000-0000-0000-000000000022')->>'success')::boolean),
  false,
  'Scenario 1: C cannot accept the open trade as B'
);

-- Checked as postgres (RLS bypassed) so this reads the RPC's actual write,
-- not what the caller's own RLS-scoped view happens to expose — a
-- cross-restaurant caller (scenario 5) can be denied visibility of the row
-- by RLS even when the row itself was mutated, which would make a
-- caller-scoped check pass vacuously.
RESET ROLE;
SET LOCAL role TO postgres;
SELECT is(
  (SELECT accepted_by_employee_id FROM shift_trades WHERE id = '54000000-0000-0000-0000-000000000051'),
  NULL::uuid,
  'Scenario 1: open trade accepted_by_employee_id stays NULL after the rejected impersonation'
);

-- ============================================================================
-- Scenario 2 (assertions 3-4): Bystander C calls
-- accept_shift_trade(trade54 OPEN, C's own employee_id) — legitimate
-- self-accept of a marketplace trade. Must succeed and record C. Uses a
-- dedicated trade (not trade51) so scenario 1's outcome above can never
-- affect this scenario's starting state.
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"54000000-0000-0000-0000-000000000013","role":"authenticated"}', true);

SELECT is(
  (SELECT (accept_shift_trade('54000000-0000-0000-0000-000000000054', '54000000-0000-0000-0000-000000000023')->>'success')::boolean),
  true,
  'Scenario 2: C can accept the open trade as themselves'
);

RESET ROLE;
SET LOCAL role TO postgres;
SELECT is(
  (SELECT accepted_by_employee_id FROM shift_trades WHERE id = '54000000-0000-0000-0000-000000000054'),
  '54000000-0000-0000-0000-000000000023'::uuid,
  'Scenario 2: open trade accepted_by_employee_id is recorded as C'
);

-- ============================================================================
-- Scenario 3 (assertions 5-6): Bystander C calls
-- accept_shift_trade(trade52 DIRECTED A->B, C's own employee_id) — C is not
-- the target, so this must fail even though C legitimately owns the
-- employee row they're passing.
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"54000000-0000-0000-0000-000000000013","role":"authenticated"}', true);

SELECT is(
  (SELECT (accept_shift_trade('54000000-0000-0000-0000-000000000052', '54000000-0000-0000-0000-000000000023')->>'success')::boolean),
  false,
  'Scenario 3: C (non-target) cannot accept the directed A->B trade'
);

RESET ROLE;
SET LOCAL role TO postgres;
SELECT is(
  (SELECT accepted_by_employee_id FROM shift_trades WHERE id = '54000000-0000-0000-0000-000000000052'),
  NULL::uuid,
  'Scenario 3: directed trade accepted_by_employee_id stays NULL after C is rejected'
);

-- ============================================================================
-- Scenario 4 (assertions 7-8): Target B calls
-- accept_shift_trade(trade55 DIRECTED A->B, B's own employee_id) —
-- legitimate target self-accept. Must succeed and record B. Uses a
-- dedicated trade (not trade52) so scenario 3's outcome above can never
-- affect this scenario's starting state.
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"54000000-0000-0000-0000-000000000012","role":"authenticated"}', true);

SELECT is(
  (SELECT (accept_shift_trade('54000000-0000-0000-0000-000000000055', '54000000-0000-0000-0000-000000000022')->>'success')::boolean),
  true,
  'Scenario 4: B (the target) can accept the directed A->B trade as themselves'
);

RESET ROLE;
SET LOCAL role TO postgres;
SELECT is(
  (SELECT accepted_by_employee_id FROM shift_trades WHERE id = '54000000-0000-0000-0000-000000000055'),
  '54000000-0000-0000-0000-000000000022'::uuid,
  'Scenario 4: directed trade accepted_by_employee_id is recorded as B'
);

-- ============================================================================
-- Scenario 5 (assertions 9-10): Cross-restaurant — X (R2) calls
-- accept_shift_trade(trade53 OPEN R1, X's own employee_id). X owns the
-- employee row they're passing, but that employee is not in the trade's
-- restaurant, so this must fail and leave accepted_by untouched.
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"54000000-0000-0000-0000-000000000016","role":"authenticated"}', true);

SELECT is(
  (SELECT (accept_shift_trade('54000000-0000-0000-0000-000000000053', '54000000-0000-0000-0000-000000000024')->>'success')::boolean),
  false,
  'Scenario 5: cross-restaurant employee X cannot accept an R1 open trade as themselves'
);

RESET ROLE;
SET LOCAL role TO postgres;
SELECT is(
  (SELECT accepted_by_employee_id FROM shift_trades WHERE id = '54000000-0000-0000-0000-000000000053'),
  NULL::uuid,
  'Scenario 5: R1 open trade accepted_by_employee_id stays NULL after X is rejected'
);

-- ============================================================================
-- Cleanup
-- ============================================================================
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
