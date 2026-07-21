-- pgTAP regression test: capacity-1 templates must be claimable open shifts.
--
-- Bug: get_open_shifts filtered templates with `st.capacity > 1`, silently
-- excluding single-person crew allocations (e.g. the AI scheduler's "1 Server")
-- from the open-shift pool. They were applied to shift_templates and surfaced
-- an "open shifts created" toast, but never appeared as claimable shifts.
-- Fix changes the guard to `st.capacity > 0`.
--
-- Also pins that claim_open_shift's capacity guard
-- (`assigned + pending >= capacity`) correctly blocks the 2nd claim on a
-- capacity-1 template.
--
-- Auth-context update (2026-07-21, alongside
-- supabase/migrations/20260721000000_open_shift_claim_authz_guard.sql):
-- get_open_shifts and claim_open_shift are now guarded (caller must belong
-- to the restaurant / own the employee row they claim as). This file
-- previously ran every RPC call as `SET LOCAL role TO postgres`
-- (auth.uid() NULL throughout). Every employee that actually calls a guarded
-- RPC below gets a dedicated auth.users row + employees.user_id, mirroring
-- the 54/60/61/62 precedent, and each guarded call is wrapped in
-- `SET LOCAL role = 'authenticated'` + `request.jwt.claims` impersonating
-- the right employee (including the get_open_shifts calls in Tests 2 and 4,
-- which would otherwise pass vacuously against an unauthenticated caller —
-- the same vacuous-test trap called out for 60's test 2 / design scenario 9).
-- RLS is re-enabled on every table before the first role switch; admin-only
-- fixture inserts stay under `postgres`, which bypasses RLS as a superuser.

BEGIN;

SELECT plan(4);

-- ============================================
-- Setup: disable RLS and seed test data
-- ============================================

SET LOCAL role TO postgres;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE shift_templates DISABLE ROW LEVEL SECURITY;
ALTER TABLE shifts DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE staffing_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_publications DISABLE ROW LEVEL SECURITY;
ALTER TABLE open_shift_claims DISABLE ROW LEVEL SECURITY;

-- Compute a target Sunday that is always in the future (never hardcode
-- future dates — see lessons 2026-04-21). DOW=0 is Sunday; when today is
-- Sunday, +7 avoids using today.
CREATE TEMP TABLE test_config AS
SELECT CURRENT_DATE + (7 - EXTRACT(DOW FROM CURRENT_DATE)::int) AS target_sunday;

-- test_config is read from `authenticated`-impersonated RPC-call assertions
-- below (Tests 1, 2, 3), so the `authenticated` role needs SELECT on it.
GRANT SELECT ON test_config TO authenticated;

-- Auth user for FK references (schedule_publications.published_by)
INSERT INTO auth.users (id, email)
VALUES ('dddddddd-ca01-0000-0000-000000000001', 'cap1-test@example.com')
ON CONFLICT DO NOTHING;

-- Dedicated auth.users rows for employees 1 and 2 (the callers of
-- claim_open_shift / get_open_shifts below), so the guarded RPCs can be
-- exercised as real `authenticated` callers instead of `postgres`
-- (auth.uid() NULL). Full column set matches the 54/60/61/62 precedent for a
-- row Supabase auth considers well-formed.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('eeeeeeee-ca01-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cap1-test-emp1@example.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('eeeeeeee-ca01-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cap1-test-emp2@example.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Restaurant in CDT timezone
INSERT INTO restaurants (id, name, timezone)
VALUES ('aaaaaaaa-ca01-0000-0000-000000000001', 'Cap1 Test Restaurant', 'America/Chicago')
ON CONFLICT (id) DO UPDATE SET timezone = 'America/Chicago';

-- Template: capacity = 1 (the regression case). Closing 3:30p-10p Sundays.
INSERT INTO shift_templates (id, restaurant_id, name, start_time, end_time, position, days, capacity, is_active)
VALUES (
  'bbbbbbbb-ca01-0000-0000-000000000001',
  'aaaaaaaa-ca01-0000-0000-000000000001',
  'Solo Closer',
  '15:30:00', '22:00:00',
  'Server',
  '{0}',  -- Sunday only
  1,      -- single-person crew
  true
)
ON CONFLICT (id) DO UPDATE SET capacity = 1, is_active = true;

-- Two employees (second one drives the "no open spots" 2nd-claim test) —
-- each linked to its own auth.users row.
INSERT INTO employees (id, restaurant_id, user_id, name, position, status, is_active)
VALUES
  ('cccccccc-ca01-0000-0000-000000000001', 'aaaaaaaa-ca01-0000-0000-000000000001', 'eeeeeeee-ca01-0000-0000-000000000001', 'Cap1 Emp 1', 'Server', 'active', true),
  ('cccccccc-ca01-0000-0000-000000000002', 'aaaaaaaa-ca01-0000-0000-000000000001', 'eeeeeeee-ca01-0000-0000-000000000002', 'Cap1 Emp 2', 'Server', 'active', true)
ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id;

-- Enable open shifts, NO approval required (instant claim creates the shift).
INSERT INTO staffing_settings (restaurant_id, open_shifts_enabled, require_shift_claim_approval)
VALUES ('aaaaaaaa-ca01-0000-0000-000000000001', true, false)
ON CONFLICT (restaurant_id) DO UPDATE
SET open_shifts_enabled = true, require_shift_claim_approval = false;

-- Publish schedule for the week ending on target_sunday.
INSERT INTO schedule_publications (restaurant_id, week_start_date, week_end_date, published_by, shift_count)
SELECT
  'aaaaaaaa-ca01-0000-0000-000000000001',
  target_sunday - 6,
  target_sunday,
  'dddddddd-ca01-0000-0000-000000000001',
  0
FROM test_config
ON CONFLICT DO NOTHING;

-- CRITICAL: re-enable RLS on every table disabled above before switching to
-- the authenticated role (54/60/61/62 precedent). `postgres` still bypasses
-- RLS as a superuser, so the second restaurant's fixture DO block later in
-- this file doesn't need it disabled again.
ALTER TABLE restaurants           ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_templates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees              ENABLE ROW LEVEL SECURITY;
ALTER TABLE staffing_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE open_shift_claims     ENABLE ROW LEVEL SECURITY;

RESET ROLE;

-- ============================================
-- Test 1: capacity-1 template appears as a claimable open shift.
-- (Fails before the fix: `st.capacity > 1` excludes the template entirely,
--  so get_open_shifts returns NO row and open_spots comes back NULL.)
-- Impersonate employee 1 (linked to the restaurant) — get_open_shifts'
-- membership guard requires a real authenticated caller belonging to the
-- restaurant, not postgres (auth.uid() NULL).
-- ============================================

SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"eeeeeeee-ca01-0000-0000-000000000001","role":"authenticated"}', true);

SELECT is(
  (
    SELECT open_spots
    FROM get_open_shifts(
      'aaaaaaaa-ca01-0000-0000-000000000001',
      (SELECT target_sunday - 6 FROM test_config),
      (SELECT target_sunday FROM test_config)
    )
    WHERE shift_date = (SELECT target_sunday FROM test_config)
    LIMIT 1
  ),
  1::bigint,
  'capacity-1 template shows 1 open spot in get_open_shifts'
);

RESET ROLE;

-- ============================================
-- Test 2: after one instant claim, the now-full capacity-1 template is no
-- longer returned by get_open_shifts.
--
-- Note on WHY it drops out: instant claim inserts an open_shift_claims row
-- with status='approved' (not 'pending_approval'), so the pending_claims CTE
-- stays 0. The slot count is driven to 0 by assigned_count (the shifts join
-- on position+time+date), then the final `open_spots > 0` WHERE filters it.
--
-- Both the claim and the get_open_shifts read-back are impersonated as
-- employee 1: the claim_open_shift caller-owns-employee-row guard requires
-- auth.uid() to match p_employee_id, and leaving the read-back as postgres
-- would make the NOT EXISTS assertion pass vacuously (an unauthenticated
-- caller always sees an empty set) regardless of capacity.
-- ============================================

SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"eeeeeeee-ca01-0000-0000-000000000001","role":"authenticated"}', true);

-- Instant claim by employee 1.
SELECT claim_open_shift(
  'aaaaaaaa-ca01-0000-0000-000000000001',
  'bbbbbbbb-ca01-0000-0000-000000000001',
  (SELECT target_sunday FROM test_config),
  'cccccccc-ca01-0000-0000-000000000001'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM get_open_shifts(
      'aaaaaaaa-ca01-0000-0000-000000000001',
      (SELECT target_sunday - 6 FROM test_config),
      (SELECT target_sunday FROM test_config)
    )
    WHERE shift_date = (SELECT target_sunday FROM test_config)
  ),
  'fully-claimed capacity-1 template is filtered out of get_open_shifts'
);

RESET ROLE;

-- ============================================
-- Test 3: a second claim on the full capacity-1 template is rejected by
-- claim_open_shift's capacity guard (assigned 1 + pending 0 >= capacity 1).
-- Uses employee 2 so the capacity guard — not the schedule-conflict check —
-- is what rejects it. Impersonated as employee 2's own auth user so the
-- caller-owns-employee-row guard passes before the capacity guard is
-- reached.
-- ============================================

SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"eeeeeeee-ca01-0000-0000-000000000002","role":"authenticated"}', true);

SELECT is(
  (
    SELECT (result->>'success')::boolean
    FROM (
      SELECT claim_open_shift(
        'aaaaaaaa-ca01-0000-0000-000000000001',
        'bbbbbbbb-ca01-0000-0000-000000000001',
        (SELECT target_sunday FROM test_config),
        'cccccccc-ca01-0000-0000-000000000002'
      ) AS result
    ) sub
  ),
  false,
  'second claim on full capacity-1 template returns success=false'
);

RESET ROLE;

-- ============================================
-- Test 4: a fill-in shift (non-exact-match window) DOES reduce open_spots
-- under coverage-based get_open_shifts.
--
-- Under the old exact-match approach, a shift with a different start/end time
-- than the template was invisible to get_open_shifts (assigned_count=0).
-- Under coverage, shift_slot_min_concurrent counts any overlapping shift, so
-- a fill-in that covers the entire template window yields 0 open_spots.
--
-- Fixture: new restaurant + template (Tue 10:00-16:30 cap 1) + a fill-in
-- shift 09:00-17:00 (overlaps the entire window but does NOT exactly match).
-- Expected: get_open_shifts returns 0 rows (slot is fully covered).
-- ============================================

SET LOCAL role TO postgres;

DO $$
DECLARE
  v_rid  uuid := 'aaaaaaaa-ca01-0000-0000-000000000002';
  v_emp  uuid := 'cccccccc-ca01-0000-0000-000000000010';
  v_tmpl uuid := 'bbbbbbbb-ca01-0000-0000-000000000010';
  v_uid  uuid := 'dddddddd-ca01-0000-0000-000000000002';
  v_auth uuid := 'eeeeeeee-ca01-0000-0000-000000000010'; -- auth.users row for the FillIn employee
  -- Find next Tuesday that is in the future (DOW 2)
  v_d    date := CURRENT_DATE + ((2 - EXTRACT(DOW FROM CURRENT_DATE)::int + 7) % 7);
BEGIN
  -- Ensure next Tuesday is strictly in the future
  IF v_d <= CURRENT_DATE THEN v_d := v_d + 7; END IF;

  DELETE FROM public.shifts          WHERE restaurant_id = v_rid;
  DELETE FROM public.open_shift_claims WHERE restaurant_id = v_rid;
  DELETE FROM public.schedule_publications WHERE restaurant_id = v_rid;
  DELETE FROM public.staffing_settings WHERE restaurant_id = v_rid;
  DELETE FROM public.shift_templates WHERE restaurant_id = v_rid;
  DELETE FROM public.employees       WHERE restaurant_id = v_rid;
  DELETE FROM public.restaurants     WHERE id = v_rid;

  INSERT INTO auth.users(id, email)
    VALUES (v_uid, 'fillin-test@example.com') ON CONFLICT DO NOTHING;

  -- Dedicated auth.users row for the FillIn employee — get_open_shifts'
  -- membership guard requires a real authenticated caller linked to this
  -- restaurant, not postgres (auth.uid() NULL), and leaving this
  -- unauthenticated would make the NOT EXISTS assertion below pass
  -- vacuously regardless of coverage.
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
    VALUES (v_auth, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cap1-test-fillin@example.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
    ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.restaurants(id, name, timezone)
    VALUES (v_rid, 'FillIn Test', 'America/Chicago')
    ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

  INSERT INTO public.employees(id, restaurant_id, user_id, name, position, status, is_active)
    VALUES (v_emp, v_rid, v_auth, 'FillIn Emp', 'Server', 'active', true)
    ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id;

  -- Template: Tuesdays 10:00-16:30 cap 1
  INSERT INTO public.shift_templates(id, restaurant_id, name, start_time, end_time, position, days, capacity, is_active)
    VALUES (v_tmpl, v_rid, 'Mid Opener', '10:00:00', '16:30:00', 'Server', '{2}', 1, true)
    ON CONFLICT (id) DO UPDATE SET is_active = true;

  INSERT INTO public.staffing_settings(restaurant_id, open_shifts_enabled, require_shift_claim_approval)
    VALUES (v_rid, true, false)
    ON CONFLICT (restaurant_id) DO UPDATE SET open_shifts_enabled = true;

  INSERT INTO public.schedule_publications(restaurant_id, week_start_date, week_end_date, published_by, shift_count)
    VALUES (v_rid, v_d - EXTRACT(DOW FROM v_d)::int, v_d - EXTRACT(DOW FROM v_d)::int + 6, v_uid, 0)
    ON CONFLICT DO NOTHING;

  -- Fill-in: 09:00-17:00 local — overlaps the FULL 10:00-16:30 window but
  -- does NOT exactly match it. Old exact-match would miss this; coverage counts it.
  INSERT INTO public.shifts(restaurant_id, employee_id, start_time, end_time, position, status)
    VALUES (
      v_rid, v_emp,
      (v_d::text || ' 09:00')::timestamp AT TIME ZONE 'America/Chicago',
      (v_d::text || ' 17:00')::timestamp AT TIME ZONE 'America/Chicago',
      'Server', 'scheduled'
    );
END $$;

RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"eeeeeeee-ca01-0000-0000-000000000010","role":"authenticated"}', true);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM get_open_shifts(
      'aaaaaaaa-ca01-0000-0000-000000000002'::uuid,
      CURRENT_DATE,
      CURRENT_DATE + 14
    )
  ),
  'fill-in overlapping full template window reduces open_spots to 0 (coverage-based)'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
