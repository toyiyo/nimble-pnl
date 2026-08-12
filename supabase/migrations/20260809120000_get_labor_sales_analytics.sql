-- get_labor_sales_analytics: one-round-trip sales aggregate for the /labor page.
-- Replaces the client-side aggregation of ~23,700 raw unified_sales rows per
-- load (18-week window) with a single JSONB result. Authoritative revenue
-- predicate (design §3): parent_sale_id IS NULL AND adjustment_type IS NULL
-- AND item_type = 'sale'. Hour buckets use sold_at (timezone-aware) when
-- present, else sale_time (a TIME column), else NULL (excluded from the grid).

CREATE OR REPLACE FUNCTION public.get_labor_sales_analytics(
  p_restaurant_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_time_zone TEXT DEFAULT 'America/Chicago'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_time_zone TEXT := COALESCE(p_time_zone, 'America/Chicago');
  v_result JSONB;
BEGIN
  -- Access check: the caller must be a member of the restaurant. SECURITY
  -- DEFINER bypasses RLS, so this gate is the tenant isolation boundary.
  IF NOT EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = p_restaurant_id
      AND ur.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied to restaurant';
  END IF;

  WITH revenue_rows AS (
    SELECT
      us.sale_date,
      us.total_price,
      CASE
        WHEN us.sold_at IS NOT NULL
          THEN EXTRACT(HOUR FROM (us.sold_at AT TIME ZONE v_time_zone))::int
        WHEN us.sale_time IS NOT NULL
          THEN EXTRACT(HOUR FROM us.sale_time)::int
        ELSE NULL
      END AS hour_bucket
    FROM public.unified_sales us
    WHERE us.restaurant_id = p_restaurant_id
      AND us.parent_sale_id IS NULL
      AND us.adjustment_type IS NULL
      AND us.item_type = 'sale'
      AND us.sale_date >= p_start_date
      AND us.sale_date <= p_end_date
  )
  SELECT jsonb_build_object(
    'daily', (
      SELECT COALESCE(jsonb_agg(d ORDER BY d.sale_date), '[]'::jsonb)
      FROM (
        SELECT sale_date, ROUND(COALESCE(SUM(total_price), 0), 2) AS revenue
        FROM revenue_rows
        GROUP BY sale_date
      ) d
    ),
    'grid', (
      SELECT COALESCE(jsonb_agg(g ORDER BY g.dow, g.hour), '[]'::jsonb)
      FROM (
        SELECT
          EXTRACT(DOW FROM sale_date)::int AS dow,
          hour_bucket AS hour,
          ROUND(COALESCE(SUM(total_price), 0), 2) AS revenue
        FROM revenue_rows
        WHERE hour_bucket IS NOT NULL
        GROUP BY EXTRACT(DOW FROM sale_date)::int, hour_bucket
      ) g
    ),
    'by_weekday', (
      SELECT COALESCE(jsonb_agg(w ORDER BY w.dow), '[]'::jsonb)
      FROM (
        SELECT EXTRACT(DOW FROM sale_date)::int AS dow, ROUND(COALESCE(SUM(total_price), 0), 2) AS revenue
        FROM revenue_rows
        GROUP BY EXTRACT(DOW FROM sale_date)::int
      ) w
    ),
    'has_hourly', (
      SELECT COALESCE(bool_or(hour_bucket IS NOT NULL), false) FROM revenue_rows
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_labor_sales_analytics(UUID, DATE, DATE, TEXT) TO authenticated;
