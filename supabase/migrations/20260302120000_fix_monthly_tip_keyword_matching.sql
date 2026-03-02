-- Migration: tighten monthly tip matching to avoid false positives
-- Prevent liability account names that merely contain the letters "tip"
-- (e.g. "stipend") from being counted as tips.

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
    SELECT 
      TO_CHAR(us.sale_date, 'YYYY-MM') as month_period,
      COALESCE(SUM(us.total_price), 0)::DECIMAL as amount
    FROM unified_sales us
    WHERE us.restaurant_id = p_restaurant_id
      AND us.sale_date >= p_date_from
      AND us.sale_date <= p_date_to
      AND us.adjustment_type IS NULL
      AND LOWER(COALESCE(us.item_type, 'sale')) = 'sale'
      AND NOT EXISTS (
        SELECT 1 FROM unified_sales child
        WHERE child.parent_sale_id = us.id
      )
    GROUP BY TO_CHAR(us.sale_date, 'YYYY-MM')
  ),
  monthly_adjustments AS (
    SELECT 
      TO_CHAR(us.sale_date, 'YYYY-MM') as month_period,
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
    SELECT 
      TO_CHAR(us.sale_date, 'YYYY-MM') as month_period,
      CASE 
        WHEN LOWER(COALESCE(coa.account_subtype::TEXT, '')) LIKE '%tax%' 
          OR LOWER(COALESCE(coa.account_name, '')) LIKE '%tax%' 
        THEN 'tax'
        WHEN LOWER(COALESCE(coa.account_subtype::TEXT, '')) IN ('tips', 'tips_payable', 'tips payable')
          OR (LOWER(COALESCE(coa.account_subtype::TEXT, '')) IN ('', 'liability', 'other_current_liability', 'other')
              AND LOWER(COALESCE(coa.account_name, '')) ~ '(^|[^a-z])(tip|tips|gratuity)([^a-z]|$)')
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
      AND NOT EXISTS (
        SELECT 1 FROM unified_sales child
        WHERE child.parent_sale_id = us.id
      )
    GROUP BY TO_CHAR(us.sale_date, 'YYYY-MM'),
      CASE 
        WHEN LOWER(COALESCE(coa.account_subtype::TEXT, '')) LIKE '%tax%' 
          OR LOWER(COALESCE(coa.account_name, '')) LIKE '%tax%' 
        THEN 'tax'
        WHEN LOWER(COALESCE(coa.account_subtype::TEXT, '')) IN ('tips', 'tips_payable', 'tips payable')
          OR (LOWER(COALESCE(coa.account_subtype::TEXT, '')) IN ('', 'liability', 'other_current_liability', 'other')
              AND LOWER(COALESCE(coa.account_name, '')) ~ '(^|[^a-z])(tip|tips|gratuity)([^a-z]|$)')
        THEN 'tip'
        ELSE 'other_liability'
      END
  ),
  all_periods AS (
    SELECT DISTINCT month_period FROM monthly_revenue
    UNION
    SELECT DISTINCT month_period FROM monthly_adjustments
    UNION
    SELECT DISTINCT month_period FROM monthly_categorized_liabilities
  )
  SELECT 
    p.month_period as period,
    COALESCE(r.amount, 0) as gross_revenue,
    COALESCE((SELECT SUM(a.amount) FROM monthly_adjustments a WHERE a.month_period = p.month_period AND a.adjustment_type = 'tax'), 0) +
    COALESCE((SELECT SUM(l.amount) FROM monthly_categorized_liabilities l WHERE l.month_period = p.month_period AND l.liability_type = 'tax'), 0) as sales_tax,
    COALESCE((SELECT SUM(a.amount) FROM monthly_adjustments a WHERE a.month_period = p.month_period AND a.adjustment_type = 'tip'), 0) +
    COALESCE((SELECT SUM(l.amount) FROM monthly_categorized_liabilities l WHERE l.month_period = p.month_period AND l.liability_type = 'tip'), 0) as tips,
    COALESCE((SELECT SUM(a.amount) FROM monthly_adjustments a WHERE a.month_period = p.month_period AND a.adjustment_type IN ('service_charge', 'fee')), 0) +
    COALESCE((SELECT SUM(l.amount) FROM monthly_categorized_liabilities l WHERE l.month_period = p.month_period AND l.liability_type = 'other_liability'), 0) as other_liabilities,
    COALESCE((SELECT SUM(ABS(a.amount)) FROM monthly_adjustments a WHERE a.month_period = p.month_period AND a.adjustment_type = 'discount'), 0) as discounts
  FROM all_periods p
  LEFT JOIN monthly_revenue r ON r.month_period = p.month_period
  ORDER BY p.month_period DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_monthly_sales_metrics(UUID, DATE, DATE) TO authenticated;
