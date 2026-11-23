-- get_sales_daily_series: add an optional `by_hour` section and a time zone.
--
-- The POS Sales trends panel shows the prior period on the "Time of day"
-- chart. The prior call needs hour buckets in the restaurant time zone.
--
-- Design: docs/superpowers/specs/2026-11-22-sales-hourly-comparison-design.md
--
-- Contract: when p_include_hours is true, `by_hour` is identical to the
-- `by_hour` key of get_sales_trends (20260720010000_get_sales_trends.sql)
-- for the same restaurant, dates, and time zone. The hour bucket rule and
-- the row shape are copies. If you change one RPC, change the other.
--
-- When p_include_hours is false, the payload is the same as the 3-argument
-- version (20261122150000_get_sales_daily_series.sql): no `by_hour` key.
--
-- The migration drops the 3-argument signature. Two overloads would make a
-- PostgREST call with three named arguments ambiguous. A 3-argument call
-- still works, because the two new parameters have defaults.

DROP FUNCTION IF EXISTS public.get_sales_daily_series(UUID, DATE, DATE);

CREATE OR REPLACE FUNCTION public.get_sales_daily_series(
  p_restaurant_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_time_zone TEXT DEFAULT 'America/Chicago',
  p_include_hours BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_time_zone TEXT := COALESCE(p_time_zone, 'America/Chicago');
  v_include_hours BOOLEAN := COALESCE(p_include_hours, false);
  v_result JSONB;
BEGIN
  -- Membership check first, so a non-member learns nothing about the
  -- arguments. Any member role can read sales, the same as get_sales_trends.
  IF NOT EXISTS (
    SELECT 1
    FROM user_restaurants ur
    WHERE ur.restaurant_id = p_restaurant_id
      AND ur.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied to restaurant';
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'p_start_date and p_end_date are required'
      USING ERRCODE = '22023';
  END IF;

  WITH revenue_rows AS (
    SELECT
      us.sale_date,
      us.pos_system,
      us.total_price,
      us.external_order_id,
      us.id,
      -- The same rule as get_sales_trends. The function computes the
      -- bucket only when the caller asks for hours.
      CASE
        WHEN NOT v_include_hours THEN NULL
        WHEN us.sold_at IS NOT NULL
          THEN EXTRACT(HOUR FROM (us.sold_at AT TIME ZONE v_time_zone))::int
        WHEN us.sale_time IS NOT NULL
          THEN EXTRACT(HOUR FROM us.sale_time)::int
        ELSE NULL
      END AS hour_bucket
    FROM unified_sales us
    WHERE us.restaurant_id = p_restaurant_id
      AND us.parent_sale_id IS NULL
      AND us.adjustment_type IS NULL
      AND us.item_type = 'sale'
      AND us.sale_date >= p_start_date
      AND us.sale_date <= p_end_date
  ),
  day_rows AS (
    SELECT
      sale_date,
      pos_system,
      COALESCE(SUM(total_price), 0) AS rev,
      COUNT(DISTINCT COALESCE(external_order_id, id::text)) AS orders
    FROM revenue_rows
    GROUP BY sale_date, pos_system
  )
  SELECT jsonb_build_object(
    'pos_systems', (
      SELECT COALESCE(jsonb_agg(s.pos_system ORDER BY s.rev DESC, s.pos_system), '[]'::jsonb)
      FROM (
        SELECT pos_system, SUM(rev) AS rev
        FROM day_rows
        GROUP BY pos_system
      ) s
    ),
    'by_day', (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'sale_date', d.sale_date,
            'pos_system', d.pos_system,
            'revenue', ROUND(d.rev, 2),
            'orders', d.orders
          )
          ORDER BY d.sale_date, d.pos_system
        ),
        '[]'::jsonb
      )
      FROM day_rows d
    )
  )
  || CASE
       WHEN v_include_hours THEN jsonb_build_object(
         'by_hour', (
           SELECT COALESCE(
             jsonb_agg(
               jsonb_build_object(
                 'hour', h.hour_bucket,
                 'pos_system', h.pos_system,
                 'revenue', ROUND(h.rev, 2),
                 'day_count', h.day_count
               )
               ORDER BY h.hour_bucket, h.pos_system
             ),
             '[]'::jsonb
           )
           FROM (
             SELECT
               hour_bucket,
               pos_system,
               COALESCE(SUM(total_price), 0) AS rev,
               COUNT(DISTINCT sale_date) AS day_count
             FROM revenue_rows
             WHERE hour_bucket IS NOT NULL
             GROUP BY hour_bucket, pos_system
           ) h
         )
       )
       ELSE '{}'::jsonb
     END
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_sales_daily_series(UUID, DATE, DATE, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_sales_daily_series(UUID, DATE, DATE, TEXT, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_sales_daily_series(UUID, DATE, DATE, TEXT, BOOLEAN) TO authenticated;

COMMENT ON FUNCTION public.get_sales_daily_series(UUID, DATE, DATE, TEXT, BOOLEAN) IS
  'Daily revenue and orders per POS system for one restaurant. Same pos_systems and by_day as get_sales_trends. With p_include_hours, also by_hour, the same as get_sales_trends for p_time_zone. Both dates are required.';
