-- get_sales_daily_series: daily revenue and orders per POS system.
--
-- The POS Sales trends panel uses this RPC for the prior-period comparison.
-- The panel reads only `pos_systems` and `by_day` from the prior result, so
-- this function builds only these two arrays. The full `get_sales_trends`
-- RPC also builds the hour, weekday, and product aggregates.
--
-- Design: docs/superpowers/specs/2026-11-22-sales-daily-series-rpc-design.md
--
-- Contract: the `pos_systems` and `by_day` arrays are identical to the same
-- keys of `get_sales_trends` (20260720010000_get_sales_trends.sql) for the
-- same restaurant and dates. The revenue predicate and the security model are
-- copies. If you change one RPC, change the other.
--
-- The range scan can use idx_unified_sales_restaurant_keyset
-- (restaurant_id, sale_date, created_at, id).

CREATE OR REPLACE FUNCTION public.get_sales_daily_series(
  p_restaurant_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
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

  -- No range cap: get_sales_trends has none, and the panel compares a prior
  -- range of the same length as the current range.

  WITH revenue_rows AS (
    SELECT
      us.sale_date,
      us.pos_system,
      us.total_price,
      us.external_order_id,
      us.id
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
      SELECT COALESCE(jsonb_agg(s.pos_system ORDER BY s.rev DESC), '[]'::jsonb)
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
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_sales_daily_series(UUID, DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_sales_daily_series(UUID, DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_sales_daily_series(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_sales_daily_series(UUID, DATE, DATE) IS
  'Daily revenue and orders per POS system for one restaurant. Same pos_systems and by_day as get_sales_trends. Both dates are required.';
