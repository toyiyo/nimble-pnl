-- Fix get_open_shifts to exclude past dates.
-- Previously returned open shifts for the entire published week including days
-- that have already passed, causing clutter in the employee feed.

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
BEGIN
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
        SELECT
            td.tmpl_id,
            td.pub_date,
            COUNT(s.id) AS cnt
        FROM template_days td
        LEFT JOIN public.shifts s
            ON s.restaurant_id = p_restaurant_id
            AND s.position = td.tmpl_position
            AND (s.start_time::time) = td.tmpl_start
            AND (s.end_time::time) = td.tmpl_end
            AND (s.start_time::date) = td.pub_date
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
