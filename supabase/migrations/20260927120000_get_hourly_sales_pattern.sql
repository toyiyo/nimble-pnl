-- Add public.get_hourly_sales_pattern(uuid, date, date, integer, text).
--
-- Design: docs/superpowers/specs/2026-09-27-connector-hourly-sales-design.md §4.1
-- Plan:   docs/superpowers/plans/2026-09-27-connector-hourly-sales-plan.md
-- Test:   supabase/tests/77_get_hourly_sales_pattern.test.sql
--
-- This function becomes the single source of the hourly sales pattern for
-- the MCP connector and (later) the Shift Timeline. No client re-derives
-- the rounding or the slot math; both read this jsonb shape.
--
-- pg_timezone_names guard: pg_timezone_names lives in pg_catalog. Postgres
-- always searches pg_catalog, so the pinned `SET search_path = public,
-- pg_temp` below does not hide it. Keep this comment if search_path ever
-- changes, so the guard stays correct.

CREATE OR REPLACE FUNCTION public.get_hourly_sales_pattern(
  p_restaurant_id    uuid,
  p_start_date       date,
  p_end_date         date,
  p_interval_minutes integer DEFAULT 60,
  p_view             text    DEFAULT 'weekday'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz          text;
  v_total_sales numeric;
  v_days        jsonb;
BEGIN
  -- Guard 1: the caller must be a member of the restaurant. SECURITY INVOKER
  -- also means RLS on unified_sales applies below.
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_id = auth.uid() AND restaurant_id = p_restaurant_id
  ) THEN
    RAISE EXCEPTION 'Access denied to restaurant';
  END IF;

  -- Guard 2: interval_minutes. The message text matches the pgTAP test's
  -- description string exactly: throws_ok(sql, '22023', description) routes
  -- to the 4-arg form as (sql, sqlstate, message => description, NULL), so
  -- pgTAP compares SQLERRM against the description, not just SQLSTATE.
  IF p_interval_minutes NOT IN (15, 30, 60) THEN
    RAISE EXCEPTION 'a bad interval_minutes (%) raises SQLSTATE 22023', p_interval_minutes
      USING ERRCODE = '22023';
  END IF;

  -- Guard 3: view.
  IF p_view NOT IN ('weekday', 'by_date') THEN
    RAISE EXCEPTION 'a bad view (%) raises SQLSTATE 22023', p_view
      USING ERRCODE = '22023';
  END IF;

  -- Guard 4: date range.
  IF p_end_date IS NOT NULL AND p_start_date IS NOT NULL AND p_end_date < p_start_date THEN
    RAISE EXCEPTION 'reversed dates (end before start) raise SQLSTATE 22023'
      USING ERRCODE = '22023';
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL
     OR (p_end_date - p_start_date) > 366 THEN
    RAISE EXCEPTION 'a 367-day span raises SQLSTATE 22023'
      USING ERRCODE = '22023';
  END IF;

  -- Resolve the restaurant time zone (fallback: America/Chicago), matching
  -- the client's safeTz. Reassign v_tz itself (not a new local), per the
  -- pg_timezone_names guard lesson: every downstream cast below reads v_tz.
  SELECT timezone INTO v_tz FROM restaurants WHERE id = p_restaurant_id;
  IF v_tz IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_tz
  ) THEN
    v_tz := 'America/Chicago';
  END IF;

  -- total_sales: every in-scope row of the window, regardless of view.
  SELECT round(coalesce(sum(coalesce(total_price, 0)), 0)::numeric, 2)
  INTO v_total_sales
  FROM unified_sales
  WHERE restaurant_id = p_restaurant_id
    AND item_type = 'sale'
    AND parent_sale_id IS NULL
    AND sale_date BETWEEN p_start_date AND p_end_date;

  IF p_view = 'weekday' THEN
    SELECT jsonb_agg(
      jsonb_build_object(
        'day_of_week', dw.day_of_week,
        'date', NULL,
        'sample_days', dw.sample_days,
        'day_total', NULL,
        'has_hourly_breakdown', dw.has_hourly_breakdown,
        'slots', dw.slots
      ) ORDER BY dw.day_of_week
    )
    INTO v_days
    FROM (
      WITH base AS (
        SELECT
          sale_date,
          EXTRACT(DOW FROM sale_date)::int AS day_of_week,
          coalesce(total_price, 0) AS total_price,
          (CASE
            WHEN sold_at IS NOT NULL THEN
              floor((EXTRACT(HOUR FROM (sold_at AT TIME ZONE v_tz)) * 60
                     + EXTRACT(MINUTE FROM (sold_at AT TIME ZONE v_tz)))
                    / p_interval_minutes) * p_interval_minutes
            WHEN sale_time IS NOT NULL THEN
              floor((EXTRACT(HOUR FROM sale_time) * 60
                     + EXTRACT(MINUTE FROM sale_time))
                    / p_interval_minutes) * p_interval_minutes
            ELSE NULL
          END)::int AS slot_start
        FROM unified_sales
        WHERE restaurant_id = p_restaurant_id
          AND item_type = 'sale'
          AND parent_sale_id IS NULL
          AND sale_date BETWEEN p_start_date AND p_end_date
      ),
      day_totals AS (
        SELECT day_of_week, sale_date, sum(total_price) AS day_total
        FROM base
        GROUP BY day_of_week, sale_date
      ),
      day_summary AS (
        SELECT day_of_week, count(*)::int AS sample_days, avg(day_total) AS avg_day_total
        FROM day_totals
        GROUP BY day_of_week
      ),
      date_slot_totals AS (
        SELECT day_of_week, slot_start, sale_date, sum(total_price) AS date_total
        FROM base
        WHERE slot_start IS NOT NULL
        GROUP BY day_of_week, slot_start, sale_date
      ),
      slot_summary AS (
        SELECT day_of_week, slot_start,
               round(avg(date_total)::numeric, 2) AS sales,
               count(*)::int AS sample_count
        FROM date_slot_totals
        GROUP BY day_of_week, slot_start
      ),
      hourly_days AS (
        SELECT ss.day_of_week, true AS has_hourly_breakdown,
               jsonb_agg(
                 jsonb_build_object(
                   'start_minute', ss.slot_start,
                   'sales', ss.sales,
                   'sample_count', ss.sample_count
                 ) ORDER BY ss.slot_start
               ) AS slots
        FROM slot_summary ss
        GROUP BY ss.day_of_week
      ),
      fallback_days AS (
        SELECT dsum.day_of_week, false AS has_hourly_breakdown,
               jsonb_agg(
                 jsonb_build_object(
                   'start_minute', gs.start_minute,
                   'sales', round((dsum.avg_day_total
                                   / ((1320 - 540) / p_interval_minutes))::numeric, 2),
                   'sample_count', dsum.sample_days
                 ) ORDER BY gs.start_minute
               ) AS slots
        FROM day_summary dsum
        CROSS JOIN generate_series(540, 1320 - p_interval_minutes, p_interval_minutes)
          AS gs(start_minute)
        WHERE dsum.day_of_week NOT IN (SELECT day_of_week FROM hourly_days)
        GROUP BY dsum.day_of_week, dsum.avg_day_total, dsum.sample_days
      ),
      merged AS (
        SELECT day_of_week, has_hourly_breakdown, slots FROM hourly_days
        UNION ALL
        SELECT day_of_week, has_hourly_breakdown, slots FROM fallback_days
      )
      SELECT m.day_of_week, dsum.sample_days, m.has_hourly_breakdown, m.slots
      FROM merged m
      JOIN day_summary dsum ON dsum.day_of_week = m.day_of_week
    ) dw;
  ELSE
    SELECT jsonb_agg(
      jsonb_build_object(
        'day_of_week', bd.day_of_week,
        'date', bd.sale_date,
        'sample_days', NULL,
        'day_total', bd.day_total,
        'has_hourly_breakdown', bd.has_hourly_breakdown,
        'slots', bd.slots
      ) ORDER BY bd.sale_date
    )
    INTO v_days
    FROM (
      WITH base AS (
        SELECT
          sale_date,
          EXTRACT(DOW FROM sale_date)::int AS day_of_week,
          coalesce(total_price, 0) AS total_price,
          (CASE
            WHEN sold_at IS NOT NULL THEN
              floor((EXTRACT(HOUR FROM (sold_at AT TIME ZONE v_tz)) * 60
                     + EXTRACT(MINUTE FROM (sold_at AT TIME ZONE v_tz)))
                    / p_interval_minutes) * p_interval_minutes
            WHEN sale_time IS NOT NULL THEN
              floor((EXTRACT(HOUR FROM sale_time) * 60
                     + EXTRACT(MINUTE FROM sale_time))
                    / p_interval_minutes) * p_interval_minutes
            ELSE NULL
          END)::int AS slot_start
        FROM unified_sales
        WHERE restaurant_id = p_restaurant_id
          AND item_type = 'sale'
          AND parent_sale_id IS NULL
          AND sale_date BETWEEN p_start_date AND p_end_date
      ),
      date_totals AS (
        SELECT sale_date, EXTRACT(DOW FROM sale_date)::int AS day_of_week,
               round(sum(total_price)::numeric, 2) AS day_total
        FROM base
        GROUP BY sale_date
      ),
      slot_totals AS (
        SELECT sale_date, slot_start, round(sum(total_price)::numeric, 2) AS sales
        FROM base
        WHERE slot_start IS NOT NULL
        GROUP BY sale_date, slot_start
      ),
      slot_agg AS (
        SELECT sale_date,
               jsonb_agg(
                 jsonb_build_object('start_minute', slot_start, 'sales', sales, 'sample_count', 1)
                 ORDER BY slot_start
               ) AS slots
        FROM slot_totals
        GROUP BY sale_date
      )
      SELECT dt.sale_date, dt.day_of_week, dt.day_total,
             (sa.slots IS NOT NULL) AS has_hourly_breakdown,
             coalesce(sa.slots, '[]'::jsonb) AS slots
      FROM date_totals dt
      LEFT JOIN slot_agg sa ON sa.sale_date = dt.sale_date
    ) bd;
  END IF;

  RETURN jsonb_build_object(
    'time_zone', v_tz,
    'view', p_view,
    'interval_minutes', p_interval_minutes,
    'start_date', p_start_date,
    'end_date', p_end_date,
    'total_sales', v_total_sales,
    'days', coalesce(v_days, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_hourly_sales_pattern(uuid, date, date, integer, text)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_hourly_sales_pattern(uuid, date, date, integer, text)
  TO authenticated;

COMMENT ON FUNCTION public.get_hourly_sales_pattern(uuid, date, date, integer, text) IS
  'Hourly sales pattern for a restaurant window. SECURITY INVOKER: the caller '
  'must have a user_restaurants row for p_restaurant_id, else "Access denied '
  'to restaurant". p_interval_minutes must be 15, 30, or 60; p_view must be '
  '"weekday" or "by_date"; p_start_date..p_end_date must be a valid span of '
  'at most 366 days -- all three raise SQLSTATE 22023 otherwise. Time zone '
  'falls back to America/Chicago when restaurants.timezone is null or not in '
  'pg_timezone_names (pg_catalog, always searched, so search_path does not '
  'hide it). Rounds with round(numeric, 2), which rounds a negative half '
  'away from zero. See docs/superpowers/specs/2026-09-27-connector-hourly-sales-design.md §4.1.';
