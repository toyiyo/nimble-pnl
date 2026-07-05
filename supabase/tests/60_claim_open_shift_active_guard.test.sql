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
-- fixture borrows an existing local auth.users row rather than inserting one.

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

DO $$
DECLARE
  v_rid    uuid := '00000000-0000-0000-0000-0000000000da';
  v_emp1   uuid := '00000000-0000-0000-0000-0000000000d1';
  v_emp2   uuid := '00000000-0000-0000-0000-0000000000d2';
  v_tmpl   uuid := '00000000-0000-0000-0000-0000000000d3';
  v_ghost  uuid := '00000000-0000-0000-0000-0000000000d4'; -- nonexistent template id
  v_d      date := CURRENT_DATE + 3;
  v_dow    int;
  v_user   uuid;
BEGIN
  v_dow := EXTRACT(DOW FROM v_d)::int;

  -- Borrow any existing auth.users row for the publisher FK (this fixture
  -- never authenticates as this user; it's only satisfying a NOT NULL FK).
  SELECT id INTO v_user FROM auth.users LIMIT 1;

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

  INSERT INTO public.employees(id, restaurant_id, name, position, is_active, status)
    VALUES
      (v_emp1, v_rid, 'E1', 'Server', true, 'active'),
      (v_emp2, v_rid, 'E2', 'Server', true, 'active')
    ON CONFLICT (id) DO UPDATE SET position = EXCLUDED.position;

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

-- ── Test 1: active template ⇒ get_open_shifts includes the slot ─────────────
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
UPDATE public.shift_templates
  SET is_active = false
  WHERE id = '00000000-0000-0000-0000-0000000000d3';

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
UPDATE public.shift_templates
  SET is_active = true
  WHERE id = '00000000-0000-0000-0000-0000000000d3';

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
-- cannot masquerade as this test passing for the wrong reason.
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

SELECT * FROM finish();
ROLLBACK;
