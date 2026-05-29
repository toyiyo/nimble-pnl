-- Include capacity-1 templates in the open-shift pool.
--
-- get_open_shifts filtered templates with `st.capacity > 1`, silently
-- excluding single-person crew allocations (e.g. the AI scheduler's
-- "1 Server") from the claimable open-shift pool. Such templates were
-- written to shift_templates and surfaced an "open shifts created" toast,
-- but never appeared as claimable open shifts — the UI promise diverged
-- from the data contract.
--
-- Fix: change the guard to `st.capacity > 0` (the clean equivalent of
-- `>= 1`; shift_templates already enforces CHECK (capacity >= 1)). The
-- final `open_spots > 0` WHERE clause still filters fully-claimed shifts.
--
-- The body is copied verbatim from 20260413001912_fix_shift_claim_timezone.sql
-- (timezone-aware AT TIME ZONE comparisons preserved), with two opportunistic
-- hardening tweaks since the whole body is being rewritten:
--   * SET search_path = public  — pin the search path on this SECURITY DEFINER
--     function so a hostile schema can't shadow public tables.
--   * STABLE                    — the function is read-only.
--
-- claim_open_shift is intentionally NOT changed: its guard
-- (assigned + pending >= capacity) is already correct for capacity = 1
-- (1st claim: 0 >= 1 false → allowed; 2nd: 1 >= 1 true → blocked).

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
          AND st.capacity > 0  -- include single-person crews (was `> 1`, which dropped capacity-1 templates)
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
