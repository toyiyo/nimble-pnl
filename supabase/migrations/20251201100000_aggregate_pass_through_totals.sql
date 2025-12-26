-- Migration: Add function to aggregate pass-through totals from unified_sales
-- This eliminates the need to fetch all individual records (which hits Supabase's 1000 row limit)
-- and instead returns pre-computed totals for each adjustment_type

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
    COALESCE(SUM(us.total_price), 0)::DECIMAL as total_amount,
    COUNT(*)::BIGINT as transaction_count
  FROM unified_sales us
  WHERE us.restaurant_id = p_restaurant_id
    AND us.sale_date >= p_date_from
    AND us.sale_date <= p_date_to
    AND us.adjustment_type IS NOT NULL
  GROUP BY us.adjustment_type;
END;
$function$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_pass_through_totals(UUID, DATE, DATE) TO authenticated;

-- Also create a function for revenue breakdown totals by chart account
-- This groups sales by their category (chart_account) for the revenue breakdown display
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

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_revenue_by_account(UUID, DATE, DATE) TO authenticated;

-- Comment explaining the functions
COMMENT ON FUNCTION public.get_pass_through_totals IS 
'Aggregates pass-through items (tax, tips, service_charge, discount, fee) from unified_sales. 
Returns totals grouped by adjustment_type, avoiding the 1000 row limit issue.';

COMMENT ON FUNCTION public.get_revenue_by_account IS 
'Aggregates revenue from unified_sales grouped by chart_of_accounts category.
Returns both categorized and uncategorized sales totals for revenue breakdown display.';
