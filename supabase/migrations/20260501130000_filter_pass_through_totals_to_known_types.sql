-- Tighten get_pass_through_totals to known adjustment types so callers
-- never see 'void' or other unanticipated types leaking into POS Collected
-- via the "unknown bucket" branch in useRevenueBreakdown.
CREATE OR REPLACE FUNCTION public.get_pass_through_totals(
  p_restaurant_id UUID,
  p_date_from DATE,
  p_date_to DATE
)
RETURNS TABLE (
  adjustment_type TEXT,
  total_amount DECIMAL,
  transaction_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    us.adjustment_type::TEXT,
    COALESCE(SUM(us.total_price), 0)::DECIMAL AS total_amount,
    COUNT(*)::BIGINT AS transaction_count
  FROM unified_sales us
  WHERE us.restaurant_id = p_restaurant_id
    AND us.sale_date >= p_date_from
    AND us.sale_date <= p_date_to
    AND us.adjustment_type IN ('tax', 'tip', 'service_charge', 'discount', 'fee')
  GROUP BY us.adjustment_type;
END;
$function$;

COMMENT ON FUNCTION public.get_pass_through_totals IS
'Aggregates pass-through items (tax, tip, service_charge, discount, fee) from unified_sales.
Returns totals grouped by adjustment_type, avoiding the 1000 row limit issue.
Only the five known adjustment types are returned; unknown types (void, refund, etc.)
are excluded so they cannot leak into POS Collected via the useRevenueBreakdown hook.';
