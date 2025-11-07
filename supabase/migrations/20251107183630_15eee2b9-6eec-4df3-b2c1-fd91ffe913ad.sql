-- Update suggest_pending_outflow_matches to include stale statuses
CREATE OR REPLACE FUNCTION public.suggest_pending_outflow_matches(
  p_restaurant_id uuid,
  p_pending_outflow_id uuid DEFAULT NULL
)
RETURNS TABLE (
  pending_outflow_id uuid,
  bank_transaction_id uuid,
  match_score integer,
  amount_delta numeric,
  date_delta integer,
  payee_similarity text
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    po.id AS pending_outflow_id,
    bt.id AS bank_transaction_id,
    (
      -- Amount match (0-50 points)
      CASE 
        WHEN ABS(bt.amount + po.amount) < 0.01 THEN 50
        WHEN ABS(bt.amount + po.amount) <= 5.00 THEN 40
        WHEN ABS(bt.amount + po.amount) <= 10.00 THEN 30
        ELSE 0
      END +
      -- Date proximity (0-30 points)
      CASE 
        WHEN ABS(EXTRACT(DAY FROM (bt.transaction_date::date - po.issue_date))) = 0 THEN 30
        WHEN ABS(EXTRACT(DAY FROM (bt.transaction_date::date - po.issue_date))) <= 3 THEN 25
        WHEN ABS(EXTRACT(DAY FROM (bt.transaction_date::date - po.issue_date))) <= 7 THEN 20
        WHEN ABS(EXTRACT(DAY FROM (bt.transaction_date::date - po.issue_date))) <= 14 THEN 15
        ELSE 0
      END +
      -- Payee similarity (0-20 points)
      CASE 
        WHEN LOWER(bt.merchant_name) LIKE '%' || LOWER(po.vendor_name) || '%' 
          OR LOWER(po.vendor_name) LIKE '%' || LOWER(bt.merchant_name) || '%' THEN 20
        WHEN similarity(LOWER(bt.merchant_name), LOWER(po.vendor_name)) > 0.3 THEN 10
        ELSE 0
      END
    ) AS match_score,
    ABS(bt.amount + po.amount) AS amount_delta,
    ABS(EXTRACT(DAY FROM (bt.transaction_date::date - po.issue_date)))::integer AS date_delta,
    CASE 
      WHEN LOWER(bt.merchant_name) LIKE '%' || LOWER(po.vendor_name) || '%' 
        OR LOWER(po.vendor_name) LIKE '%' || LOWER(bt.merchant_name) || '%' THEN 'high'
      WHEN similarity(LOWER(bt.merchant_name), LOWER(po.vendor_name)) > 0.3 THEN 'medium'
      ELSE 'low'
    END AS payee_similarity
  FROM pending_outflows po
  CROSS JOIN bank_transactions bt
  WHERE po.restaurant_id = p_restaurant_id
    AND bt.restaurant_id = p_restaurant_id
    AND po.linked_bank_transaction_id IS NULL
    AND po.status IN ('pending', 'stale_30', 'stale_60', 'stale_90')
    AND bt.is_categorized = false
    AND bt.amount < 0  -- Only match negative (outgoing) transactions
    AND (p_pending_outflow_id IS NULL OR po.id = p_pending_outflow_id)
    -- Amount must be within reasonable tolerance
    AND ABS(bt.amount + po.amount) <= GREATEST(po.amount * 0.05, 10.00)
    -- Date must be within reasonable window (30 days before or after)
    AND ABS(EXTRACT(DAY FROM (bt.transaction_date::date - po.issue_date))) <= 30
  ORDER BY match_score DESC, amount_delta ASC, date_delta ASC
  LIMIT 50;
END;
$$;