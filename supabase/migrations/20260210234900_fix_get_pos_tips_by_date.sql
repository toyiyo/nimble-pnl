-- Fix get_pos_tips_by_date to include uncategorized tips from unified_sales
-- 
-- ISSUE: The function only looked at unified_sales_splits (already categorized items),
-- but POS systems like Toast sync tips directly to unified_sales with item_type='tip'
-- BEFORE they are categorized. This caused "No POS tips found" message even when tips existed.
--
-- SOLUTION: Query both:
-- 1. Categorized tips (unified_sales_splits with "tip" in account name/subtype)
-- 2. Uncategorized tips (unified_sales where item_type='tip' OR adjustment_type='tip')

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
    -- Tips that have been categorized in splits
    SELECT
      us.sale_date AS tip_date,
      SUM(uss.amount * 100)::INTEGER AS total_amount_cents,
      COUNT(DISTINCT us.external_order_id)::INTEGER AS transaction_count,
      us.pos_system AS pos_source
    FROM unified_sales us
    INNER JOIN unified_sales_splits uss ON us.id = uss.sale_id
    INNER JOIN chart_of_accounts coa ON uss.category_id = coa.id
    WHERE us.restaurant_id = p_restaurant_id
      AND us.sale_date >= p_start_date
      AND us.sale_date <= p_end_date
      AND (
        LOWER(COALESCE(coa.account_name, '')) LIKE '%tip%'
        OR LOWER(COALESCE(coa.account_subtype::TEXT, '')) LIKE '%tip%'
      )
    GROUP BY us.sale_date, us.pos_system
  ),
  uncategorized_tips AS (
    -- Tips that haven't been categorized yet (item_type='tip' or adjustment_type='tip')
    -- Exclude items that already have splits to avoid double-counting
    SELECT
      us.sale_date AS tip_date,
      SUM(COALESCE(us.total_price, us.unit_price * us.quantity, 0) * 100)::INTEGER AS total_amount_cents,
      COUNT(DISTINCT us.external_order_id)::INTEGER AS transaction_count,
      us.pos_system AS pos_source
    FROM unified_sales us
    WHERE us.restaurant_id = p_restaurant_id
      AND us.sale_date >= p_start_date
      AND us.sale_date <= p_end_date
      AND (us.item_type = 'tip' OR us.adjustment_type = 'tip')
      -- Exclude items that have already been categorized (have splits)
      AND NOT EXISTS (
        SELECT 1 FROM unified_sales_splits uss
        WHERE uss.sale_id = us.id
      )
    GROUP BY us.sale_date, us.pos_system
  ),
  combined_tips AS (
    -- Combine both sources
    SELECT tip_date, total_amount_cents, transaction_count, pos_source
    FROM categorized_tips
    UNION ALL
    SELECT tip_date, total_amount_cents, transaction_count, pos_source
    FROM uncategorized_tips
  )
  -- Aggregate by date and POS system
  SELECT
    ct.tip_date,
    SUM(ct.total_amount_cents)::INTEGER AS total_amount_cents,
    SUM(ct.transaction_count)::INTEGER AS transaction_count,
    ct.pos_source
  FROM combined_tips ct
  GROUP BY ct.tip_date, ct.pos_source
  ORDER BY ct.tip_date DESC;
END;
$$;

COMMENT ON FUNCTION get_pos_tips_by_date IS
'Aggregates POS tips from both categorized (unified_sales_splits) and uncategorized (unified_sales) sources.
Used by tip pooling system to display POS-imported tips.
Returns daily totals for:
1. Categorized tips (splits with account name/subtype containing "tip")
2. Uncategorized tips (item_type="tip" or adjustment_type="tip")';
