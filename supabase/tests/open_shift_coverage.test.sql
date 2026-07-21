-- pgTAP tests for shift_slot_min_concurrent coverage function.
--
-- Coverage model: a template slot is "staffed" only when, at every minute of
-- its window [W0, W1], at least `capacity` same-position distinct employees are
-- present. This replaces the old exact time-match approach where non-matching
-- fill-ins were invisible.
--
-- Non-tautological design: the fixture's shift does NOT exactly match the
-- template window (it's 15:00-23:00, template is 16:00-22:30) so the old
-- exact-match would count 0; we assert min_concurrent=1 instead.
--
-- Lesson 2026-04-21: always use CURRENT_DATE+N for fixture dates.
-- Lesson 2026-04-22: use ON CONFLICT DO UPDATE for idempotent inserts.
--
-- Auth-context update (2026-07-21, alongside
-- supabase/migrations/20260721000000_open_shift_claim_authz_guard.sql):
-- claim_open_shift is now guarded (caller must own the employee row they're
-- claiming as). Test 5 calls claim_open_shift as E2; left running as
-- `SET LOCAL role TO postgres` (auth.uid() NULL throughout) the new guard
-- would reject the call before ever reaching the coverage/capacity logic
-- this test is named for, making the assertion pass vacuously (lesson
-- 2026-07-13's vacuous-test trap). E2 gets a dedicated auth.users row +
-- employees.user_id, RLS is re-enabled on every table disabled below before
-- switching roles (54_accept_shift_trade_authz.sql / 62_open_shift_claim_authz
-- .test.sql precedent), and the claim_open_shift call runs impersonated as
-- E2's own auth user via `SET LOCAL role = 'authenticated'` + request.jwt.claims.

BEGIN;

SELECT plan(5);

-- Disable RLS so the function (SECURITY DEFINER) and inserts work in-transaction.
SET LOCAL role TO postgres;
ALTER TABLE public.restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts DISABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_rid   uuid := '00000000-0000-0000-0000-0000000000aa';
  v_emp1  uuid := '00000000-0000-0000-0000-0000000000b1';
  v_emp2  uuid := '00000000-0000-0000-0000-0000000000b2';
  v_tmpl  uuid := '00000000-0000-0000-0000-0000000000c1';
  v_d     date := CURRENT_DATE + 2;
  v_dow   int;
  v_auth2 uuid := '00000000-0000-0000-0000-0000000000e3'; -- auth.users row owned by employee b2 (E2, test 5 caller)
BEGIN
  v_dow := EXTRACT(DOW FROM v_d)::int;

  -- Dedicated auth.users row for E2 (test 5's caller) so claim_open_shift's
  -- caller-owns-employee-row guard can be exercised as a real `authenticated`
  -- caller (not postgres, which would leave auth.uid() NULL and make the
  -- guard check vacuous). Full column set matches the
  -- 54_accept_shift_trade_authz.sql / 60_claim_open_shift_active_guard.test.sql
  -- precedent for a row Supabase auth considers well-formed.
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
    VALUES
      (v_auth2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cov-test-e2@example.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
    ON CONFLICT (id) DO NOTHING;

  -- Clean up in FK order before inserting
  DELETE FROM public.open_shift_claims  WHERE restaurant_id = v_rid;
  DELETE FROM public.shifts             WHERE restaurant_id = v_rid;
  DELETE FROM public.shift_templates    WHERE restaurant_id = v_rid;
  DELETE FROM public.staffing_settings  WHERE restaurant_id = v_rid;
  DELETE FROM public.employees          WHERE restaurant_id = v_rid;
  DELETE FROM public.restaurants        WHERE id = v_rid;

  INSERT INTO public.restaurants(id, name, timezone)
    VALUES (v_rid, 'cov-test', 'America/Chicago')
    ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

  INSERT INTO public.employees(id, restaurant_id, user_id, name, position, is_active, status)
    VALUES
      (v_emp1, v_rid, NULL, 'E1', 'Server', true, 'active'),
      (v_emp2, v_rid, v_auth2, 'E2', 'Server', true, 'active')
    ON CONFLICT (id) DO UPDATE SET position = EXCLUDED.position, user_id = EXCLUDED.user_id;

  -- Mid-shift fill-in whose window does NOT exactly match 16:00-22:30
  -- (starts 15:00, ends 23:00 local = covers 16:00-22:30 fully).
  -- The old exact-match would count 0 for the 16:00-22:30 slot; coverage gives 1.
  INSERT INTO public.shifts(restaurant_id, employee_id, start_time, end_time, position, status)
    VALUES (
      v_rid, v_emp1,
      (v_d::text || ' 15:00')::timestamp AT TIME ZONE 'America/Chicago',
      (v_d::text || ' 23:00')::timestamp AT TIME ZONE 'America/Chicago',
      'Server', 'scheduled'
    );

  -- Shift template for cap-1 16:00-22:30, active on the same day-of-week as v_d.
  -- Required by claim_open_shift to look up position/times/capacity.
  INSERT INTO public.shift_templates(
      id, restaurant_id, name, start_time, end_time, position, capacity,
      days, is_active, break_duration
  ) VALUES (
      v_tmpl, v_rid, 'Server 16-22:30',
      '16:00'::time, '22:30'::time, 'Server', 1,
      ARRAY[v_dow], true, 0
  ) ON CONFLICT (id) DO UPDATE
      SET days = EXCLUDED.days, capacity = EXCLUDED.capacity;

  -- open_shifts_enabled = true so claim_open_shift won't return early.
  INSERT INTO public.staffing_settings(restaurant_id, open_shifts_enabled, require_shift_claim_approval)
    VALUES (v_rid, true, false)
    ON CONFLICT (restaurant_id) DO UPDATE
      SET open_shifts_enabled = true, require_shift_claim_approval = false;

  -- NOTE: schedule_publications is NOT inserted here because claim_open_shift
  -- does not check it (no published-dates gate in that function). Inserting it
  -- would require a valid auth.users FK.
END $$;

-- ── Test 1: fill-in covering the full 16:00-22:30 window ─────────────────────
-- The fill-in (15:00-23:00) overlaps the entire template window, so every
-- minute in [16:00, 22:30] has n=1. min_concurrent must be 1, not 0.
-- (Exact-match on time would return 0 — this proves the bug is fixed.)
SELECT is(
  public.shift_slot_min_concurrent(
    '00000000-0000-0000-0000-0000000000aa'::uuid,
    'Server',
    CURRENT_DATE + 2,
    '16:00'::time,
    '22:30'::time,
    'America/Chicago'
  ),
  1,
  'fill-in overlapping the full window yields min_concurrent 1 (exact-match would be 0)'
);

-- ── Test 2: empty window (no shifts at all) ───────────────────────────────────
SELECT is(
  public.shift_slot_min_concurrent(
    '00000000-0000-0000-0000-0000000000aa'::uuid,
    'Server',
    CURRENT_DATE + 2,
    '06:00'::time,
    '09:00'::time,
    'America/Chicago'
  ),
  0,
  'empty window (no shifts) yields min_concurrent 0'
);

-- ── Test 3: position mismatch ─────────────────────────────────────────────────
-- The fixture shift is position='Server'; querying 'Cook' must return 0.
SELECT is(
  public.shift_slot_min_concurrent(
    '00000000-0000-0000-0000-0000000000aa'::uuid,
    'Cook',
    CURRENT_DATE + 2,
    '16:00'::time,
    '22:30'::time,
    'America/Chicago'
  ),
  0,
  'position mismatch (Server shift vs Cook query) yields 0'
);

-- ── Test 4: trailing gap — shift ends before window closes ───────────────────
-- The fixture shift ends 23:00; a 16:00-23:30 window has an uncovered
-- 23:00-23:30 stretch, so min_concurrent drops to 0.
SELECT is(
  public.shift_slot_min_concurrent(
    '00000000-0000-0000-0000-0000000000aa'::uuid,
    'Server',
    CURRENT_DATE + 2,
    '16:00'::time,
    '23:30'::time,
    'America/Chicago'
  ),
  0,
  'trailing gap (shift ends before window) yields min_concurrent 0'
);

-- ── Test 5: claim_open_shift rejected when coverage already fills the slot ────
-- The fill-in (E1, 15:00-23:00) covers the cap-1 16:00-22:30 template window
-- with min_concurrent=1, so open_spots=0.  E2 tries to claim; the guard must
-- detect coverage (not exact-match) and return success=false.
-- Under old exact-match the guard would count assigned=0 (no 16:00-22:30 shift)
-- and allow the claim — proving the double-claim bug is fixed.
--
-- Re-enable RLS on every table disabled above before switching to the
-- authenticated role (54_accept_shift_trade_authz.sql /
-- 62_open_shift_claim_authz.test.sql precedent), then impersonate E2 (the
-- caller) so claim_open_shift's caller-owns-employee-row guard passes and
-- the call actually reaches the coverage/capacity logic under test, instead
-- of being rejected vacuously as an unauthenticated postgres caller.
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts      ENABLE ROW LEVEL SECURITY;
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e3","role":"authenticated"}', true);

SELECT is(
  (
    public.claim_open_shift(
      '00000000-0000-0000-0000-0000000000aa'::uuid,
      '00000000-0000-0000-0000-0000000000c1'::uuid,
      CURRENT_DATE + 2,
      '00000000-0000-0000-0000-0000000000b2'::uuid
    ) ->> 'success'
  ),
  'false',
  'claim rejected when coverage-based guard shows slot is already full'
);

SELECT * FROM finish();
ROLLBACK;
