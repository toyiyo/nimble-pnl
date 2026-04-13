-- Fix timezone handling in open shift claim functions.
-- Previously, template times (local) were cast directly to timestamptz,
-- causing PostgreSQL to interpret them as UTC. A 3:30 PM CDT shift was
-- stored as 3:30 PM UTC (= 10:30 AM CDT). Similarly, get_open_shifts
-- compared UTC-extracted times against local template times, under-counting
-- assigned shifts and inflating open_spots.

-- ============================================================================
-- 1. get_open_shifts — fix assigned CTE time/date comparisons
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
SECURITY DEFINER
AS $$
DECLARE
    v_tz TEXT;
BEGIN
    -- Look up the restaurant timezone
    SELECT COALESCE(r.timezone, 'America/Chicago') INTO v_tz
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
        -- Get all dates within published schedule weeks, excluding past dates
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
            st.id AS tmpl_id,
            st.name AS tmpl_name,
            pd.pub_date,
            st.start_time AS tmpl_start,
            st.end_time AS tmpl_end,
            st.position AS tmpl_position,
            st.area AS tmpl_area,
            st.capacity AS tmpl_capacity
        FROM public.shift_templates st
        CROSS JOIN published_dates pd
        WHERE st.restaurant_id = p_restaurant_id
          AND st.is_active = true
          AND st.capacity > 1
          AND EXTRACT(DOW FROM pd.pub_date)::int = ANY(st.days)
    ),
    assigned AS (
        -- Count existing shifts matching template's position + time + date
        -- Use AT TIME ZONE to convert UTC timestamps to local before extracting
        SELECT
            td.tmpl_id,
            td.pub_date,
            COUNT(s.id) AS cnt
        FROM template_days td
        LEFT JOIN public.shifts s
            ON s.restaurant_id = p_restaurant_id
            AND s.position = td.tmpl_position
            AND (s.start_time AT TIME ZONE v_tz)::time = td.tmpl_start
            AND (s.end_time AT TIME ZONE v_tz)::time = td.tmpl_end
            AND (s.start_time AT TIME ZONE v_tz)::date = td.pub_date
            AND s.status != 'cancelled'
        GROUP BY td.tmpl_id, td.pub_date
    ),
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
        COALESCE(a.cnt, 0),
        COALESCE(p.cnt, 0),
        (td.tmpl_capacity - COALESCE(a.cnt, 0) - COALESCE(p.cnt, 0))
    FROM template_days td
    LEFT JOIN assigned a ON a.tmpl_id = td.tmpl_id AND a.pub_date = td.pub_date
    LEFT JOIN pending p ON p.shift_template_id = td.tmpl_id AND p.shift_date = td.pub_date
    WHERE (td.tmpl_capacity - COALESCE(a.cnt, 0) - COALESCE(p.cnt, 0)) > 0
    ORDER BY td.pub_date, td.tmpl_start;
END;
$$;

-- ============================================================================
-- 2. claim_open_shift — fix capacity check comparisons and shift timestamp construction
-- ============================================================================
CREATE OR REPLACE FUNCTION public.claim_open_shift(
    p_restaurant_id UUID,
    p_template_id UUID,
    p_shift_date DATE,
    p_employee_id UUID
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tz TEXT;
    v_template RECORD;
    v_assigned_count BIGINT;
    v_pending_count BIGINT;
    v_requires_approval BOOLEAN;
    v_claim_id UUID;
    v_shift_id UUID;
    v_shift_start TIMESTAMPTZ;
    v_shift_end TIMESTAMPTZ;
BEGIN
    -- Look up the restaurant timezone
    SELECT COALESCE(r.timezone, 'America/Chicago') INTO v_tz
    FROM public.restaurants r WHERE r.id = p_restaurant_id;

    -- Lock and fetch the template
    SELECT * INTO v_template
    FROM public.shift_templates
    WHERE id = p_template_id
      AND restaurant_id = p_restaurant_id
    FOR SHARE;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Template not found');
    END IF;

    -- Verify day-of-week matches
    IF NOT (EXTRACT(DOW FROM p_shift_date)::int = ANY(v_template.days)) THEN
        RETURN json_build_object('success', false, 'error', 'Template does not apply to this day');
    END IF;

    -- Count assigned shifts for this template+date
    -- Use AT TIME ZONE to convert UTC timestamps to local before comparing
    SELECT COUNT(*) INTO v_assigned_count
    FROM public.shifts
    WHERE restaurant_id = p_restaurant_id
      AND position = v_template.position
      AND (start_time AT TIME ZONE v_tz)::time = v_template.start_time
      AND (end_time AT TIME ZONE v_tz)::time = v_template.end_time
      AND (start_time AT TIME ZONE v_tz)::date = p_shift_date
      AND status != 'cancelled';

    -- Count pending claims
    SELECT COUNT(*) INTO v_pending_count
    FROM public.open_shift_claims
    WHERE shift_template_id = p_template_id
      AND shift_date = p_shift_date
      AND status = 'pending_approval';

    -- Check capacity
    IF (v_assigned_count + v_pending_count) >= v_template.capacity THEN
        RETURN json_build_object('success', false, 'error', 'No open spots available');
    END IF;

    -- Build shift timestamps from template times + shift date
    -- Cast to timestamp (no tz) first, then interpret in restaurant timezone
    v_shift_start := (p_shift_date || ' ' || v_template.start_time)::timestamp AT TIME ZONE v_tz;
    v_shift_end := (p_shift_date || ' ' || v_template.end_time)::timestamp AT TIME ZONE v_tz;

    -- Handle overnight shifts
    IF v_template.end_time <= v_template.start_time THEN
        v_shift_end := v_shift_end + interval '1 day';
    END IF;

    -- Check for schedule conflict with existing employee shifts
    IF EXISTS (
        SELECT 1 FROM public.shifts
        WHERE employee_id = p_employee_id
          AND restaurant_id = p_restaurant_id
          AND status != 'cancelled'
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

-- ============================================================================
-- 3. approve_open_shift_claim — fix shift timestamp construction
-- ============================================================================
CREATE OR REPLACE FUNCTION public.approve_open_shift_claim(
    p_claim_id UUID,
    p_reviewer_note TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tz TEXT;
    v_claim RECORD;
    v_template RECORD;
    v_shift_id UUID;
    v_shift_start TIMESTAMPTZ;
    v_shift_end TIMESTAMPTZ;
BEGIN
    -- Lock the claim
    SELECT * INTO v_claim
    FROM public.open_shift_claims
    WHERE id = p_claim_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Claim not found');
    END IF;

    IF v_claim.status != 'pending_approval' THEN
        RETURN json_build_object('success', false, 'error', 'Claim is not pending approval');
    END IF;

    -- Look up the restaurant timezone (after fetching the claim to get restaurant_id)
    SELECT COALESCE(r.timezone, 'America/Chicago') INTO v_tz
    FROM public.restaurants r WHERE r.id = v_claim.restaurant_id;

    -- Get the template
    SELECT * INTO v_template
    FROM public.shift_templates
    WHERE id = v_claim.shift_template_id;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Template not found');
    END IF;

    -- Build shift timestamps — cast to timestamp (no tz) first, then interpret in restaurant timezone
    v_shift_start := (v_claim.shift_date || ' ' || v_template.start_time)::timestamp AT TIME ZONE v_tz;
    v_shift_end := (v_claim.shift_date || ' ' || v_template.end_time)::timestamp AT TIME ZONE v_tz;

    IF v_template.end_time <= v_template.start_time THEN
        v_shift_end := v_shift_end + interval '1 day';
    END IF;

    -- Create the shift
    INSERT INTO public.shifts (
        restaurant_id, employee_id, start_time, end_time,
        break_duration, position, status, source, is_published
    ) VALUES (
        v_claim.restaurant_id, v_claim.claimed_by_employee_id,
        v_shift_start, v_shift_end,
        v_template.break_duration, v_template.position, 'scheduled', 'template', true
    )
    RETURNING id INTO v_shift_id;

    -- Update the claim
    UPDATE public.open_shift_claims
    SET status = 'approved',
        resulting_shift_id = v_shift_id,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    WHERE id = p_claim_id;

    RETURN json_build_object(
        'success', true,
        'shift_id', v_shift_id,
        'message', 'Claim approved and shift created'
    );
END;
$$;
