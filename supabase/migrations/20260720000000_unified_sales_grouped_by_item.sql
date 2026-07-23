-- Server-side grouped-by-item aggregation for the POS Sales "Grouped" view.
-- Mirrors get_unified_sales_totals: same auth guard, same filter parity, same
-- `parent_sale_id IS NULL` population so grouped revenue reconciles with the
-- header "Collected at POS" total. Sorting is done in SQL over the full
-- aggregate — this fixes the client-side Map-insertion-order sort bug where
-- "sort by amount" in Grouped view did nothing.
--
-- COALESCE on SUM(total_price): total_price is nullable (manual sales insert it
-- optionally); an all-NULL group must return 0, not NULL, or the RETURNS TABLE
-- numeric contract breaks and revenue sort becomes non-deterministic.
--
-- Sort whitelist uses a STATIC CASE expression — never EXECUTE/format() — so
-- p_sort_by/p_sort_direction cannot inject SQL.

CREATE OR REPLACE FUNCTION public.get_unified_sales_grouped_by_item(
  p_restaurant_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_search_term TEXT DEFAULT NULL,
  p_categorization_filter TEXT DEFAULT 'all',
  p_recipe_filter TEXT DEFAULT 'all',
  p_sort_by TEXT DEFAULT 'revenue',
  p_sort_direction TEXT DEFAULT 'desc'
)
RETURNS TABLE (
  item_name TEXT,
  total_quantity NUMERIC,
  total_revenue NUMERIC,
  sale_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants ur
    WHERE ur.restaurant_id = p_restaurant_id
      AND ur.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied to restaurant';
  END IF;

  RETURN QUERY
  SELECT
    us.item_name AS item_name,
    COALESCE(SUM(us.quantity), 0)::NUMERIC AS total_quantity,
    COALESCE(SUM(us.total_price), 0)::NUMERIC AS total_revenue,
    COUNT(*)::BIGINT AS sale_count
  FROM unified_sales us
  WHERE us.restaurant_id = p_restaurant_id
    AND us.parent_sale_id IS NULL
    AND (p_start_date IS NULL OR us.sale_date >= p_start_date)
    AND (p_end_date IS NULL OR us.sale_date <= p_end_date)
    AND (
      p_search_term IS NULL OR p_search_term = ''
      OR us.item_name ILIKE '%' || p_search_term || '%'
    )
    AND (
      p_categorization_filter = 'all'
      OR (p_categorization_filter = 'uncategorized'
          AND us.is_categorized IS NOT TRUE AND us.suggested_category_id IS NULL)
      OR (p_categorization_filter = 'pending-review'
          AND us.is_categorized IS NOT TRUE AND us.suggested_category_id IS NOT NULL)
      OR (p_categorization_filter = 'categorized'
          AND us.is_categorized IS TRUE)
    )
    AND (
      p_recipe_filter = 'all'
      OR (p_recipe_filter = 'with-recipe' AND EXISTS (
            SELECT 1 FROM recipes r
            WHERE r.restaurant_id = p_restaurant_id
              AND LOWER(r.pos_item_name) = LOWER(us.item_name)))
      OR (p_recipe_filter = 'without-recipe' AND NOT EXISTS (
            SELECT 1 FROM recipes r
            WHERE r.restaurant_id = p_restaurant_id
              AND LOWER(r.pos_item_name) = LOWER(us.item_name)))
    )
  GROUP BY us.item_name
  ORDER BY
    CASE WHEN p_sort_direction = 'asc' THEN
      CASE p_sort_by
        WHEN 'revenue' THEN COALESCE(SUM(us.total_price), 0)
        WHEN 'quantity' THEN COALESCE(SUM(us.quantity), 0)
        WHEN 'sales' THEN COUNT(*)::NUMERIC
      END
    END ASC NULLS LAST,
    CASE WHEN p_sort_direction <> 'asc' THEN
      CASE p_sort_by
        WHEN 'revenue' THEN COALESCE(SUM(us.total_price), 0)
        WHEN 'quantity' THEN COALESCE(SUM(us.quantity), 0)
        WHEN 'sales' THEN COUNT(*)::NUMERIC
      END
    END DESC NULLS LAST,
    CASE WHEN p_sort_by = 'name' AND p_sort_direction = 'asc' THEN us.item_name END ASC NULLS LAST,
    CASE WHEN p_sort_by = 'name' AND p_sort_direction <> 'asc' THEN us.item_name END DESC NULLS LAST,
    us.item_name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_unified_sales_grouped_by_item(UUID, DATE, DATE, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
