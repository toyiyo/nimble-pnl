-- Extend get_unified_sales_totals with an optional pos_system/source filter so
-- the POS Sales view can keep dashboard totals aligned with the selected source.

DROP FUNCTION IF EXISTS public.get_unified_sales_totals(UUID, DATE, DATE, TEXT);
DROP FUNCTION IF EXISTS public.get_unified_sales_totals(UUID, DATE, DATE, TEXT, TEXT);

CREATE FUNCTION get_unified_sales_totals(
  p_restaurant_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_search_term TEXT DEFAULT NULL,
  p_pos_system TEXT DEFAULT NULL
)
RETURNS TABLE (
  total_count BIGINT,
  revenue NUMERIC,
  discounts NUMERIC,
  voids NUMERIC,
  pass_through_amount NUMERIC,
  unique_items BIGINT,
  collected_at_pos NUMERIC,
  uncategorized_count BIGINT,
  pending_review_count BIGINT
)
LANGUAGE plpgsql
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
    COUNT(*)::BIGINT AS total_count,

    COALESCE(SUM(
      CASE
        WHEN us.adjustment_type IS NOT NULL THEN 0
        WHEN us.item_type = 'sale' THEN us.total_price
        ELSE 0
      END
    ), 0)::NUMERIC AS revenue,

    COALESCE(SUM(
      CASE
        WHEN us.adjustment_type = 'discount' THEN ABS(us.total_price)
        WHEN us.adjustment_type IS NULL AND us.item_type = 'discount' THEN ABS(us.total_price)
        ELSE 0
      END
    ), 0)::NUMERIC AS discounts,

    COALESCE(SUM(
      CASE
        WHEN us.adjustment_type = 'void' THEN ABS(us.total_price)
        ELSE 0
      END
    ), 0)::NUMERIC AS voids,

    COALESCE(SUM(
      CASE
        WHEN us.adjustment_type IS NOT NULL AND us.adjustment_type NOT IN ('discount', 'void') THEN us.total_price
        WHEN us.adjustment_type IS NULL AND us.item_type NOT IN ('sale', 'discount') THEN us.total_price
        ELSE 0
      END
    ), 0)::NUMERIC AS pass_through_amount,

    COUNT(DISTINCT us.item_name)::BIGINT AS unique_items,
    COALESCE(SUM(us.total_price), 0)::NUMERIC AS collected_at_pos,

    COUNT(*) FILTER (
      WHERE us.is_categorized IS NOT TRUE AND us.suggested_category_id IS NULL
    )::BIGINT AS uncategorized_count,

    COUNT(*) FILTER (
      WHERE us.is_categorized IS NOT TRUE AND us.suggested_category_id IS NOT NULL
    )::BIGINT AS pending_review_count
  FROM unified_sales us
  WHERE us.restaurant_id = p_restaurant_id
    AND us.parent_sale_id IS NULL
    AND (p_start_date IS NULL OR us.sale_date >= p_start_date)
    AND (p_end_date IS NULL OR us.sale_date <= p_end_date)
    AND (
      p_search_term IS NULL
      OR p_search_term = ''
      OR us.item_name ILIKE '%' || p_search_term || '%'
    )
    AND (
      p_pos_system IS NULL
      OR p_pos_system = ''
      OR us.pos_system = p_pos_system
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_unified_sales_totals(UUID, DATE, DATE, TEXT, TEXT) TO authenticated;
