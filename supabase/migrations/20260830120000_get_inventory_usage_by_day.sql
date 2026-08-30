-- get_inventory_usage_by_day: per-day usage-cost rollup for the dashboard.
-- It replaces the client-side page loops in useFoodCosts and
-- useMonthlyMetrics. Semantics match the client code exactly:
--   * The day bucket uses transaction_date first, then created_at (UTC).
--   * The filter has the same two branches: transaction_date bounds when
--     present, created_at (UTC) bounds when transaction_date is NULL.
--   * The sum applies ABS per row, the same as the client Math.abs.
--     This differs from get_inventory_usage_by_month (ABS of the SUM).

CREATE OR REPLACE FUNCTION public.get_inventory_usage_by_day(
  p_restaurant_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE(day DATE, food_cost NUMERIC)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT
    COALESCE(it.transaction_date::date, (it.created_at AT TIME ZONE 'UTC')::date) AS day,
    SUM(ABS(COALESCE(it.total_cost, 0)))::NUMERIC AS food_cost
  FROM inventory_transactions it
  WHERE it.restaurant_id = p_restaurant_id
    AND it.transaction_type = 'usage'
    AND (
      it.transaction_date >= p_start_date
      OR (it.transaction_date IS NULL
        AND it.created_at >= (p_start_date::timestamp AT TIME ZONE 'UTC'))
    )
    AND (
      it.transaction_date <= p_end_date
      OR (it.transaction_date IS NULL
        AND it.created_at <= ((p_end_date::timestamp AT TIME ZONE 'UTC') + interval '23:59:59.999'))
    )
  GROUP BY 1
  ORDER BY 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_inventory_usage_by_day(UUID, DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_inventory_usage_by_day(UUID, DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_usage_by_day(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_inventory_usage_by_day IS
  'Per-day usage cost for the dashboard. SECURITY INVOKER: RLS on inventory_transactions applies. The day bucket uses transaction_date first, then created_at (UTC). The sum applies ABS per row.';
