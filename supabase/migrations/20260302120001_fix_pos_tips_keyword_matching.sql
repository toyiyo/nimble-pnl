-- Migration: tighten tip matching in get_pos_tips_by_date to avoid false positives
-- Same fix as get_monthly_sales_metrics: use word-boundary regex on account_name
-- and exact match on account_subtype

CREATE OR REPLACE FUNCTION get_pos_tips_by_date(
  p_restaurant_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  tip_date DATE,
  total_amount_cents INTEGER,
  transaction_count INTEGER,
  pos_source TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  -- Authorization check
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = p_restaurant_id
    AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: User does not have access to restaurant %', p_restaurant_id;
  END IF;

  RETURN QUERY
  WITH categorized_tips AS (
    SELECT
      us.sale_date AS t_date,
      SUM(uss.amount * 100)::INTEGER AS t_cents,
      COUNT(DISTINCT us.external_order_id)::INTEGER AS t_count,
      us.pos_system AS t_source
    FROM unified_sales us
    INNER JOIN unified_sales_splits uss ON us.id = uss.sale_id
    INNER JOIN chart_of_accounts coa ON uss.category_id = coa.id
    WHERE us.restaurant_id = p_restaurant_id
      AND us.sale_date >= p_start_date
      AND us.sale_date <= p_end_date
      AND coa.account_type = 'liability'
      AND (
        LOWER(COALESCE(coa.account_subtype::TEXT, '')) IN ('tips', 'tips_payable', 'tips payable')
        OR (LOWER(COALESCE(coa.account_subtype::TEXT, '')) IN ('', 'liability', 'other_current_liability', 'other_current_liabilities', 'other_liabilities', 'payroll_liabilities', 'other')
            AND LOWER(COALESCE(coa.account_name, '')) ~ '(^|[^a-z])(tip|tips|gratuity)([^a-z]|$)')
      )
    GROUP BY us.sale_date, us.pos_system
  ),
  uncategorized_tips AS (
    SELECT
      us.sale_date AS t_date,
      SUM(COALESCE(us.total_price, us.unit_price * us.quantity, 0) * 100)::INTEGER AS t_cents,
      COUNT(DISTINCT us.external_order_id)::INTEGER AS t_count,
      us.pos_system AS t_source
    FROM unified_sales us
    WHERE us.restaurant_id = p_restaurant_id
      AND us.sale_date >= p_start_date
      AND us.sale_date <= p_end_date
      AND (us.item_type = 'tip' OR us.adjustment_type = 'tip')
      AND NOT EXISTS (
        SELECT 1 FROM unified_sales_splits uss
        INNER JOIN chart_of_accounts coa ON uss.category_id = coa.id
        WHERE uss.sale_id = us.id
        AND coa.account_type = 'liability'
        AND (
          LOWER(COALESCE(coa.account_subtype::TEXT, '')) IN ('tips', 'tips_payable', 'tips payable')
          OR (LOWER(COALESCE(coa.account_subtype::TEXT, '')) IN ('', 'liability', 'other_current_liability', 'other_current_liabilities', 'other_liabilities', 'payroll_liabilities', 'other')
              AND LOWER(COALESCE(coa.account_name, '')) ~ '(^|[^a-z])(tip|tips|gratuity)([^a-z]|$)')
        )
      )
    GROUP BY us.sale_date, us.pos_system
  ),
  combined_tips AS (
    SELECT t_date, t_cents, t_count, t_source FROM categorized_tips
    UNION ALL
    SELECT t_date, t_cents, t_count, t_source FROM uncategorized_tips
  )
  SELECT
    ct.t_date,
    SUM(ct.t_cents)::INTEGER,
    SUM(ct.t_count)::INTEGER,
    ct.t_source
  FROM combined_tips ct
  GROUP BY ct.t_date, ct.t_source
  ORDER BY ct.t_date DESC;
END;
$$;

COMMENT ON FUNCTION get_pos_tips_by_date IS
'Aggregates POS tips from both categorized (unified_sales_splits) and uncategorized (unified_sales) sources.
Uses word-boundary regex on account_name and exact match on account_subtype to avoid false positives.
Used by tip pooling system to display POS-imported tips.';
