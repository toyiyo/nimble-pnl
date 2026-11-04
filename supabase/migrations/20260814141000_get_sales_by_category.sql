-- Sales revenue grouped by category for one restaurant and date range.
-- SECURITY INVOKER: RLS on unified_sales scopes the caller (spec §8).
CREATE OR REPLACE FUNCTION public.get_sales_by_category(
  p_restaurant_id UUID, p_start_date DATE, p_end_date DATE
)
RETURNS TABLE(category_id UUID, category_name TEXT, revenue NUMERIC, item_count BIGINT)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT us.category_id,
         COALESCE(coa.account_name, 'Uncategorized') AS category_name,
         COALESCE(SUM(us.total_price), 0)::NUMERIC AS revenue,
         COUNT(*)::BIGINT AS item_count
  FROM unified_sales us
  LEFT JOIN chart_of_accounts coa ON coa.id = us.category_id AND coa.restaurant_id = p_restaurant_id
  WHERE us.restaurant_id = p_restaurant_id
    AND us.sale_date >= p_start_date AND us.sale_date <= p_end_date
    AND us.adjustment_type IS NULL
    AND LOWER(COALESCE(us.item_type, 'sale')) = 'sale'
    AND NOT EXISTS (
      SELECT 1 FROM unified_sales child
      WHERE child.parent_sale_id = us.id
        AND child.restaurant_id = p_restaurant_id)
  GROUP BY us.category_id, coa.account_name
  ORDER BY revenue DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_sales_by_category(UUID, DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_sales_by_category(UUID, DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_sales_by_category(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_sales_by_category IS
'Revenue by category from unified_sales. Excludes adjustments, refunds, and
split parents. SECURITY INVOKER; EXECUTE for authenticated only.';
