-- ============================================================================
-- Authorization guards for the open-shift-claim RPC family.
--
-- Bug: docs/superpowers/specs/2026-07-21-open-shift-claim-authz-design.md
-- Four SECURITY DEFINER RPCs (get_open_shifts, claim_open_shift,
-- approve_open_shift_claim, reject_open_shift_claim) perform no
-- authorization check on the caller — SECURITY DEFINER bypasses RLS, so
-- auth.uid() was previously used only to *record* an actor, never to *gate*
-- the action. This migration re-creates each function from its current-main
-- body (verbatim) and adds the missing guard.
--
-- This file lands the guards incrementally, one function per TDD task, to
-- keep each RED->GREEN step reviewable. This first slice covers
-- get_open_shifts only (design doc section "3. get_open_shifts"); the
-- remaining three functions are added by subsequent migrations/tasks in the
-- same plan (see docs/superpowers/plans/2026-07-21-open-shift-claim-authz-plan.md).
--
-- get_open_shifts guard: membership check — the caller must belong to the
-- restaurant as either an internal team member (owner/manager/
-- operations_manager/chef/staff, via public.user_is_internal_team) or a
-- linked employee (public.employees.user_id = auth.uid()). Employees
-- legitimately need to see open shifts in order to claim them, and they are
-- not guaranteed a user_restaurants row, so user_is_internal_team alone is
-- not sufficient. Silent empty return (RETURN with no rows) on failure —
-- the same shape as the existing open_shifts_enabled=false branch — so
-- there is no enumeration signal distinguishing "not authorized" from
-- "nothing open" or "unknown restaurant".
--
-- Body re-created verbatim from 20260626120000_open_shift_coverage.sql
-- (the current-main definition; 20260705130000_claim_open_shift_active_guard.sql
-- only touched claim_open_shift, not get_open_shifts). SET search_path=public
-- was already present on this function from that migration — kept as-is,
-- not newly added by this change.
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
    -- Authorization guard: caller must belong to the restaurant, either as
    -- internal team (owner/manager/operations_manager/chef/staff) or as a
    -- linked employee. Silent empty return — no enumeration signal.
    IF NOT (
        public.user_is_internal_team(p_restaurant_id)
        OR EXISTS (
            SELECT 1 FROM public.employees e
            WHERE e.user_id = auth.uid()
              AND e.restaurant_id = p_restaurant_id
        )
    ) THEN
        RETURN;
    END IF;

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
        mc.minc::bigint                                      AS assigned_count,
        COALESCE(p.cnt, 0)                                   AS pending_claims,
        (GREATEST(1, td.tmpl_capacity) - mc.minc - COALESCE(p.cnt, 0))::bigint AS open_spots
    FROM template_days td
    CROSS JOIN LATERAL (
        SELECT public.shift_slot_min_concurrent(
            p_restaurant_id,
            td.tmpl_position,
            td.pub_date,
            td.tmpl_start,
            td.tmpl_end,
            v_tz
        ) AS minc
    ) mc
    LEFT JOIN pending p ON p.shift_template_id = td.tmpl_id AND p.shift_date = td.pub_date
    WHERE (GREATEST(1, td.tmpl_capacity) - mc.minc - COALESCE(p.cnt, 0)) > 0
    ORDER BY td.pub_date, td.tmpl_start;
END;
$$;

-- Re-issue EXECUTE so the privilege is self-contained in this migration file.
GRANT EXECUTE ON FUNCTION public.get_open_shifts(UUID, DATE, DATE) TO authenticated;
