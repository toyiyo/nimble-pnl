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
-- keep each RED->GREEN step reviewable. This slice covers get_open_shifts
-- (design doc section "3. get_open_shifts") and claim_open_shift (design doc
-- section "2. claim_open_shift"); the remaining two functions
-- (approve_open_shift_claim, reject_open_shift_claim) are added by subsequent
-- migrations/tasks in the same plan (see
-- docs/superpowers/plans/2026-07-21-open-shift-claim-authz-plan.md).
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

-- ============================================================================
-- claim_open_shift guard: caller-owns-employee-row check (design doc
-- section "2. claim_open_shift"). The caller may only claim for an employee
-- row they own, in the target restaurant — mirrors the
-- employees_insert_own_claims INSERT RLS policy on open_shift_claims
-- (claimed_by_employee_id IN (SELECT id FROM employees WHERE user_id =
-- auth.uid())) and adds the restaurant scope the RPC signature separates
-- out. Constant 'Not authorized' message regardless of which half of the
-- check failed (unknown employee id vs. employee in a different
-- restaurant vs. employee owned by a different user) — no enumeration of
-- employees/restaurants.
--
-- Body re-created verbatim from 20260705130000_claim_open_shift_active_guard.sql
-- (the current-main definition, which already carries the is_active guard,
-- the coverage-based capacity check, and SET search_path=public). The new
-- authz guard is the first statement in the function body, before the
-- advisory lock is acquired, so an unauthorized caller never contends for
-- the per-slot lock.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_open_shift(
    p_restaurant_id UUID,
    p_template_id   UUID,
    p_shift_date    DATE,
    p_employee_id   UUID
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tz                TEXT;
    v_template          RECORD;
    v_assigned_count    INT;
    v_pending_count     BIGINT;
    v_requires_approval BOOLEAN;
    v_claim_id          UUID;
    v_shift_id          UUID;
    v_shift_start       TIMESTAMPTZ;
    v_shift_end         TIMESTAMPTZ;
BEGIN
    -- Authorization guard: the caller must own the employee row they are
    -- claiming for, and that employee row must belong to the target
    -- restaurant. Mirrors employees_insert_own_claims INSERT RLS.
    IF NOT EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = p_employee_id
          AND e.user_id = auth.uid()
          AND e.restaurant_id = p_restaurant_id
    ) THEN
        RETURN json_build_object('success', false, 'error', 'Not authorized');
    END IF;

    -- Look up the restaurant timezone.
    -- Fallback is 'UTC' to match the TypeScript computeOpenShiftCount path.
    SELECT COALESCE(r.timezone, 'UTC') INTO v_tz
    FROM public.restaurants r WHERE r.id = p_restaurant_id;

    -- Acquire a per-slot advisory transaction lock before computing counts.
    -- This serializes concurrent claims for the same (template, date) pair so
    -- two transactions cannot both read the same v_assigned_count + v_pending_count
    -- and both pass the capacity guard.  The lock is released automatically at
    -- transaction end (no explicit unlock needed).
    --
    -- Key: hashtext(template_id || shift_date) fits in int4 advisory lock space.
    PERFORM pg_advisory_xact_lock(hashtext(p_template_id::text || p_shift_date::text));

    -- Fetch the template (after holding the slot lock).
    SELECT * INTO v_template
    FROM public.shift_templates
    WHERE id = p_template_id
      AND restaurant_id = p_restaurant_id;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Template not found');
    END IF;

    -- Guard: a hidden (soft-archived) template must not be claimable, even
    -- though it was found by id+restaurant. Mirrors the is_active = true
    -- filter get_open_shifts already applies when offering slots, so the
    -- offer and the claim guard stay in agreement. The message is constant
    -- regardless of any other template/claim state (no enumeration signal).
    IF NOT v_template.is_active THEN
        RETURN json_build_object('success', false, 'error', 'This shift is no longer available');
    END IF;

    -- Verify day-of-week matches
    IF NOT (EXTRACT(DOW FROM p_shift_date)::int = ANY(v_template.days)) THEN
        RETURN json_build_object('success', false, 'error', 'Template does not apply to this day');
    END IF;

    -- Coverage-based assigned count (replaces exact time-window match).
    -- Uses the same sweep-line function as get_open_shifts so the offer and
    -- claim guard always agree — prevents double-claiming a covered slot.
    v_assigned_count := public.shift_slot_min_concurrent(
        p_restaurant_id,
        v_template.position,
        p_shift_date,
        v_template.start_time,
        v_template.end_time,
        v_tz
    );

    -- Count pending claims for this template+date
    SELECT COUNT(*) INTO v_pending_count
    FROM public.open_shift_claims
    WHERE shift_template_id = p_template_id
      AND shift_date = p_shift_date
      AND status = 'pending_approval';

    -- Capacity guard: reject if coverage + pending already fills the slot.
    -- GREATEST(1, capacity) mirrors the capacityFloor used in get_open_shifts.
    IF (v_assigned_count + v_pending_count) >= GREATEST(1, v_template.capacity) THEN
        RETURN json_build_object('success', false, 'error', 'No open spots available');
    END IF;

    -- Build shift timestamps from template times + shift date.
    -- Cast to timestamp (no tz) first, then interpret in restaurant timezone.
    v_shift_start := (p_shift_date || ' ' || v_template.start_time)::timestamp AT TIME ZONE v_tz;
    v_shift_end   := (p_shift_date || ' ' || v_template.end_time)::timestamp   AT TIME ZONE v_tz;

    -- Handle overnight shifts
    IF v_template.end_time <= v_template.start_time THEN
        v_shift_end := v_shift_end + interval '1 day';
    END IF;

    -- Check for schedule conflict with existing employee shifts
    IF EXISTS (
        SELECT 1 FROM public.shifts
        WHERE employee_id    = p_employee_id
          AND restaurant_id  = p_restaurant_id
          AND status        != 'cancelled'
          AND (start_time, end_time) OVERLAPS (v_shift_start, v_shift_end)
    ) THEN
        RETURN json_build_object('success', false, 'error', 'Schedule conflict with existing shift');
    END IF;

    -- Check approval setting
    SELECT COALESCE(require_shift_claim_approval, false) INTO v_requires_approval
    FROM public.staffing_settings
    WHERE restaurant_id = p_restaurant_id;

    IF v_requires_approval IS NULL THEN
        v_requires_approval := false;
    END IF;

    IF NOT v_requires_approval THEN
        -- Instant approval: create the shift and the claim
        INSERT INTO public.shifts (
            restaurant_id, employee_id, start_time, end_time,
            break_duration, position, status, source, is_published
        ) VALUES (
            p_restaurant_id, p_employee_id, v_shift_start, v_shift_end,
            v_template.break_duration, v_template.position, 'scheduled', 'template', true
        )
        RETURNING id INTO v_shift_id;

        INSERT INTO public.open_shift_claims (
            restaurant_id, shift_template_id, shift_date,
            claimed_by_employee_id, status, resulting_shift_id
        ) VALUES (
            p_restaurant_id, p_template_id, p_shift_date,
            p_employee_id, 'approved', v_shift_id
        )
        RETURNING id INTO v_claim_id;

        RETURN json_build_object(
            'success', true,
            'claim_id', v_claim_id,
            'shift_id', v_shift_id,
            'status', 'approved',
            'message', 'Shift claimed and added to your schedule'
        );
    ELSE
        -- Requires approval: just create the claim
        INSERT INTO public.open_shift_claims (
            restaurant_id, shift_template_id, shift_date,
            claimed_by_employee_id, status
        ) VALUES (
            p_restaurant_id, p_template_id, p_shift_date,
            p_employee_id, 'pending_approval'
        )
        RETURNING id INTO v_claim_id;

        RETURN json_build_object(
            'success', true,
            'claim_id', v_claim_id,
            'status', 'pending_approval',
            'message', 'Claim submitted for manager approval'
        );
    END IF;
END;
$$;

-- Re-issue EXECUTE so the privilege is self-contained in this migration file.
GRANT EXECUTE ON FUNCTION public.claim_open_shift(UUID, UUID, DATE, UUID) TO authenticated;
