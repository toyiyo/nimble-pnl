CREATE OR REPLACE FUNCTION public.get_top_sold_items(
  p_restaurant_id UUID, p_start_date DATE, p_end_date DATE, p_limit INT DEFAULT 10
)
RETURNS TABLE(item_name TEXT, revenue NUMERIC, quantity NUMERIC, sale_count BIGINT)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT us.item_name,
         COALESCE(SUM(us.total_price), 0)::NUMERIC AS revenue,
         COALESCE(SUM(us.quantity), 0)::NUMERIC AS quantity,
         COUNT(*)::BIGINT AS sale_count
  FROM unified_sales us
  WHERE us.restaurant_id = p_restaurant_id
    AND us.sale_date >= p_start_date AND us.sale_date <= p_end_date
    AND us.adjustment_type IS NULL
    AND LOWER(COALESCE(us.item_type, 'sale')) = 'sale'
    AND NOT EXISTS (
      SELECT 1 FROM unified_sales child
      WHERE child.parent_sale_id = us.id
        AND child.restaurant_id = p_restaurant_id)
  GROUP BY us.item_name
  ORDER BY revenue DESC
  LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION public.get_top_sold_items(UUID, DATE, DATE, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_top_sold_items(UUID, DATE, DATE, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_top_sold_items(UUID, DATE, DATE, INT) TO authenticated;

COMMENT ON FUNCTION public.get_top_sold_items IS
'Top items by revenue from unified_sales. Same exclusions as
get_sales_by_category. SECURITY INVOKER; EXECUTE for authenticated only.';
