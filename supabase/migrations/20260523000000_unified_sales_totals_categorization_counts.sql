-- Extend get_unified_sales_totals with categorization counts.
--
-- Why: POSSales.tsx derives the "Uncategorized" and "Pending review" badge
-- counts from the paginated client-side `sales` array. With PAGE_SIZE=500 and
-- restaurants seeing thousands of sales/day, that count diverges from truth
-- and stays non-zero even after the user finishes categorising every visible
-- row. See sig:539980c1fe88. We push the count down to the same SQL aggregate
-- that already backs every other dashboard metric on the page.
--
-- Predicate `is_categorized IS NOT TRUE` is intentional: the column is
-- nullable in older rows, and `!sale.is_categorized` in JS treats null as
-- falsy. The SQL must match so the counts don't change semantics.
--
-- Caller-facing change is backwards-compatible: callers select columns by name
-- (useRevenueBreakdown, useMonthlyMetrics, useUnifiedSalesTotals), so adding
-- columns doesn't break them. But Postgres can't change a function's
-- RETURNS TABLE shape via CREATE OR REPLACE — must DROP first. The input
-- parameter signature is unchanged, so we re-GRANT EXECUTE at the bottom.

DROP FUNCTION IF EXISTS public.get_unified_sales_totals(UUID, DATE, DATE, TEXT);

CREATE FUNCTION get_unified_sales_totals(
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
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_unified_sales_totals(UUID, DATE, DATE, TEXT) TO authenticated;
