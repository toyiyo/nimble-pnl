-- Fill-by-assignment: shift_template_assigned_count.
--
-- Replaces the whole-floor, position-only sweep (shift_slot_min_concurrent)
-- with a per-template distinct-employee count, per docs/superpowers/specs/
-- 2026-07-20-shift-fill-by-assignment-design.md.
--
-- Root cause being fixed: shift_slot_min_concurrent filtered only by
-- restaurant_id + position + date + status -- never shift_template_id -- so
-- one employee on template B's shift satisfied the coverage sweep for every
-- other same-position template A whose window sat inside B's, marking A
-- "filled" with zero employees actually assigned to it.
--
-- New semantics (approved by user): a template slot is filled when >=
-- capacity distinct employees are assigned to THAT TEMPLATE (by id) on that
-- date, per the single "belongs to template" predicate:
--
--   belongs(shift, template, day) :=
--        shift.status <> 'cancelled'
--     AND local_date(shift.start_time, tz) = day                        -- "active on day" (date)
--     AND (
--           shift.shift_template_id = template.id                      -- FK match (preferred; new data)
--        OR ( shift.shift_template_id IS NULL                          -- legacy fallback (old data)
--             AND shift.position = template.position
--             AND local_time(shift.start_time, tz) = template.start_time
--             AND local_time(shift.end_time,   tz) = template.end_time
--             AND template.is_active = true
--             AND EXTRACT(DOW FROM day)::int = ANY(template.days)      -- "active on day" (day-of-week)
--             AND ( template.area IS NULL OR employee.area IS NULL
--                   OR template.area = employee.area )                 -- areaCompatible; null either side = permissive
--           )
--     )
--
--   distinctAssignedCount(template, day) = COUNT(DISTINCT employee_id WHERE belongs)
--
-- This migration adds shift_template_assigned_count(p_restaurant_id,
-- p_template_id, p_date, p_tz) implementing that predicate. Tasks 8-10 (a
-- later commit in this same migration file) rewrite get_open_shifts and
-- claim_open_shift to call it instead of shift_slot_min_concurrent, and Task
-- 11 drops shift_slot_min_concurrent once its callers are gone.
--
-- STABLE is correct: the function is read-only and CURRENT_DATE is stable
-- per statement. Do not add NOW() calls.

CREATE OR REPLACE FUNCTION public.shift_template_assigned_count(
  p_restaurant_id uuid,
  p_template_id   uuid,
  p_date          date,
  p_tz            text
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH tmpl AS (
    -- Defense in depth (design Minor S2): join on id AND restaurant_id so a
    -- mismatched (restaurant_id, template_id) pair -- which should never
    -- happen from trusted callers, but could from a malformed/forged call --
    -- resolves to zero rows and the function returns 0 below, rather than
    -- leaking another tenant's assignment count.
    SELECT st.id, st.position, st.start_time, st.end_time, st.area
    FROM public.shift_templates st
    WHERE st.id = p_template_id
      AND st.restaurant_id = p_restaurant_id
  ),
  -- Branch A: shifts explicitly linked to this template by FK. No is_active/
  -- days/area check here -- if the shift was actually created against this
  -- template, it counts regardless of whether the template was later
  -- disabled or its schedule changed.
  fk_branch AS (
    SELECT s.employee_id
    FROM public.shifts s
    WHERE s.restaurant_id = p_restaurant_id
      AND s.shift_template_id = p_template_id
      AND s.status <> 'cancelled'
      AND (s.start_time AT TIME ZONE p_tz)::date = p_date
  ),
  -- Branch B: legacy shifts with no shift_template_id, matched by exact
  -- time+position, then resolved to a single "preferred" template via the
  -- LATERAL below -- mirroring findAreaAwareTemplate/pickAreaPreferredMatch
  -- (src/lib/templateAreaMatch.ts) -- so a legacy shift attributes to exactly
  -- one template even when two active templates share the same time/position
  -- and differ only by area (one area-specific, one area-agnostic).
  legacy_candidates AS (
    SELECT
      s.employee_id,
      s.position                              AS shift_position,
      (s.start_time AT TIME ZONE p_tz)::time  AS local_start,
      (s.end_time   AT TIME ZONE p_tz)::time  AS local_end,
      e.area                                  AS employee_area
    FROM public.shifts s
    JOIN public.employees e ON e.id = s.employee_id
    WHERE s.restaurant_id = p_restaurant_id
      AND s.shift_template_id IS NULL
      AND s.status <> 'cancelled'
      AND (s.start_time AT TIME ZONE p_tz)::date = p_date
  ),
  legacy_resolved AS (
    SELECT lc.employee_id, best.tmpl_id
    FROM legacy_candidates lc
    CROSS JOIN LATERAL (
      SELECT st.id AS tmpl_id
      FROM public.shift_templates st
      WHERE st.restaurant_id = p_restaurant_id
        AND st.is_active = true
        AND st.position = lc.shift_position
        AND st.start_time = lc.local_start
        AND st.end_time = lc.local_end
        -- "active on day" (day-of-week): EXTRACT(DOW ...) = ANY(days).
        AND EXTRACT(DOW FROM p_date)::int = ANY(st.days)
        -- areaCompatible(template.area, employee.area): null on either side
        -- is permissive.
        AND (st.area IS NULL OR lc.employee_area IS NULL OR st.area = lc.employee_area)
      -- Prefer an exact same-area match over an area-agnostic one; when the
      -- employee has no area, this instead deterministically prefers a
      -- NULL-area template (a documented minor divergence from the client's
      -- arbitrary input-order pick in that rare sub-case -- both are
      -- single-attribution, so chips/badge can't diverge).
      ORDER BY (st.area IS NOT DISTINCT FROM lc.employee_area) DESC, st.start_time, st.id
      LIMIT 1
    ) best
  ),
  legacy_branch AS (
    SELECT employee_id FROM legacy_resolved WHERE tmpl_id = p_template_id
  )
  SELECT CASE WHEN EXISTS (SELECT 1 FROM tmpl) THEN
    (
      SELECT COUNT(*)::int FROM (
        SELECT employee_id FROM fk_branch
        UNION
        SELECT employee_id FROM legacy_branch
      ) distinct_employees
    )
  ELSE 0 END;
$$;

-- shift_template_assigned_count is an internal helper (same posture as
-- shift_slot_min_concurrent): granting it directly to authenticated would let
-- any logged-in user enumerate staffing data for any restaurant/template UUID
-- pair they can guess. Callers (get_open_shifts, claim_open_shift) are
-- SECURITY DEFINER and carry their own privilege.
REVOKE EXECUTE ON FUNCTION public.shift_template_assigned_count(uuid, uuid, date, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.shift_template_assigned_count(uuid, uuid, date, text) FROM authenticated;

-- ============================================================================
-- Task 8: rewrite get_open_shifts to use shift_template_assigned_count.
--
-- Replaces the CROSS JOIN LATERAL call to shift_slot_min_concurrent (the
-- whole-floor, position-only sweep) with shift_template_assigned_count (the
-- per-template distinct-employee count). Fixes the exact regression pinned by
-- shift_fill_by_assignment.test.sql Test 8: two active templates sharing the
-- same position/time (e.g. an area-specific and an area-agnostic variant) no
-- longer bleed into each other's open_spots -- an employee FK-assigned to
-- template A no longer marks template B "filled" when zero employees are
-- actually assigned to B.
--
-- Everything else is unchanged from 20260626120000_open_shift_coverage.sql:
--   * STABLE SECURITY DEFINER SET search_path = public
--   * open_shifts_enabled gate (early-return if disabled)
--   * published_dates future filter (CURRENT_DATE and forward)
--   * capacity > 0 template guard
--   * per-(template, date) result rows with the same column names/order
--   * pending_claims subtraction (conservative: safe direction)
--   * ORDER BY pub_date, tmpl_start
--   * GRANT EXECUTE
--
-- open_spots = GREATEST(1, capacity) - assigned_count - pending_claims
-- shift_template_assigned_count returns INT; pending_claims is BIGINT from
-- COUNT(); the result is cast to BIGINT to match the declared return type.
--
-- STABLE is correct: the function is read-only; CURRENT_DATE is stable per
-- statement. Do not add NOW() calls.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_open_shifts(
    p_restaurant_id UUID,
    p_week_start DATE,
    p_week_end DATE
)
RETURNS TABLE (
    template_id UUID,
    template_name TEXT,
    shift_date DATE,
    start_time TIME,
    end_time TIME,
    "position" TEXT,
    area TEXT,
    "capacity" INT,
    assigned_count BIGINT,
    pending_claims BIGINT,
    open_spots BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tz TEXT;
BEGIN
    -- Look up the restaurant timezone.
    -- Fallback is 'UTC' to match the TypeScript computeOpenShiftCount path.
    SELECT COALESCE(r.timezone, 'UTC') INTO v_tz
    FROM public.restaurants r WHERE r.id = p_restaurant_id;

    -- Check if open shifts are enabled for this restaurant
    IF NOT EXISTS (
        SELECT 1 FROM public.staffing_settings
        WHERE restaurant_id = p_restaurant_id
          AND open_shifts_enabled = true
    ) THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH published_dates AS (
        -- All dates in published schedule weeks, today and forward only
        SELECT DISTINCT d::date AS pub_date
        FROM public.schedule_publications sp,
             generate_series(
                 GREATEST(sp.week_start_date, p_week_start),
                 LEAST(sp.week_end_date, p_week_end),
                 '1 day'::interval
             ) AS d
        WHERE sp.restaurant_id = p_restaurant_id
          AND sp.week_start_date <= p_week_end
          AND sp.week_end_date >= p_week_start
          AND d::date >= CURRENT_DATE  -- Only today and future dates
    ),
    template_days AS (
        SELECT
            st.id          AS tmpl_id,
            st.name        AS tmpl_name,
            pd.pub_date,
            st.start_time  AS tmpl_start,
            st.end_time    AS tmpl_end,
            st.position    AS tmpl_position,
            st.area        AS tmpl_area,
            st.capacity    AS tmpl_capacity
        FROM public.shift_templates st
        CROSS JOIN published_dates pd
        WHERE st.restaurant_id = p_restaurant_id
          AND st.is_active = true
          AND st.capacity > 0          -- include single-person crews
          AND EXTRACT(DOW FROM pd.pub_date)::int = ANY(st.days)
    ),
    -- pending_claims: open_shift_claims awaiting manager approval
    pending AS (
        SELECT
            osc.shift_template_id,
            osc.shift_date,
            COUNT(osc.id) AS cnt
        FROM public.open_shift_claims osc
        WHERE osc.restaurant_id = p_restaurant_id
          AND osc.status = 'pending_approval'
        GROUP BY osc.shift_template_id, osc.shift_date
    )
    SELECT
        td.tmpl_id,
        td.tmpl_name,
        td.pub_date,
        td.tmpl_start,
        td.tmpl_end,
        td.tmpl_position,
        td.tmpl_area,
        td.tmpl_capacity,
        ac.assigned::bigint                                  AS assigned_count,
        COALESCE(p.cnt, 0)                                   AS pending_claims,
        (GREATEST(1, td.tmpl_capacity) - ac.assigned - COALESCE(p.cnt, 0))::bigint AS open_spots
    FROM template_days td
    CROSS JOIN LATERAL (
        SELECT public.shift_template_assigned_count(
            p_restaurant_id,
            td.tmpl_id,
            td.pub_date,
            v_tz
        ) AS assigned
    ) ac
    LEFT JOIN pending p ON p.shift_template_id = td.tmpl_id AND p.shift_date = td.pub_date
    WHERE (GREATEST(1, td.tmpl_capacity) - ac.assigned - COALESCE(p.cnt, 0)) > 0
    ORDER BY td.pub_date, td.tmpl_start;
END;
$$;

-- Re-issue EXECUTE so the privilege is self-contained in this migration file.
GRANT EXECUTE ON FUNCTION public.get_open_shifts(UUID, DATE, DATE) TO authenticated;
