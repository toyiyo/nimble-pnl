-- Migration: Filter get_revenue_by_account to item_type='sale' in categorized branch
--
-- Bug: The categorized branch of get_revenue_by_account only guarded against
-- adjustment_type IS NOT NULL, but did not guard against non-sale item_type values.
-- A row with item_type='discount', adjustment_type=NULL, is_categorized=TRUE could
-- therefore be joined to chart_of_accounts and inflated the revenue total.
-- Observed in production: Russo's Pizzeria April 2026, alcohol_sales account +$5.
--
-- Fix: Add AND us.item_type = 'sale' to the categorized branch WHERE clause.
-- (The uncategorized branch already had LOWER(COALESCE(us.item_type,'sale'))='sale'.)

CREATE OR REPLACE FUNCTION public.get_revenue_by_account(
  p_restaurant_id UUID,
  p_date_from DATE,
  p_date_to DATE
)
RETURNS TABLE (
  account_id UUID,
  account_code TEXT,
  account_name TEXT,
  account_type TEXT,
  account_subtype TEXT,
  total_amount DECIMAL,
  transaction_count BIGINT,
  is_categorized BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Get categorized sales grouped by account
  RETURN QUERY
  SELECT
    coa.id as account_id,
    coa.account_code::TEXT,
    coa.account_name::TEXT,
    coa.account_type::TEXT,
    coa.account_subtype::TEXT,
    COALESCE(SUM(us.total_price), 0)::DECIMAL as total_amount,
    COUNT(*)::BIGINT as transaction_count,
    TRUE as is_categorized
  FROM unified_sales us
  INNER JOIN chart_of_accounts coa ON us.category_id = coa.id
  WHERE us.restaurant_id = p_restaurant_id
    AND us.sale_date >= p_date_from
    AND us.sale_date <= p_date_to
    AND us.adjustment_type IS NULL  -- Only regular sales, not adjustments
    AND us.item_type = 'sale'       -- Only sale-type rows; excludes discount/tip/tax with NULL adjustment_type
    AND us.is_categorized = TRUE
    AND us.category_id IS NOT NULL
    -- Exclude parent sales that have been split
    AND NOT EXISTS (
      SELECT 1 FROM unified_sales child
      WHERE child.parent_sale_id = us.id
    )
  GROUP BY coa.id, coa.account_code, coa.account_name, coa.account_type, coa.account_subtype

  UNION ALL

  -- Get uncategorized sales total as a single row
  SELECT
    NULL::UUID as account_id,
    'UNCATEGORIZED'::TEXT as account_code,
    'Uncategorized Sales'::TEXT as account_name,
    'revenue'::TEXT as account_type,
    'uncategorized'::TEXT as account_subtype,
    COALESCE(SUM(us.total_price), 0)::DECIMAL as total_amount,
    COUNT(*)::BIGINT as transaction_count,
    FALSE as is_categorized
  FROM unified_sales us
  WHERE us.restaurant_id = p_restaurant_id
    AND us.sale_date >= p_date_from
    AND us.sale_date <= p_date_to
    AND us.adjustment_type IS NULL  -- Only regular sales
    AND (us.is_categorized = FALSE OR us.category_id IS NULL)
    AND LOWER(COALESCE(us.item_type, 'sale')) = 'sale'  -- Only sale items
    -- Exclude parent sales that have been split
    AND NOT EXISTS (
      SELECT 1 FROM unified_sales child
      WHERE child.parent_sale_id = us.id
    )
  GROUP BY 1,2,3,4,5
  HAVING COUNT(*) > 0;
END;
$function$;

-- Re-emit grant (matches original migration in 20251201100000_aggregate_pass_through_totals.sql)
GRANT EXECUTE ON FUNCTION public.get_revenue_by_account(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_revenue_by_account IS
'Aggregates revenue from unified_sales grouped by chart_of_accounts category.
Returns both categorized and uncategorized sales totals for revenue breakdown display.

IMPORTANT: Both branches filter to item_type = ''sale'' (categorized branch uses
AND us.item_type = ''sale''; uncategorized branch uses LOWER(COALESCE(...)) = ''sale'').
Any new POS revenue ingest path MUST write item_type = ''sale'' for normal sale rows,
otherwise those rows will be silently excluded from the monthly revenue breakdown.
Rows with adjustment_type IS NULL but item_type != ''sale'' (e.g. discount, tip, tax)
are pass-through items that belong in get_pass_through_totals, not here.';
