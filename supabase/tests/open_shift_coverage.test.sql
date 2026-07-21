-- pgTAP test for claim_open_shift's non-exact-match fill-in behavior.
--
-- Originally this file unit-tested shift_slot_min_concurrent (the whole-floor
-- position sweep), asserting that a fill-in shift overlapping but not exactly
-- matching a template's window still counted toward it. Fill-by-assignment
-- (docs/superpowers/specs/2026-07-20-shift-fill-by-assignment-design.md, Task
-- 11) drops shift_slot_min_concurrent -- its per-template replacement,
-- shift_template_assigned_count, requires an EXACT time+position match for
-- its legacy null-FK fallback, so those direct sweep-semantics tests no
-- longer apply and were removed. The one still-relevant assertion --
-- claim_open_shift's behavior against this same fixture -- is retained below
-- (now the fixture's only consumer) and already reflects fill-by-assignment.
--
-- Lesson 2026-04-21: always use CURRENT_DATE+N for fixture dates.
-- Lesson 2026-04-22: use ON CONFLICT DO UPDATE for idempotent inserts.

BEGIN;

SELECT plan(1);

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
BEGIN
  v_dow := EXTRACT(DOW FROM v_d)::int;

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

  -- E2 (the claimer) needs a real auth.users row + employees.user_id so the
  -- new claim_open_shift caller-owns-employee-row guard (this PR) passes when
  -- impersonated below; without it auth.uid() is NULL and the claim would be
  -- rejected vacuously before reaching the fill-by-assignment logic under test.
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
    VALUES ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cov-e2@example.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
    ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.employees(id, restaurant_id, user_id, name, position, is_active, status)
    VALUES
      (v_emp1, v_rid, NULL, 'E1', 'Server', true, 'active'),
      (v_emp2, v_rid, '00000000-0000-0000-0000-0000000000f2', 'E2', 'Server', true, 'active')
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

-- Re-enable RLS and impersonate E2 (the claimer) so claim_open_shift's
-- caller-owns-employee-row guard (this PR) passes and the call reaches the
-- fill-by-assignment coverage logic under test, instead of being rejected
-- vacuously as an unauthenticated postgres caller.
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);

-- ── Test 1: claim_open_shift succeeds — fill-in with a non-exact-match ───────
-- window (no FK) does not fill the slot under fill-by-assignment.
--
-- Superseded by docs/superpowers/specs/2026-07-20-shift-fill-by-assignment-
-- design.md (Task 9): claim_open_shift's guard now comes from
-- shift_template_assigned_count, whose legacy (null-FK) fallback requires an
-- EXACT start/end/position match to attribute a shift to a template —
-- overlapping the window is no longer sufficient. The fill-in (E1,
-- 15:00-23:00) overlaps but does not exactly match the cap-1 16:00-22:30
-- template, has no shift_template_id, so it fails both belongs() branches and
-- does not count toward this template. E2's claim must therefore succeed
-- (assigned=0, capacity=1).
--
-- This intentionally reverts the previous coverage-sweep behavior pinned by
-- this same test (see git history): under
-- shift_slot_min_concurrent, ANY overlapping same-position shift restaurant-
-- wide counted, which was the root bug the fill-by-assignment redesign fixes.
SELECT is(
  (
    public.claim_open_shift(
      '00000000-0000-0000-0000-0000000000aa'::uuid,
      '00000000-0000-0000-0000-0000000000c1'::uuid,
      CURRENT_DATE + 2,
      '00000000-0000-0000-0000-0000000000b2'::uuid
    ) ->> 'success'
  ),
  'true',
  'claim succeeds — a non-exact-match, non-FK fill-in does not fill the slot (fill-by-assignment)'
);

SELECT * FROM finish();
ROLLBACK;
