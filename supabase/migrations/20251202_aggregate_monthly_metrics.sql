-- Migration: Add function to aggregate monthly metrics from unified_sales
-- This eliminates the need to fetch all individual records (which hits Supabase's 1000 row limit)
-- and instead returns pre-computed totals grouped by month

CREATE OR REPLACE FUNCTION public.get_monthly_sales_metrics(
  p_restaurant_id UUID,
  p_date_from DATE,
  p_date_to DATE
)
RETURNS TABLE (
  period TEXT,
  gross_revenue DECIMAL,
  sales_tax DECIMAL,
  tips DECIMAL,
  other_liabilities DECIMAL,
  discounts DECIMAL
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH monthly_revenue AS (
    -- Gross revenue: regular sales (adjustment_type IS NULL)
    -- Only count items with item_type = 'sale' or NULL (not refunds, voids, etc.)
    SELECT 
      TO_CHAR(us.sale_date, 'YYYY-MM') as period,
      COALESCE(SUM(us.total_price), 0)::DECIMAL as amount
    FROM unified_sales us
    WHERE us.restaurant_id = p_restaurant_id
      AND us.sale_date >= p_date_from
      AND us.sale_date <= p_date_to
      AND us.adjustment_type IS NULL
      AND LOWER(COALESCE(us.item_type, 'sale')) = 'sale'
      -- Exclude parent sales that have been split
      AND NOT EXISTS (
        SELECT 1 FROM unified_sales child
        WHERE child.parent_sale_id = us.id
      )
    GROUP BY TO_CHAR(us.sale_date, 'YYYY-MM')
  ),
  monthly_adjustments AS (
    -- Adjustments grouped by type and month
    SELECT 
      TO_CHAR(us.sale_date, 'YYYY-MM') as period,
      us.adjustment_type,
      COALESCE(SUM(us.total_price), 0)::DECIMAL as amount
    FROM unified_sales us
    WHERE us.restaurant_id = p_restaurant_id
      AND us.sale_date >= p_date_from
      AND us.sale_date <= p_date_to
      AND us.adjustment_type IS NOT NULL
    GROUP BY TO_CHAR(us.sale_date, 'YYYY-MM'), us.adjustment_type
  ),
  monthly_categorized_liabilities AS (
    -- Liabilities from categorized items (items mapped to liability accounts)
    -- These are items with adjustment_type IS NULL but mapped to liability chart accounts
    -- Note: account_subtype is an enum type, so we cast to TEXT before using COALESCE
    SELECT 
      TO_CHAR(us.sale_date, 'YYYY-MM') as period,
      CASE 
        WHEN LOWER(COALESCE(coa.account_subtype::TEXT, '')) LIKE '%tax%' 
          OR LOWER(COALESCE(coa.account_name, '')) LIKE '%tax%' 
        THEN 'tax'
        WHEN LOWER(COALESCE(coa.account_subtype::TEXT, '')) LIKE '%tip%' 
          OR LOWER(COALESCE(coa.account_name, '')) LIKE '%tip%' 
        THEN 'tip'
        ELSE 'other_liability'
      END as liability_type,
      COALESCE(SUM(us.total_price), 0)::DECIMAL as amount
    FROM unified_sales us
    INNER JOIN chart_of_accounts coa ON us.category_id = coa.id
    WHERE us.restaurant_id = p_restaurant_id
      AND us.sale_date >= p_date_from
      AND us.sale_date <= p_date_to
      AND us.adjustment_type IS NULL
      AND us.is_categorized = TRUE
      AND coa.account_type = 'liability'
      -- Exclude parent sales that have been split
      AND NOT EXISTS (
        SELECT 1 FROM unified_sales child
        WHERE child.parent_sale_id = us.id
      )
    GROUP BY TO_CHAR(us.sale_date, 'YYYY-MM'),
      CASE 
        WHEN LOWER(COALESCE(coa.account_subtype::TEXT, '')) LIKE '%tax%' 
          OR LOWER(COALESCE(coa.account_name, '')) LIKE '%tax%' 
        THEN 'tax'
        WHEN LOWER(COALESCE(coa.account_subtype::TEXT, '')) LIKE '%tip%' 
          OR LOWER(COALESCE(coa.account_name, '')) LIKE '%tip%' 
        THEN 'tip'
        ELSE 'other_liability'
      END
  ),
  all_periods AS (
    -- Get all unique periods
    SELECT DISTINCT period FROM monthly_revenue
    UNION
    SELECT DISTINCT period FROM monthly_adjustments
    UNION
    SELECT DISTINCT period FROM monthly_categorized_liabilities
  )
  SELECT 
    p.period,
    COALESCE(r.amount, 0) as gross_revenue,
    -- Sales tax: from adjustment_type='tax' + categorized tax liabilities
    COALESCE((SELECT SUM(a.amount) FROM monthly_adjustments a WHERE a.period = p.period AND a.adjustment_type = 'tax'), 0) +
    COALESCE((SELECT SUM(l.amount) FROM monthly_categorized_liabilities l WHERE l.period = p.period AND l.liability_type = 'tax'), 0) as sales_tax,
    -- Tips: from adjustment_type='tip' + categorized tip liabilities
    COALESCE((SELECT SUM(a.amount) FROM monthly_adjustments a WHERE a.period = p.period AND a.adjustment_type = 'tip'), 0) +
    COALESCE((SELECT SUM(l.amount) FROM monthly_categorized_liabilities l WHERE l.period = p.period AND l.liability_type = 'tip'), 0) as tips,
    -- Other liabilities: service_charge, fee, and other categorized liabilities
    COALESCE((SELECT SUM(a.amount) FROM monthly_adjustments a WHERE a.period = p.period AND a.adjustment_type IN ('service_charge', 'fee')), 0) +
    COALESCE((SELECT SUM(l.amount) FROM monthly_categorized_liabilities l WHERE l.period = p.period AND l.liability_type = 'other_liability'), 0) as other_liabilities,
    -- Discounts: from adjustment_type='discount'
    COALESCE((SELECT SUM(ABS(a.amount)) FROM monthly_adjustments a WHERE a.period = p.period AND a.adjustment_type = 'discount'), 0) as discounts
  FROM all_periods p
  LEFT JOIN monthly_revenue r ON r.period = p.period
  ORDER BY p.period DESC;
END;
$function$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_monthly_sales_metrics(UUID, DATE, DATE) TO authenticated;

-- Comment explaining the function
COMMENT ON FUNCTION public.get_monthly_sales_metrics IS 
'Aggregates monthly sales metrics from unified_sales table.
Returns gross_revenue, sales_tax, tips, other_liabilities, and discounts grouped by month.
This avoids the 1000 row limit issue when fetching individual records.';
