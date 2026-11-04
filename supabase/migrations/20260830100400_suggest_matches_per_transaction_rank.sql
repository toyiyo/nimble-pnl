-- Rank match suggestions per bank transaction.
--
-- The old body ordered the whole restaurant cross-product by score and cut
-- it at 100 rows. BankTransactionList now calls the function with
-- p_pending_outflow_id = NULL for the whole restaurant. A restaurant with
-- more than 100 qualifying pairs lost every suggestion below the global
-- cut, even for transactions on screen (PR #782 review, P2).
--
-- The new body keeps the top 3 outflows per bank transaction, then applies
-- a 1000-row backstop. The per-outflow path (p_pending_outflow_id set) has
-- one candidate outflow, so each transaction holds one row, every row ranks
-- first, and the old result is unchanged.
--
-- The score arithmetic is identical to the prior version
-- (20251107202635_d3d7b103-e55c-48ba-824b-548edb1ae703.sql).

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
DECLARE
  v_user_id UUID;
BEGIN
  -- Get current user ID
  v_user_id := auth.uid();

  -- Authorization check: verify user has access to this restaurant
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_restaurants
    WHERE user_id = v_user_id
      AND restaurant_id = p_restaurant_id
  ) THEN
    RAISE EXCEPTION 'Access denied: User does not have permission to access this restaurant';
  END IF;

  RETURN QUERY
  WITH scored AS (
    SELECT
      po.id AS s_pending_outflow_id,
      bt.id AS s_bank_transaction_id,
      -- Calculate match score (0-100)
      (CASE
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
      END)::INTEGER AS s_match_score,
      -- Amount difference (note: positive means pending outflow > bank transaction)
      po.amount + bt.amount AS s_amount_delta,
      EXTRACT(EPOCH FROM (bt.transaction_date - po.issue_date))::INTEGER / 86400 AS s_date_delta,
      CASE
        WHEN bt.merchant_name IS NOT NULL THEN
          COALESCE(bt.merchant_name, bt.description)
        ELSE bt.description
      END AS s_payee_similarity
    FROM public.pending_outflows po
    CROSS JOIN public.bank_transactions bt
    WHERE po.restaurant_id = p_restaurant_id
      AND bt.restaurant_id = p_restaurant_id
      AND po.status IN ('pending', 'stale_30', 'stale_60', 'stale_90')
      AND po.linked_bank_transaction_id IS NULL
      AND bt.is_categorized = false
      AND bt.amount < 0  -- Only negative (outgoing) transactions
      -- Amount tolerance: within $10
      AND ABS(po.amount + bt.amount) < 10.00
      -- Date tolerance: within 30 days
      AND ABS(EXTRACT(EPOCH FROM (bt.transaction_date - po.issue_date)) / 86400) <= 30
      -- Optional filter by specific pending outflow
      AND (p_pending_outflow_id IS NULL OR po.id = p_pending_outflow_id)
  ),
  ranked AS (
    SELECT
      s.*,
      ROW_NUMBER() OVER (
        PARTITION BY s.s_bank_transaction_id
        ORDER BY s.s_match_score DESC, ABS(s.s_amount_delta) ASC
      ) AS txn_rank
    FROM scored s
  )
  SELECT
    r.s_pending_outflow_id,
    r.s_bank_transaction_id,
    r.s_match_score,
    r.s_amount_delta,
    r.s_date_delta,
    r.s_payee_similarity
  FROM ranked r
  WHERE r.txn_rank <= 3
  ORDER BY r.s_match_score DESC, ABS(r.s_amount_delta) ASC
  -- Backstop only. The rank filter bounds the output at 3 rows per
  -- uncategorized transaction, so this cap covers at least 333
  -- transactions instead of the old 100 global rows.
  LIMIT 1000;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION suggest_pending_outflow_matches(UUID, UUID) IS
  'Fuzzy match suggestions between open pending outflows and uncategorized outgoing bank transactions. Keeps the top 3 outflows per transaction with a 1000-row backstop.';
