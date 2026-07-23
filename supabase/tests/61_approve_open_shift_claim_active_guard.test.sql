-- pgTAP tests for the approve_open_shift_claim is_active guard.
--
-- Bug: claim_open_shift already rejects new claims against a hidden
-- (is_active = false) template (see 60_claim_open_shift_active_guard.test.sql).
-- But a claim can be left in 'pending_approval' from before the template was
-- hidden (approval-required restaurants insert the claim without creating a
-- shift). approve_open_shift_claim fetched the template by id without
-- checking is_active, so a manager could still approve a hidden template's
-- pending claim and create a new assignment.
--
-- Fix (20260707090000_approve_open_shift_claim_active_guard.sql): after the
-- existing "NOT FOUND -> 'Template not found'" branch, add a second branch
-- "found but is_active = false -> 'This shift is no longer available'".
--
-- Lesson 2026-04-21: always use CURRENT_DATE+N for fixture dates, never a
-- hardcoded date literal.
-- Lesson 2026-04-22: use ON CONFLICT DO UPDATE for idempotent fixture inserts.
--
-- Auth-context update (2026-07-21, alongside
-- supabase/migrations/20260721000000_open_shift_claim_authz_guard.sql):
-- approve_open_shift_claim is now guarded (caller must be an owner/manager/
-- operations_manager of the claim's restaurant). This file previously ran
-- every approve_open_shift_claim call as `SET LOCAL role TO postgres`
-- (auth.uid() NULL throughout), which the new guard now rejects outright
-- ("Claim not found or not authorized") before ever reaching the is_active
-- branch this file targets. A dedicated manager (M1) gets an auth.users row
-- + a `user_restaurants` row with role 'manager', and every
-- approve_open_shift_claim call below is wrapped in
-- `SET LOCAL role = 'authenticated'` + `request.jwt.claims` impersonating
-- M1. RLS is re-enabled on every table (including user_restaurants) before
-- the first role switch (54_accept_shift_trade_authz.sql /
-- 62_open_shift_claim_authz.test.sql / 60_claim_open_shift_active_guard
-- .test.sql precedent); admin-only steps (the is_active UPDATEs) run back
-- under `postgres`, which bypasses RLS as a superuser without needing to
-- re-disable it. Only the caller context changes — the is_active semantics
-- under test are untouched.

BEGIN;

SELECT plan(4);

-- Disable RLS so the function (SECURITY DEFINER) and inserts work in-transaction.
SET LOCAL role TO postgres;
ALTER TABLE public.restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_templates DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.open_shift_claims DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.staffing_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_restaurants DISABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_rid    uuid := '00000000-0000-0000-0000-0000000000ea';
  v_emp1   uuid := '00000000-0000-0000-0000-0000000000e1';
  v_emp2   uuid := '00000000-0000-0000-0000-0000000000e2';
  v_tmpl   uuid := '00000000-0000-0000-0000-0000000000e3';
  v_claim  uuid := '00000000-0000-0000-0000-0000000000e5';
  v_claim2 uuid := '00000000-0000-0000-0000-0000000000e6';
  v_d      date := CURRENT_DATE + 3;
  v_dow    int;
  v_mgr    uuid := '00000000-0000-0000-0000-0000000000e9'; -- auth.users row for M1 (manager, R1)
BEGIN
  v_dow := EXTRACT(DOW FROM v_d)::int;

  -- Dedicated auth.users row for M1 (manager of this test's restaurant) so
  -- approve_open_shift_claim's owner/manager/operations_manager guard can be
  -- exercised as a real `authenticated` caller (not postgres, which would
  -- leave auth.uid() NULL and make the guard reject every call). Full
  -- column set matches the 54_accept_shift_trade_authz.sql /
  -- 62_open_shift_claim_authz.test.sql / 60_claim_open_shift_active_guard
  -- .test.sql precedent for a row Supabase auth considers well-formed.
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
    VALUES
      (v_mgr, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'approve-guard-m1@example.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

  -- Clean up in FK order before inserting.
  DELETE FROM public.open_shift_claims  WHERE restaurant_id = v_rid;
  DELETE FROM public.shifts             WHERE restaurant_id = v_rid;
  DELETE FROM public.shift_templates    WHERE restaurant_id = v_rid;
  DELETE FROM public.staffing_settings  WHERE restaurant_id = v_rid;
  DELETE FROM public.user_restaurants   WHERE restaurant_id = v_rid;
  DELETE FROM public.employees          WHERE restaurant_id = v_rid;
  DELETE FROM public.restaurants        WHERE id = v_rid;

  INSERT INTO public.restaurants(id, name, timezone)
    VALUES (v_rid, 'approve-guard-test', 'America/Chicago')
    ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

  INSERT INTO public.employees(id, restaurant_id, name, position, is_active, status)
    VALUES
      (v_emp1, v_rid, 'E1', 'Server', true, 'active'),
      (v_emp2, v_rid, 'E2', 'Server', true, 'active')
    ON CONFLICT (id) DO UPDATE SET position = EXCLUDED.position;

  -- M1: manager of this restaurant — the caller every approve_open_shift_claim
  -- assertion below impersonates.
  INSERT INTO public.user_restaurants(user_id, restaurant_id, role)
    VALUES (v_mgr, v_rid, 'manager')
    ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

  -- Template starts active so the pending claim below is legitimately
  -- created, then gets hidden before approval is attempted.
  INSERT INTO public.shift_templates(
      id, restaurant_id, name, start_time, end_time, position, capacity,
      days, is_active, break_duration
  ) VALUES (
      v_tmpl, v_rid, 'Server 12-18',
      '12:00'::time, '18:00'::time, 'Server', 2,
      ARRAY[v_dow], true, 0
  ) ON CONFLICT (id) DO UPDATE
      SET days = EXCLUDED.days, capacity = EXCLUDED.capacity, is_active = true;

  INSERT INTO public.staffing_settings(restaurant_id, open_shifts_enabled, require_shift_claim_approval)
    VALUES (v_rid, true, true)
    ON CONFLICT (restaurant_id) DO UPDATE
      SET open_shifts_enabled = true, require_shift_claim_approval = true;

  -- Pending claim created while the template was still active.
  INSERT INTO public.open_shift_claims(
      id, restaurant_id, shift_template_id, shift_date,
      claimed_by_employee_id, status
  ) VALUES (
      v_claim, v_rid, v_tmpl, v_d, v_emp1, 'pending_approval'
  );

  -- Second pending claim (different employee — the unique index on
  -- (shift_template_id, shift_date, claimed_by_employee_id) forbids a
  -- second active claim for the same employee/template/date), used for the
  -- "still active" control case.
  INSERT INTO public.open_shift_claims(
      id, restaurant_id, shift_template_id, shift_date,
      claimed_by_employee_id, status
  ) VALUES (
      v_claim2, v_rid, v_tmpl, v_d, v_emp2, 'pending_approval'
  );
END $$;

-- CRITICAL: re-enable RLS on every table disabled above before switching to
-- the authenticated role (54_accept_shift_trade_authz.sql /
-- 62_open_shift_claim_authz.test.sql / 60_claim_open_shift_active_guard
-- .test.sql precedent). `postgres` still bypasses RLS as a superuser, so the
-- admin-only is_active UPDATEs later in this file don't need it disabled
-- again.
ALTER TABLE public.restaurants        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_templates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.open_shift_claims  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staffing_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_restaurants   ENABLE ROW LEVEL SECURITY;

RESET ROLE;

-- ── Test 1: hide the template after the claim was submitted ─────────────────
-- Admin-only step (toggling is_active) stays as postgres.
SET LOCAL role TO postgres;
UPDATE public.shift_templates
  SET is_active = false
  WHERE id = '00000000-0000-0000-0000-0000000000e3'
    AND restaurant_id = '00000000-0000-0000-0000-0000000000ea';

-- Impersonate M1 (manager of this restaurant) for the approve_open_shift_claim
-- call — the new owner/manager/operations_manager guard requires a real
-- `authenticated` caller who belongs to the restaurant, not postgres
-- (auth.uid() NULL), which the guard now rejects outright.
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e9","role":"authenticated"}', true);

SELECT is(
  (
    public.approve_open_shift_claim(
      '00000000-0000-0000-0000-0000000000e5'::uuid,
      NULL
    ) ->> 'success'
  ),
  'false',
  'approval rejected for a pending claim on a now-hidden template'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e9","role":"authenticated"}', true);

SELECT is(
  (
    public.approve_open_shift_claim(
      '00000000-0000-0000-0000-0000000000e5'::uuid,
      NULL
    ) ->> 'error'
  ),
  'This shift is no longer available',
  'hidden-template approval error message is the dedicated "no longer available" text'
);

-- ── Test 3: the claim itself is left pending (not force-rejected) ───────────
-- Read-back only, no RPC call — runs as postgres per the
-- setup+read-backs-stay-postgres precedent.
RESET ROLE;
SET LOCAL role TO postgres;
SELECT is(
  (SELECT status FROM public.open_shift_claims WHERE id = '00000000-0000-0000-0000-0000000000e5'),
  'pending_approval',
  'blocked approval leaves the claim in pending_approval (no shift created, no status mutation)'
);

-- ── Test 4: restore the template ⇒ the other pending claim can be approved ──
RESET ROLE;
SET LOCAL role TO postgres;
UPDATE public.shift_templates
  SET is_active = true
  WHERE id = '00000000-0000-0000-0000-0000000000e3'
    AND restaurant_id = '00000000-0000-0000-0000-0000000000ea';

RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e9","role":"authenticated"}', true);

SELECT is(
  (
    public.approve_open_shift_claim(
      '00000000-0000-0000-0000-0000000000e6'::uuid,
      NULL
    ) ->> 'success'
  ),
  'true',
  'restored template: approval succeeds again for a fresh pending claim'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
