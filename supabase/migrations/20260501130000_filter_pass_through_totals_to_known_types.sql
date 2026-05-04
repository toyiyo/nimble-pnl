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
are excluded so they cannot leak into POS Collected via the useRevenueBreakdown hook.
NOTE: If a new POS adjustment_type is added, update both this IN list (via a new
migration) AND the PASS_THROUGH_OTHER_LIABILITY_TYPES set in
src/hooks/useMonthlyMetrics.tsx / useRevenueBreakdown.tsx so it surfaces in the dashboard.';

-- Re-grant execute permission. CREATE OR REPLACE preserves grants in
-- production today, but emitting GRANT here matches the convention used
-- by the original migration (20251201100000_aggregate_pass_through_totals.sql)
-- and protects fresh-database setups against migration-order surprises.
GRANT EXECUTE ON FUNCTION public.get_pass_through_totals(UUID, DATE, DATE) TO authenticated;
