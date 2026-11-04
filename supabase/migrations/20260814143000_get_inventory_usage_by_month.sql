CREATE OR REPLACE FUNCTION public.get_inventory_usage_by_month(
  p_restaurant_id UUID, p_start_date DATE, p_end_date DATE
)
RETURNS TABLE(period TEXT, food_cost NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT TO_CHAR(it.created_at AT TIME ZONE 'UTC', 'YYYY-MM') AS period,
         ABS(COALESCE(SUM(it.total_cost), 0))::NUMERIC AS food_cost
  FROM inventory_transactions it
  WHERE it.restaurant_id = p_restaurant_id
    AND it.transaction_type = 'usage'
    -- Explicit UTC bounds. Includes the full end day (spec §5.4).
    AND it.created_at >= (p_start_date::timestamp AT TIME ZONE 'UTC')
    AND it.created_at < ((p_end_date + 1)::timestamp AT TIME ZONE 'UTC')
  GROUP BY 1
  ORDER BY 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_inventory_usage_by_month(UUID, DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_inventory_usage_by_month(UUID, DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_usage_by_month(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_inventory_usage_by_month IS
'Monthly COGS from inventory_transactions usage rows, ABS(SUM(total_cost)) per
month, full end day included, explicit UTC bounds. SECURITY INVOKER.';
