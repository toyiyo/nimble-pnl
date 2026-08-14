CREATE OR REPLACE FUNCTION public.get_inventory_valuation(p_restaurant_id UUID)
RETURNS TABLE(total_value NUMERIC, item_count BIGINT, low_stock_count BIGINT)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(SUM(p.current_stock * p.cost_per_unit), 0)::NUMERIC,
         COUNT(*)::BIGINT,
         COUNT(*) FILTER (WHERE p.current_stock <= COALESCE(p.par_level_min, 0))::BIGINT
  FROM products p
  WHERE p.restaurant_id = p_restaurant_id;
$$;

REVOKE EXECUTE ON FUNCTION public.get_inventory_valuation(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_inventory_valuation(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_valuation(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_inventory_valuation IS
'Inventory value, item count, and low-stock count from products. The low-stock
predicate is current_stock <= COALESCE(par_level_min, 0). SECURITY INVOKER.';
