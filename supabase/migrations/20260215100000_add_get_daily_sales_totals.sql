-- Server-side daily sales aggregation for break-even analysis.
-- Replaces client-side query that hit Supabase's 1000-row default limit.

CREATE OR REPLACE FUNCTION public.get_daily_sales_totals(
  p_restaurant_id UUID,
  p_date_from DATE,
  p_date_to DATE
)
RETURNS TABLE (
  sale_date DATE,
  total_revenue DECIMAL,
  transaction_count BIGINT
)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT
    us.sale_date,
    COALESCE(SUM(us.total_price), 0) AS total_revenue,
    COUNT(*) AS transaction_count
  FROM unified_sales us
  WHERE us.restaurant_id = p_restaurant_id
    AND us.sale_date >= p_date_from
    AND us.sale_date <= p_date_to
    AND us.adjustment_type IS NULL
    AND us.item_type = 'sale'
    AND NOT EXISTS (
      SELECT 1 FROM unified_sales child
      WHERE child.parent_sale_id = us.id
    )
  GROUP BY us.sale_date
  ORDER BY us.sale_date;
$$;

GRANT EXECUTE ON FUNCTION public.get_daily_sales_totals(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_daily_sales_totals IS
'Aggregates daily sales totals from unified_sales for break-even analysis.
Returns one row per date with total revenue and transaction count.
Excludes adjustments (tax/tips/discounts), non-sale items, and parent sales with splits.';
