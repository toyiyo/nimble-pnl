-- Fix search_path security warnings for pending_outflows functions

-- Update the trigger function to set search_path
CREATE OR REPLACE FUNCTION update_pending_outflows_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path TO 'public';

-- Update the stale marking function to set search_path
CREATE OR REPLACE FUNCTION mark_stale_pending_outflows()
RETURNS void AS $$
BEGIN
  -- Mark as stale_30 (30-59 days old)
  UPDATE public.pending_outflows
  SET status = 'stale_30'
  WHERE status = 'pending'
    AND issue_date <= CURRENT_DATE - INTERVAL '30 days'
    AND issue_date > CURRENT_DATE - INTERVAL '60 days';
  
  -- Mark as stale_60 (60-89 days old)
  UPDATE public.pending_outflows
  SET status = 'stale_60'
  WHERE status IN ('pending', 'stale_30')
    AND issue_date <= CURRENT_DATE - INTERVAL '60 days'
    AND issue_date > CURRENT_DATE - INTERVAL '90 days';
  
  -- Mark as stale_90 (90+ days old)
  UPDATE public.pending_outflows
  SET status = 'stale_90'
  WHERE status IN ('pending', 'stale_30', 'stale_60')
    AND issue_date <= CURRENT_DATE - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql
SET search_path TO 'public';

-- Update the matching function to set search_path (already has SECURITY DEFINER)
CREATE OR REPLACE FUNCTION suggest_pending_outflow_matches(
  p_restaurant_id UUID,
  p_pending_outflow_id UUID DEFAULT NULL
)
RETURNS TABLE (
  pending_outflow_id UUID,
  bank_transaction_id UUID,
  match_score INTEGER,
  amount_delta NUMERIC,
  date_delta INTEGER,
  payee_similarity TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    po.id AS pending_outflow_id,
    bt.id AS bank_transaction_id,
    -- Calculate match score (0-100)
    CASE
      -- Exact amount match
      WHEN ABS(po.amount + bt.amount) < 0.01 THEN 60
      -- Within $1
      WHEN ABS(po.amount + bt.amount) < 1.00 THEN 45
      -- Within $5
      WHEN ABS(po.amount + bt.amount) < 5.00 THEN 20
      ELSE 0
    END +
    CASE
      -- Same day
      WHEN bt.transaction_date = po.issue_date THEN 20
      -- Within 3 days
      WHEN ABS(EXTRACT(EPOCH FROM (bt.transaction_date - po.issue_date)) / 86400) <= 3 THEN 15
      -- Within 7 days
      WHEN ABS(EXTRACT(EPOCH FROM (bt.transaction_date - po.issue_date)) / 86400) <= 7 THEN 10
      -- Within 10 days
      WHEN ABS(EXTRACT(EPOCH FROM (bt.transaction_date - po.issue_date)) / 86400) <= 10 THEN 5
      ELSE 0
    END +
    CASE
      -- Payee name similarity (basic contains check)
      WHEN bt.merchant_name IS NOT NULL AND 
           LOWER(bt.merchant_name) LIKE '%' || LOWER(SUBSTRING(po.vendor_name, 1, 5)) || '%' THEN 20
      WHEN bt.description IS NOT NULL AND 
           LOWER(bt.description) LIKE '%' || LOWER(SUBSTRING(po.vendor_name, 1, 5)) || '%' THEN 10
      ELSE 0
    END AS match_score,
    -- Additional info for review
    po.amount + bt.amount AS amount_delta,
    EXTRACT(EPOCH FROM (bt.transaction_date - po.issue_date))::INTEGER / 86400 AS date_delta,
    CASE
      WHEN bt.merchant_name IS NOT NULL THEN 
        COALESCE(bt.merchant_name, bt.description)
      ELSE bt.description
    END AS payee_similarity
  FROM public.pending_outflows po
  CROSS JOIN public.bank_transactions bt
  WHERE po.restaurant_id = p_restaurant_id
    AND bt.restaurant_id = p_restaurant_id
    AND po.status = 'pending'
    AND po.linked_bank_transaction_id IS NULL
    AND bt.is_categorized = false
    AND bt.amount < 0  -- Only negative (outgoing) transactions
    -- Amount tolerance: within $10
    AND ABS(po.amount + bt.amount) < 10.00
    -- Date tolerance: within 30 days
    AND ABS(EXTRACT(EPOCH FROM (bt.transaction_date - po.issue_date)) / 86400) <= 30
    -- Optional filter by specific pending outflow
    AND (p_pending_outflow_id IS NULL OR po.id = p_pending_outflow_id)
  ORDER BY match_score DESC, ABS(po.amount + bt.amount) ASC
  LIMIT 100;
END;
$$ LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path TO 'public';