-- Migration: add a refunds column to get_monthly_sales_metrics
--
-- Net sales = gross_revenue - discounts - refunds (spec §5.1 Change B).
-- The return type changes, so DROP then CREATE. Keep every security property
-- from migration 20260814120000: SECURITY INVOKER, the membership guard, the
-- child restaurant_id filters, and the grants.

DROP FUNCTION IF EXISTS public.get_monthly_sales_metrics(UUID, DATE, DATE);

CREATE FUNCTION public.get_monthly_sales_metrics(
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
  discounts DECIMAL,
  refunds DECIMAL
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Authorization check: the caller must be a member of the restaurant.
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = p_restaurant_id
    AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: User does not have access to restaurant %', p_restaurant_id;
  END IF;

  RETURN QUERY
  WITH monthly_revenue AS (
    SELECT
      TO_CHAR(us.sale_date, 'YYYY-MM') as month_period,
      COALESCE(SUM(us.total_price), 0)::DECIMAL as amount
    FROM unified_sales us
    LEFT JOIN chart_of_accounts coa ON us.category_id = coa.id
    WHERE us.restaurant_id = p_restaurant_id
      AND us.sale_date >= p_date_from
      AND us.sale_date <= p_date_to
      AND us.adjustment_type IS NULL
      AND LOWER(COALESCE(us.item_type, 'sale')) = 'sale'
      -- Liability-categorized sales are accounted for in
      -- monthly_categorized_liabilities; counting them here too caused
      -- gross_revenue (and therefore total_collected_at_pos) to double-count.
      -- account_type_enum is (asset, liability, equity, revenue, expense);
      -- only liability is excluded here. asset/equity/expense are not
      -- expected on unified_sales rows but pass through if they ever appear.
      AND (coa.account_type IS NULL OR coa.account_type = 'revenue')
      AND NOT EXISTS (
        SELECT 1 FROM unified_sales child
        WHERE child.parent_sale_id = us.id
          AND child.restaurant_id = p_restaurant_id
      )
    GROUP BY TO_CHAR(us.sale_date, 'YYYY-MM')
  ),
  monthly_refunds AS (
    SELECT TO_CHAR(us.sale_date, 'YYYY-MM') as month_period,
      COALESCE(SUM(ABS(us.total_price)), 0)::DECIMAL as amount
    FROM unified_sales us
    LEFT JOIN chart_of_accounts coa ON us.category_id = coa.id
    WHERE us.restaurant_id = p_restaurant_id
      AND us.sale_date >= p_date_from AND us.sale_date <= p_date_to
      AND us.adjustment_type IS NULL
      AND LOWER(COALESCE(us.item_type, '')) = 'refund'
      -- Mirror monthly_revenue's liability exclusion: a refund categorized
      -- against a liability account (e.g. a tax adjustment) is accounted
      -- for elsewhere and must not also land in refunds.
      AND (coa.account_type IS NULL OR coa.account_type = 'revenue')
      AND NOT EXISTS (
        SELECT 1 FROM unified_sales child
        WHERE child.parent_sale_id = us.id
          AND child.restaurant_id = p_restaurant_id
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
      AND NOT EXISTS (
        SELECT 1 FROM unified_sales child
        WHERE child.parent_sale_id = us.id
          AND child.restaurant_id = p_restaurant_id
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
    SELECT DISTINCT month_period FROM monthly_revenue
    UNION SELECT DISTINCT month_period FROM monthly_adjustments
    UNION SELECT DISTINCT month_period FROM monthly_categorized_liabilities
    UNION SELECT DISTINCT month_period FROM monthly_refunds
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
    COALESCE((SELECT SUM(ABS(a.amount)) FROM monthly_adjustments a WHERE a.month_period = p.month_period AND a.adjustment_type = 'discount'), 0) as discounts,
    COALESCE(rf.amount, 0) as refunds
  FROM all_periods p
  LEFT JOIN monthly_revenue r ON r.month_period = p.month_period
  LEFT JOIN monthly_refunds rf ON rf.month_period = p.month_period
  ORDER BY p.month_period DESC;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_monthly_sales_metrics(UUID, DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_monthly_sales_metrics(UUID, DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_monthly_sales_metrics(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_monthly_sales_metrics IS
'Monthly sales metrics from unified_sales: gross_revenue, sales_tax, tips,
other_liabilities, discounts, refunds. Net sales = gross_revenue - discounts -
refunds. Runs as SECURITY INVOKER with a user_restaurants membership guard.
EXECUTE is granted to authenticated only.';
