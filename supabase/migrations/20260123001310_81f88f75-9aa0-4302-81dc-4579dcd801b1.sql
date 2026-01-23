-- Create function to get aggregated totals for unified sales
-- This provides accurate totals regardless of pagination
CREATE OR REPLACE FUNCTION public.get_unified_sales_totals(
  p_restaurant_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_search_term TEXT DEFAULT NULL
)
RETURNS TABLE (
  total_count BIGINT,
  revenue NUMERIC,
  discounts NUMERIC,
  pass_through_amount NUMERIC,
  unique_items BIGINT,
  collected_at_pos NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validate user has access to this restaurant
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants ur
    WHERE ur.restaurant_id = p_restaurant_id
    AND ur.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied to restaurant';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT as total_count,
    COALESCE(SUM(
      CASE 
        WHEN us.is_pass_through = false THEN us.total_price 
        ELSE 0 
      END
    ), 0)::NUMERIC as revenue,
    COALESCE(SUM(COALESCE(us.discount_amount, 0)), 0)::NUMERIC as discounts,
    COALESCE(SUM(
      CASE 
        WHEN us.is_pass_through = true THEN us.total_price 
        ELSE 0 
      END
    ), 0)::NUMERIC as pass_through_amount,
    COUNT(DISTINCT us.item_name)::BIGINT as unique_items,
    COALESCE(SUM(us.total_price), 0)::NUMERIC as collected_at_pos
  FROM unified_sales us
  WHERE us.restaurant_id = p_restaurant_id
    AND us.parent_sale_id IS NULL  -- Exclude child splits
    AND (p_start_date IS NULL OR us.sale_date >= p_start_date)
    AND (p_end_date IS NULL OR us.sale_date <= p_end_date)
    AND (
      p_search_term IS NULL 
      OR p_search_term = '' 
      OR us.item_name ILIKE '%' || p_search_term || '%'
    );
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_unified_sales_totals(UUID, DATE, DATE, TEXT) TO authenticated;