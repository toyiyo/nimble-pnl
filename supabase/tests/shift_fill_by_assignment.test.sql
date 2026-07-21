-- pgTAP tests for shift_template_assigned_count (fill-by-assignment fix).
--
-- Replaces shift_slot_min_concurrent's whole-floor same-position sweep with a
-- per-template distinct-employee count, per docs/superpowers/specs/
-- 2026-07-20-shift-fill-by-assignment-design.md.
--
-- belongs(shift, template, day) := status <> 'cancelled' AND same local date
--   AND ( shift.shift_template_id = template.id                       -- FK match
--      OR ( shift.shift_template_id IS NULL                            -- legacy fallback
--           AND shift.position = template.position
--           AND local start/end match template start/end exactly
--           AND template active on day
--           AND areaCompatible(template.area, employee.area) ) )
--
-- Task 7 covers `shift_template_assigned_count` in isolation (no
-- get_open_shifts/claim_open_shift dependency). Tasks 8-10 rewrite those RPCs
-- on top of this function; Task 12 extends this file with their scenarios.
--
-- Lesson 2026-04-21: always use CURRENT_DATE+N for fixture dates.
-- Lesson 2026-04-22: use ON CONFLICT DO UPDATE for idempotent inserts.

BEGIN;

SELECT plan(7);

-- Disable RLS so the function (SECURITY DEFINER) and inserts work in-transaction.
SET LOCAL role TO postgres;
ALTER TABLE public.restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_templates DISABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_rid    uuid := '00000000-0000-0000-0000-0000000000d0';
  v_rid2   uuid := '00000000-0000-0000-0000-0000000000d9'; -- second tenant, for the mismatch guard
  v_emp1   uuid := '00000000-0000-0000-0000-0000000000d1';
  v_emp2   uuid := '00000000-0000-0000-0000-0000000000d2';
  v_tmplA  uuid := '00000000-0000-0000-0000-0000000000d3'; -- Crew 08:00-16:00, capacity 1
  v_tmplB  uuid := '00000000-0000-0000-0000-0000000000d4'; -- same position/time as A, different id
  v_d      date := CURRENT_DATE + 3;
  v_dow    int;
BEGIN
  v_dow := EXTRACT(DOW FROM v_d)::int;

  -- Clean up in FK order before inserting.
  DELETE FROM public.open_shift_claims  WHERE restaurant_id IN (v_rid, v_rid2);
  DELETE FROM public.shifts             WHERE restaurant_id IN (v_rid, v_rid2);
  DELETE FROM public.shift_templates    WHERE restaurant_id IN (v_rid, v_rid2);
  DELETE FROM public.staffing_settings  WHERE restaurant_id IN (v_rid, v_rid2);
  DELETE FROM public.employees          WHERE restaurant_id IN (v_rid, v_rid2);
  DELETE FROM public.restaurants        WHERE id IN (v_rid, v_rid2);

  INSERT INTO public.restaurants(id, name, timezone)
    VALUES
      (v_rid, 'fill-test', 'America/Chicago'),
      (v_rid2, 'fill-test-other', 'America/Chicago')
    ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

  INSERT INTO public.employees(id, restaurant_id, name, position, is_active, status)
    VALUES
      (v_emp1, v_rid, 'E1', 'Crew', true, 'active'),
      (v_emp2, v_rid, 'E2', 'Crew', true, 'active')
    ON CONFLICT (id) DO UPDATE SET position = EXCLUDED.position;

  -- Two active templates, same restaurant/position/time, different id -- the
  -- exact scenario that broke the old whole-floor sweep. They differ by
  -- `area` (NULL vs 'Patio') because uq_shift_templates_active_slot forbids
  -- two fully-identical active templates in one restaurant.
  INSERT INTO public.shift_templates(
      id, restaurant_id, name, start_time, end_time, position, area, capacity,
      days, is_active, break_duration
  ) VALUES
      (v_tmplA, v_rid, 'Crew AM (A)', '08:00'::time, '16:00'::time, 'Crew', NULL, 1, ARRAY[v_dow], true, 0),
      (v_tmplB, v_rid, 'Crew AM (B)', '08:00'::time, '16:00'::time, 'Crew', 'Patio', 1, ARRAY[v_dow], true, 0)
  ON CONFLICT (id) DO UPDATE
      SET days = EXCLUDED.days, capacity = EXCLUDED.capacity, is_active = EXCLUDED.is_active;

  -- Shift 1: FK-assigned to template A.
  INSERT INTO public.shifts(id, restaurant_id, employee_id, shift_template_id, start_time, end_time, position, status)
    VALUES (
      '00000000-0000-0000-0000-0000000000e1', v_rid, v_emp1, v_tmplA,
      (v_d::text || ' 08:00')::timestamp AT TIME ZONE 'America/Chicago',
      (v_d::text || ' 16:00')::timestamp AT TIME ZONE 'America/Chicago',
      'Crew', 'scheduled'
    )
  ON CONFLICT (id) DO UPDATE SET shift_template_id = EXCLUDED.shift_template_id, status = EXCLUDED.status;
END $$;

-- ── Test 1: FK-assigned shift counts for its own template ────────────────────
SELECT is(
  public.shift_template_assigned_count(
    '00000000-0000-0000-0000-0000000000d0'::uuid,
    '00000000-0000-0000-0000-0000000000d3'::uuid,
    CURRENT_DATE + 3,
    'America/Chicago'
  ),
  1,
  'FK-assigned shift counts toward its own template'
);

-- ── Test 2: regression -- same-position shift FK-assigned to a DIFFERENT ─────
-- template must NOT count for template B (the exact bug this migration fixes:
-- the old shift_slot_min_concurrent counted by position across the whole
-- restaurant, ignoring shift_template_id).
SELECT is(
  public.shift_template_assigned_count(
    '00000000-0000-0000-0000-0000000000d0'::uuid,
    '00000000-0000-0000-0000-0000000000d4'::uuid,
    CURRENT_DATE + 3,
    'America/Chicago'
  ),
  0,
  'a same-position shift FK-assigned to a different template does not count here'
);

-- ── Test 3: distinct-employee dedupe -- a second shift for the SAME employee ──
-- on the SAME template (e.g. split shift) still counts as 1 distinct assignee.
DO $$
BEGIN
  INSERT INTO public.shifts(id, restaurant_id, employee_id, shift_template_id, start_time, end_time, position, status)
    VALUES (
      '00000000-0000-0000-0000-0000000000e2',
      '00000000-0000-0000-0000-0000000000d0'::uuid,
      '00000000-0000-0000-0000-0000000000d1'::uuid,
      '00000000-0000-0000-0000-0000000000d3'::uuid,
      ((CURRENT_DATE + 3)::text || ' 12:00')::timestamp AT TIME ZONE 'America/Chicago',
      ((CURRENT_DATE + 3)::text || ' 14:00')::timestamp AT TIME ZONE 'America/Chicago',
      'Crew', 'scheduled'
    )
  ON CONFLICT (id) DO UPDATE SET shift_template_id = EXCLUDED.shift_template_id, status = EXCLUDED.status;
END $$;

SELECT is(
  public.shift_template_assigned_count(
    '00000000-0000-0000-0000-0000000000d0'::uuid,
    '00000000-0000-0000-0000-0000000000d3'::uuid,
    CURRENT_DATE + 3,
    'America/Chicago'
  ),
  1,
  'the same employee assigned twice to one template still counts as 1 distinct assignee'
);

-- ── Test 4: cancelled shift is excluded ───────────────────────────────────────
DO $$
BEGIN
  UPDATE public.shifts SET status = 'cancelled'
    WHERE id = '00000000-0000-0000-0000-0000000000e1';
END $$;

SELECT is(
  public.shift_template_assigned_count(
    '00000000-0000-0000-0000-0000000000d0'::uuid,
    '00000000-0000-0000-0000-0000000000d3'::uuid,
    CURRENT_DATE + 3,
    'America/Chicago'
  ),
  1,
  'cancelled shift is excluded from the count (only the non-cancelled split-shift remains)'
);

-- ── Test 5: legacy null-FK exact-time+position match counts ──────────────────
DO $$
BEGIN
  DELETE FROM public.shifts WHERE restaurant_id = '00000000-0000-0000-0000-0000000000d0'::uuid;

  INSERT INTO public.shifts(id, restaurant_id, employee_id, shift_template_id, start_time, end_time, position, status)
    VALUES (
      '00000000-0000-0000-0000-0000000000e3',
      '00000000-0000-0000-0000-0000000000d0'::uuid,
      '00000000-0000-0000-0000-0000000000d2'::uuid,
      NULL,
      ((CURRENT_DATE + 3)::text || ' 08:00')::timestamp AT TIME ZONE 'America/Chicago',
      ((CURRENT_DATE + 3)::text || ' 16:00')::timestamp AT TIME ZONE 'America/Chicago',
      'Crew', 'scheduled'
    );
END $$;

SELECT is(
  public.shift_template_assigned_count(
    '00000000-0000-0000-0000-0000000000d0'::uuid,
    '00000000-0000-0000-0000-0000000000d3'::uuid,
    CURRENT_DATE + 3,
    'America/Chicago'
  ),
  1,
  'legacy null-FK shift with exact time/position match counts via the fallback'
);

-- ── Test 6: legacy null-FK exact-time+position match attributes to exactly ───
-- ONE of the two area-variant templates (no double-count) -- the design's
-- flagged edge case: template A is area-agnostic (NULL), template B is
-- area-specific ('Patio'); the assignee (E2) has no area, so both are
-- area-compatible candidates. The LATERAL preferred-pick tie-break resolves
-- the shift to exactly one template (prefers the NULL-area match when the
-- employee has no area); either way the SUM across both must be 1, not 2.
SELECT is(
  (
    public.shift_template_assigned_count(
      '00000000-0000-0000-0000-0000000000d0'::uuid,
      '00000000-0000-0000-0000-0000000000d3'::uuid,
      CURRENT_DATE + 3,
      'America/Chicago'
    )
    +
    public.shift_template_assigned_count(
      '00000000-0000-0000-0000-0000000000d0'::uuid,
      '00000000-0000-0000-0000-0000000000d4'::uuid,
      CURRENT_DATE + 3,
      'America/Chicago'
    )
  ),
  1,
  'a legacy null-FK shift matching two identical-time/position templates attributes to exactly one (no double-count)'
);

-- ── Test 7: cross-tenant guard -- mismatched (restaurant_id, template_id) ─────
-- returns 0 rather than leaking another tenant's assignment count (design
-- Minor S2, defense in depth).
SELECT is(
  public.shift_template_assigned_count(
    '00000000-0000-0000-0000-0000000000d9'::uuid, -- v_rid2, does not own v_tmplA
    '00000000-0000-0000-0000-0000000000d3'::uuid,
    CURRENT_DATE + 3,
    'America/Chicago'
  ),
  0,
  'mismatched (restaurant_id, template_id) pair returns 0 (cross-tenant guard)'
);

SELECT * FROM finish();
ROLLBACK;
