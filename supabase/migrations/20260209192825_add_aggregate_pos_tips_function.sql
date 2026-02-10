-- Aggregates categorized POS tips from unified_sales_splits by date for tip pooling.

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
  ORDER BY us.sale_date DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_pos_tips_by_date(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION get_pos_tips_by_date IS
'Aggregates categorized POS tips from unified_sales_splits by date.
Used by tip pooling system to display POS-imported tips.
Returns daily totals for tips identified by account name or subtype containing "tip".';
