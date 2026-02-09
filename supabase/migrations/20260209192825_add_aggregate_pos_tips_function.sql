-- Migration: Add function to aggregate POS tips for tip pooling
-- 
-- Purpose: Bridge the gap between categorized POS sales (unified_sales_splits) 
-- and the tip pooling system (employee_tips table)
--
-- This function aggregates tips from unified_sales_splits where the category
-- is identified as tips (by account_name containing 'tip' or account_subtype)
-- and groups them by date.

-- Function to aggregate categorized POS tips by date
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
  -- Authorization check: Verify the caller has access to this restaurant
  -- RLS policies on unified_sales will enforce this, but we add an explicit check
  -- to fail fast if the user doesn't have access to the restaurant
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = p_restaurant_id
    AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: User does not have access to restaurant %', p_restaurant_id;
  END IF;

  RETURN QUERY
  SELECT 
    us.sale_date AS tip_date,
    SUM(uss.amount * 100)::INTEGER AS total_amount_cents, -- Convert to cents
    COUNT(DISTINCT us.external_order_id)::INTEGER AS transaction_count,
    us.pos_system AS pos_source
  FROM unified_sales us
  INNER JOIN unified_sales_splits uss ON us.id = uss.sale_id
  INNER JOIN chart_of_accounts coa ON uss.category_id = coa.id
  WHERE us.restaurant_id = p_restaurant_id
    AND us.sale_date >= p_start_date
    AND us.sale_date <= p_end_date
    AND (
      -- Match by account name containing 'tip'
      LOWER(COALESCE(coa.account_name, '')) LIKE '%tip%'
      -- Or by account subtype if a tip subtype exists
      OR LOWER(COALESCE(coa.account_subtype::TEXT, '')) LIKE '%tip%'
    )
  GROUP BY us.sale_date, us.pos_system
  ORDER BY us.sale_date DESC;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_pos_tips_by_date(UUID, DATE, DATE) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION get_pos_tips_by_date IS 
'Aggregates categorized POS tips from unified_sales_splits by date. 
Used by tip pooling system to display POS-imported tips.
Returns daily totals for tips identified by account name or subtype containing "tip".';
