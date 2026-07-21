-- pgTAP tests for the claim_open_shift is_active guard.
--
-- Bug: claim_open_shift fetches the template inside the advisory-locked
-- section but never checked is_active, so a hidden (soft-archived) template
-- could still be claimed via the RPC even though get_open_shifts already
-- excludes its slots from the "available shifts" list an employee sees.
--
-- Fix (20260705130000_claim_open_shift_active_guard.sql): after the
-- existing "NOT FOUND -> 'Template not found'" branch, add a second branch
-- "found but is_active = false -> 'This shift is no longer available'".
-- Both branches return success:false; the inactive-branch message must not
-- vary by any other condition (no cross-tenant enumeration through message
-- shape).
--
-- Lesson 2026-04-21: always use CURRENT_DATE+N for fixture dates, never a
-- hardcoded date literal.
-- Lesson 2026-04-22: use ON CONFLICT DO UPDATE for idempotent fixture inserts.
-- Lesson (this feature, restore-path race): use a DIFFERENT employee for the
-- restore-path claim than any earlier claim so a schedule-conflict rejection
-- can't be mistaken for a false pass.
--
-- Unlike open_shift_coverage.test.sql (which tests claim_open_shift alone and
-- skips schedule_publications), this file also asserts on get_open_shifts,
-- which requires a published week. published_by FKs to auth.users, so the
-- fixture inserts a dedicated auth.users row (ON CONFLICT DO NOTHING) rather
-- than relying on some other row already existing in the test database.
--
-- Auth-context update (2026-07-21, alongside
-- supabase/migrations/20260721000000_open_shift_claim_authz_guard.sql):
-- get_open_shifts and claim_open_shift are now guarded (caller must belong
-- to the restaurant / own the employee row they're claiming as). This file
-- previously ran every RPC call as `SET LOCAL role TO postgres`
-- (auth.uid() NULL throughout), which the new guards would reject outright
-- for a reason unrelated to the is_active behavior under test. Employees d1
-- and d2 each get a dedicated auth.users row + employees.user_id, and every
-- claim_open_shift/get_open_shifts call (including test 2's NOT EXISTS
-- check, which would otherwise pass vacuously against an unauthenticated
-- caller regardless of is_active) is wrapped in
-- `SET LOCAL role = 'authenticated'` + `request.jwt.claims` impersonating
-- the right employee. RLS is re-enabled on every table before the first
-- role switch (54_accept_shift_trade_authz.sql / 62_open_shift_claim_authz
-- .test.sql precedent); admin-only steps (the is_active UPDATEs) run back
-- under `postgres`, which bypasses RLS as a superuser without needing to
-- re-disable it.

BEGIN;

SELECT plan(7);

-- Disable RLS so the function (SECURITY DEFINER) and inserts work in-transaction.
SET LOCAL role TO postgres;
ALTER TABLE public.restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_templates DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.open_shift_claims DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_publications DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.staffing_settings DISABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_rid    uuid := '00000000-0000-0000-0000-0000000000da';
  v_emp1   uuid := '00000000-0000-0000-0000-0000000000d1';
  v_emp2   uuid := '00000000-0000-0000-0000-0000000000d2';
  v_tmpl   uuid := '00000000-0000-0000-0000-0000000000d3';
  v_ghost  uuid := '00000000-0000-0000-0000-0000000000d4'; -- nonexistent template id
  v_d      date := CURRENT_DATE + 3;
  v_dow    int;
  v_user   uuid := '00000000-0000-0000-0000-0000000000d9';
  v_auth1  uuid := '00000000-0000-0000-0000-0000000000e1'; -- auth.users row owned by employee d1
  v_auth2  uuid := '00000000-0000-0000-0000-0000000000e2'; -- auth.users row owned by employee d2
BEGIN
  v_dow := EXTRACT(DOW FROM v_d)::int;

  -- Dedicated auth.users row for the publisher FK (this fixture never
  -- authenticates as this user; it's only satisfying a NOT NULL FK). Insert
  -- deterministically rather than borrowing whatever row happens to exist.
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'active-guard-test-publisher@example.com')
    ON CONFLICT (id) DO NOTHING;

  -- Dedicated auth.users rows for employees d1/d2 so the guarded RPCs below
  -- can be exercised as real `authenticated` callers (not postgres, which
  -- would leave auth.uid() NULL and make every guard check vacuous). Full
  -- column set (instance_id/aud/role/encrypted_password/etc.) matches the
  -- 54_accept_shift_trade_authz.sql / 62_open_shift_claim_authz.test.sql
  -- precedent for a row Supabase auth considers well-formed.
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
    VALUES
      (v_auth1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'active-guard-d1@example.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
      (v_auth2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'active-guard-d2@example.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
    ON CONFLICT (id) DO NOTHING;

  -- Clean up in FK order before inserting.
  DELETE FROM public.open_shift_claims     WHERE restaurant_id = v_rid;
  DELETE FROM public.schedule_publications WHERE restaurant_id = v_rid;
  DELETE FROM public.shifts                WHERE restaurant_id = v_rid;
  DELETE FROM public.shift_templates       WHERE restaurant_id = v_rid;
  DELETE FROM public.staffing_settings     WHERE restaurant_id = v_rid;
  DELETE FROM public.employees             WHERE restaurant_id = v_rid;
  DELETE FROM public.restaurants           WHERE id = v_rid;

  INSERT INTO public.restaurants(id, name, timezone)
    VALUES (v_rid, 'active-guard-test', 'America/Chicago')
    ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

  INSERT INTO public.employees(id, restaurant_id, user_id, name, position, is_active, status)
    VALUES
      (v_emp1, v_rid, v_auth1, 'E1', 'Server', true, 'active'),
      (v_emp2, v_rid, v_auth2, 'E2', 'Server', true, 'active')
    ON CONFLICT (id) DO UPDATE SET position = EXCLUDED.position, user_id = EXCLUDED.user_id;

  -- Cap-2 template, starts active. No existing shifts, so it always has
  -- open capacity while is_active = true (min_concurrent stays 0 < 2).
  INSERT INTO public.shift_templates(
      id, restaurant_id, name, start_time, end_time, position, capacity,
      days, is_active, break_duration
  ) VALUES (
      v_tmpl, v_rid, 'Server 12-18',
      '12:00'::time, '18:00'::time, 'Server', 2,
      ARRAY[v_dow], true, 0
  ) ON CONFLICT (id) DO UPDATE
      SET days = EXCLUDED.days, capacity = EXCLUDED.capacity, is_active = true;

  -- open_shifts_enabled = true, no approval required, so claims resolve
  -- synchronously to success/failure.
  INSERT INTO public.staffing_settings(restaurant_id, open_shifts_enabled, require_shift_claim_approval)
    VALUES (v_rid, true, false)
    ON CONFLICT (restaurant_id) DO UPDATE
      SET open_shifts_enabled = true, require_shift_claim_approval = false;

  -- get_open_shifts only considers dates inside a published week that are
  -- today or later, so publish a week covering v_d.
  INSERT INTO public.schedule_publications(
      restaurant_id, week_start_date, week_end_date, published_by
  ) VALUES (
      v_rid, CURRENT_DATE, CURRENT_DATE + 6, v_user
  );
END $$;

-- CRITICAL: re-enable RLS on every table disabled above before switching to
-- the authenticated role (54_accept_shift_trade_authz.sql /
-- 62_open_shift_claim_authz.test.sql precedent). `postgres` still bypasses
-- RLS as a superuser, so the admin-only is_active UPDATEs later in this file
-- don't need it disabled again.
ALTER TABLE public.restaurants           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_templates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.open_shift_claims     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staffing_settings     ENABLE ROW LEVEL SECURITY;

RESET ROLE;

-- ── Test 1: active template ⇒ get_open_shifts includes the slot ─────────────
-- Impersonate d1 (employee linked to the restaurant) so this exercises the
-- real `authenticated` GRANT + get_open_shifts membership guard rather than
-- running as postgres (auth.uid() NULL).
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.get_open_shifts(
      '00000000-0000-0000-0000-0000000000da'::uuid,
      CURRENT_DATE,
      CURRENT_DATE + 6
    ) os
    WHERE os.template_id = '00000000-0000-0000-0000-0000000000d3'::uuid
      AND os.shift_date = CURRENT_DATE + 3
  ),
  'active template: get_open_shifts includes its slot'
);

-- ── Test 2: hide the template (is_active = false) ────────────────────────────
RESET ROLE;
SET LOCAL role TO postgres;
UPDATE public.shift_templates
  SET is_active = false
  WHERE id = '00000000-0000-0000-0000-0000000000d3'
    AND restaurant_id = '00000000-0000-0000-0000-0000000000da';

-- Impersonate d1 again for the get_open_shifts read-back. Left as `postgres`
-- this would pass vacuously post-guard (an unauthenticated caller always
-- gets an empty set), no longer proving the is_active filter this test is
-- named for — must run as a real linked employee.
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.get_open_shifts(
      '00000000-0000-0000-0000-0000000000da'::uuid,
      CURRENT_DATE,
      CURRENT_DATE + 6
    ) os
    WHERE os.template_id = '00000000-0000-0000-0000-0000000000d3'::uuid
      AND os.shift_date = CURRENT_DATE + 3
  ),
  'hidden template: get_open_shifts excludes its slot'
);

-- ── Test 3: claim_open_shift on a hidden template ⇒ success:false ────────────
-- Impersonate d1 — claim_open_shift's caller-owns-employee-row guard
-- requires auth.uid() to match p_employee_id (d1 here), so the call must run
-- as d1's auth user, not postgres.
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);

SELECT is(
  (
    public.claim_open_shift(
      '00000000-0000-0000-0000-0000000000da'::uuid,
      '00000000-0000-0000-0000-0000000000d3'::uuid,
      CURRENT_DATE + 3,
      '00000000-0000-0000-0000-0000000000d1'::uuid
    ) ->> 'success'
  ),
  'false',
  'claim rejected for a hidden (is_active = false) template'
);

-- ── Test 4: the hidden-template message text ─────────────────────────────────
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);

SELECT is(
  (
    public.claim_open_shift(
      '00000000-0000-0000-0000-0000000000da'::uuid,
      '00000000-0000-0000-0000-0000000000d3'::uuid,
      CURRENT_DATE + 3,
      '00000000-0000-0000-0000-0000000000d1'::uuid
    ) ->> 'error'
  ),
  'This shift is no longer available',
  'hidden-template claim error message is the dedicated "no longer available" text'
);

-- ── Test 5: nonexistent template id ⇒ distinct 'Template not found' branch ──
-- Proves the inactive branch and the not-found branch stay separate (no
-- cross-tenant enumeration through message shape collapsing the two cases).
-- Still impersonating d1: the caller-owns-employee-row guard must pass
-- (d1 legitimately owns the employee id it's claiming as) before the RPC
-- ever reaches the template lookup this test targets.
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);

SELECT is(
  (
    public.claim_open_shift(
      '00000000-0000-0000-0000-0000000000da'::uuid,
      '00000000-0000-0000-0000-0000000000d4'::uuid, -- v_ghost: never inserted
      CURRENT_DATE + 3,
      '00000000-0000-0000-0000-0000000000d1'::uuid
    ) ->> 'error'
  ),
  'Template not found',
  'nonexistent template id still returns Template not found (distinct from the inactive branch)'
);

-- ── Test 6: restore the template (is_active = true) ─────────────────────────
RESET ROLE;
SET LOCAL role TO postgres;
UPDATE public.shift_templates
  SET is_active = true
  WHERE id = '00000000-0000-0000-0000-0000000000d3'
    AND restaurant_id = '00000000-0000-0000-0000-0000000000da';

RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.get_open_shifts(
      '00000000-0000-0000-0000-0000000000da'::uuid,
      CURRENT_DATE,
      CURRENT_DATE + 6
    ) os
    WHERE os.template_id = '00000000-0000-0000-0000-0000000000d3'::uuid
      AND os.shift_date = CURRENT_DATE + 3
  ),
  'restored template: get_open_shifts includes its slot again'
);

-- ── Test 7: restore-path claim succeeds, using a DIFFERENT employee ─────────
-- Uses v_emp2 (never claimed anything in this test file) so a
-- schedule-conflict rejection from v_emp1's earlier (rejected) claim attempt
-- cannot masquerade as this test passing for the wrong reason. Impersonated
-- as d2's own auth user (v_auth2) so the caller-owns-employee-row guard
-- passes for this employee, not d1's.
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);

SELECT is(
  (
    public.claim_open_shift(
      '00000000-0000-0000-0000-0000000000da'::uuid,
      '00000000-0000-0000-0000-0000000000d3'::uuid,
      CURRENT_DATE + 3,
      '00000000-0000-0000-0000-0000000000d2'::uuid
    ) ->> 'success'
  ),
  'true',
  'restored template: claim succeeds again for a fresh employee'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
