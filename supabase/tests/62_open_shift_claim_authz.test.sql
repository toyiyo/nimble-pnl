-- ============================================================================
-- Test: authorization guards for the open-shift-claim RPC family
--
-- Four SECURITY DEFINER RPCs on open_shift_claims/shift_templates trust
-- their inputs and perform NO authorization check today. Because SECURITY
-- DEFINER bypasses RLS, auth.uid() is used only to *record* the actor
-- (reviewed_by / created rows), never to *gate* the action:
--   - approve_open_shift_claim(uuid, text) — any authenticated user can
--     approve ANY claim by id, including their own (self-approval bypass
--     of the manager gate) or another restaurant's (cross-tenant approval).
--   - reject_open_shift_claim(uuid, text)  — same shape, any user can
--     reject any claim by id.
--   - claim_open_shift(uuid, uuid, date, uuid) — trusts the client-supplied
--     p_employee_id; never checks the caller owns that employee row or
--     belongs to p_restaurant_id (employee impersonation / cross-tenant
--     claim creation).
--   - get_open_shifts(uuid, date, date) — no membership check on
--     p_restaurant_id; leaks another restaurant's open-shift availability
--     (template names, positions, counts) to any authenticated user.
--
-- Bug ref: security fix deferred from the shift-fill-by-assignment PR
-- (fix/shift-fill-by-assignment) — Codex flagged the approve hole as
-- CRITICAL during that PR's Phase 7 review.
--
-- Design: docs/superpowers/specs/2026-07-21-open-shift-claim-authz-design.md
-- Migration under test (not yet applied when this test is written):
--   supabase/migrations/20260721000000_open_shift_claim_authz_guard.sql
--
-- This file impersonates real callers via `SET LOCAL role = 'authenticated'`
-- + request.jwt.claims so it exercises the real `authenticated` GRANT +
-- auth.uid() boundary — a `SET LOCAL role TO postgres` DO-block would make
-- auth.uid() NULL throughout and every assertion here vacuous (see the
-- sibling files 60_claim_open_shift_active_guard.test.sql and
-- 61_approve_open_shift_claim_active_guard.test.sql, which had exactly this
-- gap and are updated alongside this migration for the same reason).
--
-- Lessons applied:
--   [2026-04-21] Fixture dates are always CURRENT_DATE + N, never a
--     hardcoded literal (the pending-approval claims below intentionally
--     use dates OUTSIDE the published week [CURRENT_DATE, CURRENT_DATE+6]
--     so they never interact with the get_open_shifts assertions).
--   [2026-04-22] Idempotent fixture inserts use ON CONFLICT DO UPDATE.
--   [2026-07-13] Vacuous-test trap. Two specific guards against it here:
--     (a) Every pending claim used by an approve/reject scenario is its
--         OWN row (distinct shift_date) so one scenario's mutation can
--         never change another scenario's starting state.
--     (b) Scenario 9 (get_open_shifts) asserts the DENIED case (a stranger
--         to R1 sees zero rows) BEFORE the ALLOWED case (a linked R1
--         member sees the row). Today (pre-guard) get_open_shifts has NO
--         membership check at all, so "the linked member sees the row"
--         would pass whether or not a guard exists — it is not, by
--         itself, evidence the guard works. Ordering the denied-by-default
--         assertion first (the one that is actually RED today) makes the
--         RED/GREEN transition unambiguous; the allowed-case assertion
--         that follows is a regression control, not the load-bearing check.
--   shift_templates.days is deliberately ARRAY[0,1,2,3,4,5,6] (every
--     day-of-week) for both templates below, so no scenario's outcome can
--     be confused with a day-of-week rejection — every deny/allow result
--     in this file is attributable ONLY to the authorization guard (or,
--     pre-migration, the absence of one).
--
-- Fixture map (UUID namespace 62000000-...):
--   Restaurants:
--     R1 (...0001) — approval-required (require_shift_claim_approval=true).
--                    Hosts the approve/reject scenarios, the cross-tenant
--                    claim-impersonation scenario, and the get_open_shifts
--                    membership scenario.
--     R2 (...0002) — cross-tenant control restaurant.
--     R3 (...0003) — instant-approval (require_shift_claim_approval=false).
--                    Hosts the legitimate self-claim scenario only.
--   auth.users / user_restaurants:
--     M1  (...0011) — manager of R1.
--     OM1 (...0012) — operations_manager of R1 (pins the parity fix: the
--                     deployed managers_review_claims/managers_view_
--                     restaurant_claims RLS policies and edit:scheduling
--                     capability already include operations_manager, so
--                     the new guard must too, or this scenario catches an
--                     accidental narrowing back to owner/manager-only).
--     M2  (...0013) — manager of R2 (cross-tenant attacker for approve/reject).
--   auth.users / employees:
--     E1 (...0014) — claimer. Owns employee row ...0101 on R1 AND a
--                    second employee row ...0102 on R3 (same auth user,
--                    two employee records — the schema allows this; no
--                    unique constraint on employees.user_id alone). The R3
--                    row exists solely so scenario 7's legitimate
--                    self-claim can run against an instant-approval
--                    restaurant without disturbing R1's approval-required
--                    fixtures.
--     E2 (...0015) — employee of R2 only (...0103). Cross-tenant stranger
--                    /impersonation attacker for the claim + get_open_shifts
--                    scenarios.
--   shift_templates: T1 (...0201, R1), T3 (...0202, R3) — both active,
--     capacity 2, days = every day-of-week.
--   staffing_settings: R1 open_shifts_enabled=true/require_approval=true;
--     R3 open_shifts_enabled=true/require_approval=false.
--   schedule_publications: R1, week [CURRENT_DATE, CURRENT_DATE+6],
--     published_by M1 — required so get_open_shifts (scenario 9) has a
--     published week to return anything from; without it every caller
--     would see zero rows and the membership assertion would pass
--     vacuously regardless of the guard.
--   Pending claims (all shift_template_id=T1, claimed_by_employee_id=
--     E1's R1 employee row ...0101, one distinct shift_date per scenario
--     so mutations never cross-contaminate):
--       ...0301  CURRENT_DATE+10  scenario 1  (approve, deny: self)
--       ...0302  CURRENT_DATE+11  scenario 2  (approve, deny: cross-tenant)
--       ...0303  CURRENT_DATE+12  scenario 3  (approve, allow: manager)
--       ...0304  CURRENT_DATE+13  scenario 3b (approve, allow: ops manager)
--       ...0305  CURRENT_DATE+14  scenario 4  (reject, deny: self)
--       ...0306  CURRENT_DATE+15  scenario 5  (reject, deny: cross-tenant)
--       ...0307  CURRENT_DATE+16  scenario 6  (reject, allow: manager)
--
-- Scenarios (21 assertions total):
--   1.  approve — E1 (claimer, non-manager) cannot approve their own claim.
--   2.  approve — M2 (manager of R2) cannot approve an R1 claim.
--   3.  approve — M1 (manager of R1) can approve an R1 claim.
--   3b. approve — OM1 (operations_manager of R1) can approve an R1 claim.
--   4.  reject  — E1 cannot reject their own claim.
--   5.  reject  — M2 cannot reject an R1 claim.
--   6.  reject  — M1 can reject an R1 claim.
--   7.  claim   — E1 legitimately self-claims on the instant-approval
--                 restaurant R3.
--   8.  claim   — E2 cannot claim "as E1" into R1 (impersonation +
--                 cross-tenant): no claim row is created at all.
--   9.  get_open_shifts — E2 (stranger to R1) sees zero rows for R1's open
--       slot; E1 (linked employee of R1) still sees the row (control).
-- ============================================================================

BEGIN;
SELECT plan(21);

-- ============================================================================
-- Setup (as postgres — bypasses RLS via BYPASSRLS; the DISABLE/ENABLE pair
-- below is defensive belt-and-suspenders matching the 54_accept_shift_trade_
-- authz.sql precedent, not strictly required for the inserts themselves).
-- ============================================================================
SET LOCAL role TO postgres;

ALTER TABLE public.restaurants          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees            DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts               DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_templates      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.open_shift_claims    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.staffing_settings    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_restaurants     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_publications DISABLE ROW LEVEL SECURITY;

-- Clean up in FK order before inserting (delete-before-insert, per the
-- 60/61/54 precedent, so re-running this file is idempotent within a psql
-- session even though the whole file runs inside one rolled-back transaction).
DELETE FROM public.open_shift_claims     WHERE restaurant_id IN (
  '62000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000002', '62000000-0000-0000-0000-000000000003'
);
DELETE FROM public.shifts                WHERE restaurant_id IN (
  '62000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000002', '62000000-0000-0000-0000-000000000003'
);
DELETE FROM public.schedule_publications WHERE restaurant_id IN (
  '62000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000002', '62000000-0000-0000-0000-000000000003'
);
DELETE FROM public.staffing_settings     WHERE restaurant_id IN (
  '62000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000002', '62000000-0000-0000-0000-000000000003'
);
DELETE FROM public.shift_templates       WHERE restaurant_id IN (
  '62000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000002', '62000000-0000-0000-0000-000000000003'
);
DELETE FROM public.employees             WHERE restaurant_id IN (
  '62000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000002', '62000000-0000-0000-0000-000000000003'
);
DELETE FROM public.user_restaurants      WHERE restaurant_id IN (
  '62000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000002', '62000000-0000-0000-0000-000000000003'
);
DELETE FROM public.restaurants           WHERE id IN (
  '62000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000002', '62000000-0000-0000-0000-000000000003'
);

-- Restaurants
INSERT INTO public.restaurants (id, name) VALUES
  ('62000000-0000-0000-0000-000000000001', 'Open Shift Authz R1 (approval-required)'),
  ('62000000-0000-0000-0000-000000000002', 'Open Shift Authz R2 (cross-tenant)'),
  ('62000000-0000-0000-0000-000000000003', 'Open Shift Authz R3 (instant-approval)')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Auth users: M1(manager R1), OM1(operations_manager R1), M2(manager R2),
-- E1(claimer, R1+R3), E2(employee R2 / stranger+impersonator)
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('62000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'osc-m1-62@test.com',  crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('62000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'osc-om1-62@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('62000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'osc-m2-62@test.com',  crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('62000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'osc-e1-62@test.com',  crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('62000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'osc-e2-62@test.com',  crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- user_restaurants: M1/OM1 on R1, M2 on R2
INSERT INTO public.user_restaurants (user_id, restaurant_id, role) VALUES
  ('62000000-0000-0000-0000-000000000011', '62000000-0000-0000-0000-000000000001', 'manager'),
  ('62000000-0000-0000-0000-000000000012', '62000000-0000-0000-0000-000000000001', 'operations_manager'),
  ('62000000-0000-0000-0000-000000000013', '62000000-0000-0000-0000-000000000002', 'manager')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- Employees: E1 on R1 (...0101) and, separately, on R3 (...0102) so
-- scenario 7 (instant-approval self-claim) can run without touching R1's
-- approval-required fixtures. E2 on R2 (...0103).
INSERT INTO public.employees (id, restaurant_id, user_id, name, email, position, is_active, status) VALUES
  ('62000000-0000-0000-0000-000000000101', '62000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000014', 'Claimer E1 (R1)', 'osc-e1-62@test.com', 'Server', true, 'active'),
  ('62000000-0000-0000-0000-000000000102', '62000000-0000-0000-0000-000000000003', '62000000-0000-0000-0000-000000000014', 'Claimer E1 (R3)', 'osc-e1-62@test.com', 'Server', true, 'active'),
  ('62000000-0000-0000-0000-000000000103', '62000000-0000-0000-0000-000000000002', '62000000-0000-0000-0000-000000000015', 'Stranger E2 (R2)', 'osc-e2-62@test.com', 'Server', true, 'active')
ON CONFLICT (id) DO UPDATE SET is_active = true, user_id = EXCLUDED.user_id, restaurant_id = EXCLUDED.restaurant_id;

-- shift_templates: T1 (R1), T3 (R3). days = every DOW so no scenario's
-- deny/allow outcome can be attributed to a day-of-week mismatch instead of
-- the authorization guard.
INSERT INTO public.shift_templates (id, restaurant_id, name, start_time, end_time, position, capacity, days, is_active, break_duration) VALUES
  ('62000000-0000-0000-0000-000000000201', '62000000-0000-0000-0000-000000000001', 'OSC Authz Server 12-18 (R1)', '12:00'::time, '18:00'::time, 'Server', 2, ARRAY[0,1,2,3,4,5,6], true, 0),
  ('62000000-0000-0000-0000-000000000202', '62000000-0000-0000-0000-000000000003', 'OSC Authz Server 12-18 (R3)', '12:00'::time, '18:00'::time, 'Server', 2, ARRAY[0,1,2,3,4,5,6], true, 0)
ON CONFLICT (id) DO UPDATE
  SET days = EXCLUDED.days, capacity = EXCLUDED.capacity, is_active = true;

-- staffing_settings: R1 approval-required, R3 instant-approval. Both have
-- open_shifts_enabled=true (required for get_open_shifts to return anything;
-- scenario 9 needs R1's).
INSERT INTO public.staffing_settings (restaurant_id, open_shifts_enabled, require_shift_claim_approval) VALUES
  ('62000000-0000-0000-0000-000000000001', true, true),
  ('62000000-0000-0000-0000-000000000003', true, false)
ON CONFLICT (restaurant_id) DO UPDATE
  SET open_shifts_enabled = EXCLUDED.open_shifts_enabled,
      require_shift_claim_approval = EXCLUDED.require_shift_claim_approval;

-- schedule_publications: R1's current week, so get_open_shifts (scenario 9)
-- has a published window to return rows from. published_by FKs to
-- auth.users; M1 already exists above, no dedicated filler row needed.
INSERT INTO public.schedule_publications (restaurant_id, week_start_date, week_end_date, published_by) VALUES
  ('62000000-0000-0000-0000-000000000001', CURRENT_DATE, CURRENT_DATE + 6, '62000000-0000-0000-0000-000000000011');

-- Pending claims for the approve/reject scenarios — one dedicated row per
-- scenario (distinct shift_date), all against T1/E1's R1 employee row, so
-- no scenario's approve/reject mutation can change another scenario's
-- starting state. Dates are CURRENT_DATE+10..+16 — deliberately OUTSIDE the
-- published week [CURRENT_DATE, CURRENT_DATE+6] above, so these rows can
-- never appear in (or affect capacity for) the get_open_shifts assertions.
INSERT INTO public.open_shift_claims (id, restaurant_id, shift_template_id, shift_date, claimed_by_employee_id, status) VALUES
  ('62000000-0000-0000-0000-000000000301', '62000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000201', CURRENT_DATE + 10, '62000000-0000-0000-0000-000000000101', 'pending_approval'),
  ('62000000-0000-0000-0000-000000000302', '62000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000201', CURRENT_DATE + 11, '62000000-0000-0000-0000-000000000101', 'pending_approval'),
  ('62000000-0000-0000-0000-000000000303', '62000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000201', CURRENT_DATE + 12, '62000000-0000-0000-0000-000000000101', 'pending_approval'),
  ('62000000-0000-0000-0000-000000000304', '62000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000201', CURRENT_DATE + 13, '62000000-0000-0000-0000-000000000101', 'pending_approval'),
  ('62000000-0000-0000-0000-000000000305', '62000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000201', CURRENT_DATE + 14, '62000000-0000-0000-0000-000000000101', 'pending_approval'),
  ('62000000-0000-0000-0000-000000000306', '62000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000201', CURRENT_DATE + 15, '62000000-0000-0000-0000-000000000101', 'pending_approval'),
  ('62000000-0000-0000-0000-000000000307', '62000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000201', CURRENT_DATE + 16, '62000000-0000-0000-0000-000000000101', 'pending_approval');

-- CRITICAL: re-enable RLS on every table disabled above before switching to
-- the authenticated role (54_accept_shift_trade_authz.sql precedent — the
-- sibling 16_shift_trades_security.sql forgets this and its assertions pass
-- vacuously).
ALTER TABLE public.restaurants          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_templates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.open_shift_claims    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staffing_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_restaurants     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_publications ENABLE ROW LEVEL SECURITY;

RESET ROLE;

-- ============================================================================
-- Scenario 1 (assertions 1-3): E1 (claimer, non-manager) tries to approve
-- their OWN pending claim. Today's unguarded function lets this through
-- (self-approval bypass of the manager gate) — RED. The hardened function
-- must reject it, leave the claim pending, and use the generic
-- not-found-or-not-authorized message (no enumeration signal distinguishing
-- "no such claim" from "not your claim to approve").
-- ============================================================================
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"62000000-0000-0000-0000-000000000014","role":"authenticated"}', true);

SELECT is(
  (SELECT (public.approve_open_shift_claim('62000000-0000-0000-0000-000000000301', NULL) ->> 'success')::boolean),
  false,
  'Scenario 1: E1 cannot approve their own pending claim'
);

SELECT is(
  (SELECT (public.approve_open_shift_claim('62000000-0000-0000-0000-000000000301', NULL) ->> 'error')),
  'Claim not found or not authorized',
  'Scenario 1: rejected self-approval uses the generic not-found-or-not-authorized message'
);

RESET ROLE;
SET LOCAL role TO postgres;
SELECT is(
  (SELECT status FROM public.open_shift_claims WHERE id = '62000000-0000-0000-0000-000000000301'),
  'pending_approval',
  'Scenario 1: claim stays pending_approval after the rejected self-approval'
);

-- ============================================================================
-- Scenario 2 (assertions 4-5): M2 (manager of R2) tries to approve an R1
-- claim. Cross-tenant approval — RED today.
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"62000000-0000-0000-0000-000000000013","role":"authenticated"}', true);

SELECT is(
  (SELECT (public.approve_open_shift_claim('62000000-0000-0000-0000-000000000302', NULL) ->> 'success')::boolean),
  false,
  'Scenario 2: M2 (manager of R2) cannot approve an R1 claim'
);

RESET ROLE;
SET LOCAL role TO postgres;
SELECT is(
  (SELECT status FROM public.open_shift_claims WHERE id = '62000000-0000-0000-0000-000000000302'),
  'pending_approval',
  'Scenario 2: R1 claim stays pending_approval after the rejected cross-tenant approval'
);

-- ============================================================================
-- Scenario 3 (assertions 6-8): M1 (manager of R1) approves an R1 claim —
-- legitimate. Must succeed, mark the claim approved, and create the shift.
-- Already green today (no guard exists to block it); kept as a regression
-- control so the migration can't over-narrow the allowed audience.
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"62000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

SELECT is(
  (SELECT (public.approve_open_shift_claim('62000000-0000-0000-0000-000000000303', NULL) ->> 'success')::boolean),
  true,
  'Scenario 3: M1 (manager of R1) can approve an R1 claim'
);

RESET ROLE;
SET LOCAL role TO postgres;
SELECT is(
  (SELECT status FROM public.open_shift_claims WHERE id = '62000000-0000-0000-0000-000000000303'),
  'approved',
  'Scenario 3: claim is marked approved'
);

SELECT ok(
  (SELECT resulting_shift_id FROM public.open_shift_claims WHERE id = '62000000-0000-0000-0000-000000000303') IS NOT NULL,
  'Scenario 3: a shift was created and linked via resulting_shift_id'
);

-- ============================================================================
-- Scenario 3b (assertions 9-10): OM1 (operations_manager of R1) approves an
-- R1 claim — pins the operations_manager parity fix. The deployed
-- managers_review_claims RLS policy and edit:scheduling capability already
-- include operations_manager; if the new guard were narrowed back to
-- owner/manager-only, this is the assertion that would catch it (lesson
-- [2026-07-13] non-vacuous clause coverage).
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"62000000-0000-0000-0000-000000000012","role":"authenticated"}', true);

SELECT is(
  (SELECT (public.approve_open_shift_claim('62000000-0000-0000-0000-000000000304', NULL) ->> 'success')::boolean),
  true,
  'Scenario 3b: OM1 (operations_manager of R1) can approve an R1 claim'
);

RESET ROLE;
SET LOCAL role TO postgres;
SELECT is(
  (SELECT status FROM public.open_shift_claims WHERE id = '62000000-0000-0000-0000-000000000304'),
  'approved',
  'Scenario 3b: claim is marked approved by the operations_manager'
);

-- ============================================================================
-- Scenario 4 (assertions 11-12): E1 tries to reject their own claim —
-- must be denied, same as self-approval. RED today.
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"62000000-0000-0000-0000-000000000014","role":"authenticated"}', true);

SELECT is(
  (SELECT (public.reject_open_shift_claim('62000000-0000-0000-0000-000000000305', NULL) ->> 'success')::boolean),
  false,
  'Scenario 4: E1 cannot reject their own pending claim'
);

RESET ROLE;
SET LOCAL role TO postgres;
SELECT is(
  (SELECT status FROM public.open_shift_claims WHERE id = '62000000-0000-0000-0000-000000000305'),
  'pending_approval',
  'Scenario 4: claim stays pending_approval after the rejected self-reject attempt'
);

-- ============================================================================
-- Scenario 5 (assertions 13-14): M2 (manager of R2) tries to reject an R1
-- claim — cross-tenant rejection. RED today.
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"62000000-0000-0000-0000-000000000013","role":"authenticated"}', true);

SELECT is(
  (SELECT (public.reject_open_shift_claim('62000000-0000-0000-0000-000000000306', NULL) ->> 'success')::boolean),
  false,
  'Scenario 5: M2 (manager of R2) cannot reject an R1 claim'
);

RESET ROLE;
SET LOCAL role TO postgres;
SELECT is(
  (SELECT status FROM public.open_shift_claims WHERE id = '62000000-0000-0000-0000-000000000306'),
  'pending_approval',
  'Scenario 5: R1 claim stays pending_approval after the rejected cross-tenant reject'
);

-- ============================================================================
-- Scenario 6 (assertions 15-16): M1 (manager of R1) rejects an R1 claim —
-- legitimate. Regression control (already green today).
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"62000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

SELECT is(
  (SELECT (public.reject_open_shift_claim('62000000-0000-0000-0000-000000000307', NULL) ->> 'success')::boolean),
  true,
  'Scenario 6: M1 (manager of R1) can reject an R1 claim'
);

RESET ROLE;
SET LOCAL role TO postgres;
SELECT is(
  (SELECT status FROM public.open_shift_claims WHERE id = '62000000-0000-0000-0000-000000000307'),
  'rejected',
  'Scenario 6: claim is marked rejected'
);

-- ============================================================================
-- Scenario 7 (assertion 17): E1 legitimately self-claims on R3 (instant-
-- approval restaurant), using the employee row they own on R3 (...0102).
-- Regression control — claim_open_shift has never gated on the caller, so
-- this is already green; it must STAY green once the guard is added.
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"62000000-0000-0000-0000-000000000014","role":"authenticated"}', true);

SELECT is(
  (SELECT (public.claim_open_shift(
    '62000000-0000-0000-0000-000000000003'::uuid,
    '62000000-0000-0000-0000-000000000202'::uuid,
    CURRENT_DATE + 3,
    '62000000-0000-0000-0000-000000000102'::uuid
  ) ->> 'success')::boolean),
  true,
  'Scenario 7: E1 can legitimately self-claim on the instant-approval restaurant R3'
);

-- ============================================================================
-- Scenario 8 (assertions 18-19): E2 (employee of R2) calls claim_open_shift
-- for R1's template, passing E1's R1 employee id (...0101) while
-- authenticated as E2 — impersonation AND cross-tenant in one call. Today's
-- unguarded function trusts p_employee_id and would create a claim owned by
-- E1 on E2's say-so — RED. The hardened function must reject before any
-- insert happens.
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"62000000-0000-0000-0000-000000000015","role":"authenticated"}', true);

SELECT is(
  (SELECT (public.claim_open_shift(
    '62000000-0000-0000-0000-000000000001'::uuid,
    '62000000-0000-0000-0000-000000000201'::uuid,
    CURRENT_DATE + 17,
    '62000000-0000-0000-0000-000000000101'::uuid
  ) ->> 'success')::boolean),
  false,
  'Scenario 8: E2 cannot claim into R1 as E1 (impersonation + cross-tenant)'
);

RESET ROLE;
SET LOCAL role TO postgres;
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.open_shift_claims
    WHERE shift_template_id = '62000000-0000-0000-0000-000000000201'
      AND shift_date = CURRENT_DATE + 17
      AND claimed_by_employee_id = '62000000-0000-0000-0000-000000000101'
  ),
  'Scenario 8: no claim row was created by the rejected impersonation attempt'
);

-- ============================================================================
-- Scenario 9 (assertions 20-21): get_open_shifts membership check on R1's
-- open slot (template T1, CURRENT_DATE+2 — inside the published week and
-- untouched by any of the approve/reject claims above, which all live on
-- dates CURRENT_DATE+10..+16). Denied case asserted FIRST (the one that is
-- actually RED today — see the vacuous-test-trap note in the file header),
-- allowed case second as a regression control.
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"62000000-0000-0000-0000-000000000015","role":"authenticated"}', true);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.get_open_shifts(
      '62000000-0000-0000-0000-000000000001'::uuid,
      CURRENT_DATE,
      CURRENT_DATE + 6
    ) os
    WHERE os.template_id = '62000000-0000-0000-0000-000000000201'::uuid
      AND os.shift_date = CURRENT_DATE + 2
  ),
  'Scenario 9: E2 (stranger to R1) sees zero rows for R1''s open slot'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"62000000-0000-0000-0000-000000000014","role":"authenticated"}', true);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.get_open_shifts(
      '62000000-0000-0000-0000-000000000001'::uuid,
      CURRENT_DATE,
      CURRENT_DATE + 6
    ) os
    WHERE os.template_id = '62000000-0000-0000-0000-000000000201'::uuid
      AND os.shift_date = CURRENT_DATE + 2
  ),
  'Scenario 9: E1 (linked employee of R1) still sees R1''s open slot (control)'
);

-- ============================================================================
-- Cleanup
-- ============================================================================
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
