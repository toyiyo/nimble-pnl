-- Fix get_unified_sales_totals: check adjustment_type before item_type
--
-- Problem: adjustment rows (tip, tax, service_charge, fee) get item_type='sale'
-- by DEFAULT, so the old CASE branches counted them as revenue instead of
-- pass-through. This migration checks adjustment_type first in every branch.

CREATE OR REPLACE FUNCTION get_unified_sales_totals(
  p_restaurant_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_search_term TEXT DEFAULT NULL
)
RETURNS TABLE (
  total_count BIGINT,
  revenue NUMERIC,
  discounts NUMERIC,
  voids NUMERIC,
  pass_through_amount NUMERIC,
  unique_items BIGINT,
  collected_at_pos NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify user has access to this restaurant
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

    -- Revenue: only rows that are actual sales (no adjustment_type)
    COALESCE(SUM(
      CASE
        WHEN us.adjustment_type IS NOT NULL THEN 0
        WHEN us.item_type = 'sale' THEN us.total_price
        ELSE 0
      END
    ), 0)::NUMERIC AS revenue,

    -- Discounts: adjustment_type='discount' OR legacy item_type='discount' (non-void)
    COALESCE(SUM(
      CASE
        WHEN us.adjustment_type = 'discount' THEN ABS(us.total_price)
        WHEN us.item_type = 'discount' AND COALESCE(us.adjustment_type, 'discount') != 'void' THEN ABS(us.total_price)
        ELSE 0
      END
    ), 0)::NUMERIC AS discounts,

    -- Voids: adjustment_type='void' OR legacy item_type='discount' with adjustment_type='void'
    COALESCE(SUM(
      CASE
        WHEN us.adjustment_type = 'void' THEN ABS(us.total_price)
        WHEN us.item_type = 'discount' AND us.adjustment_type = 'void' THEN ABS(us.total_price)
        ELSE 0
      END
    ), 0)::NUMERIC AS voids,

    -- Pass-through: adjustment rows that are NOT discount/void, plus legacy non-sale/non-discount item_types
    COALESCE(SUM(
      CASE
        WHEN us.adjustment_type IS NOT NULL AND us.adjustment_type NOT IN ('discount', 'void') THEN us.total_price
        WHEN us.adjustment_type IS NULL AND us.item_type NOT IN ('sale', 'discount') THEN us.total_price
        ELSE 0
      END
    ), 0)::NUMERIC AS pass_through_amount,

    COUNT(DISTINCT us.item_name)::BIGINT AS unique_items,
    COALESCE(SUM(us.total_price), 0)::NUMERIC AS collected_at_pos
  FROM unified_sales us
  WHERE us.restaurant_id = p_restaurant_id
    AND us.parent_sale_id IS NULL
    AND (p_start_date IS NULL OR us.sale_date >= p_start_date)
    AND (p_end_date IS NULL OR us.sale_date <= p_end_date)
    AND (
      p_search_term IS NULL
      OR p_search_term = ''
      OR us.item_name ILIKE '%' || p_search_term || '%'
    );
END;
$$;
