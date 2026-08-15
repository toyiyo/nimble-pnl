-- Expense-health aggregate for one restaurant and date range (cluster 6
-- special aggregate: six sums in one call).
-- SECURITY INVOKER: RLS on bank_transactions and chart_of_accounts scopes
-- the caller (spec §8).
CREATE OR REPLACE FUNCTION public.get_expense_health_metrics(
  p_restaurant_id UUID, p_start_date DATE, p_end_date DATE,
  p_fee_patterns TEXT[], p_bank_account_id UUID DEFAULT NULL
)
RETURNS TABLE(revenue NUMERIC, food_cost NUMERIC, labor_cost NUMERIC,
              processing_fees NUMERIC, total_outflows NUMERIC, uncategorized_spend NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT
    COALESCE(SUM(bt.amount) FILTER (WHERE bt.amount > 0), 0)::NUMERIC,
    ABS(COALESCE(SUM(bt.amount) FILTER (WHERE bt.amount < 0
      AND (coa.account_subtype::text = 'cost_of_goods_sold'
           OR LOWER(COALESCE(coa.account_name, '')) LIKE '%food%'
           OR LOWER(COALESCE(coa.account_name, '')) LIKE '%inventory%')), 0))::NUMERIC,
    ABS(COALESCE(SUM(bt.amount) FILTER (WHERE bt.amount < 0
      AND (coa.account_subtype::text = 'payroll'
           OR LOWER(COALESCE(coa.account_name, '')) LIKE '%payroll%'
           OR LOWER(COALESCE(coa.account_name, '')) LIKE '%labor%')), 0))::NUMERIC,
    ABS(COALESCE(SUM(bt.amount) FILTER (WHERE bt.amount < 0
      AND LOWER(COALESCE(bt.description, '') || ' ' || COALESCE(bt.merchant_name, ''))
          LIKE ANY(
            SELECT LOWER(pat)
            FROM UNNEST(COALESCE(p_fee_patterns, ARRAY[]::TEXT[])) AS pat
          )), 0))::NUMERIC,
    ABS(COALESCE(SUM(bt.amount) FILTER (WHERE bt.amount < 0), 0))::NUMERIC,
    ABS(COALESCE(SUM(bt.amount) FILTER (WHERE bt.amount < 0
      AND bt.category_id IS NULL AND COALESCE(bt.is_split, false) = false), 0))::NUMERIC
  FROM bank_transactions bt
  LEFT JOIN chart_of_accounts coa ON coa.id = bt.category_id AND coa.restaurant_id = p_restaurant_id
  WHERE bt.restaurant_id = p_restaurant_id
    AND bt.transaction_date >= p_start_date AND bt.transaction_date <= p_end_date
    AND bt.status::text IN ('posted', 'pending')
    AND (p_bank_account_id IS NULL OR bt.connected_bank_id = p_bank_account_id);
$$;

REVOKE EXECUTE ON FUNCTION public.get_expense_health_metrics(UUID, DATE, DATE, TEXT[], UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_expense_health_metrics(UUID, DATE, DATE, TEXT[], UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_expense_health_metrics(UUID, DATE, DATE, TEXT[], UUID) TO authenticated;

COMMENT ON FUNCTION public.get_expense_health_metrics IS
'Revenue, food cost, labor cost, processing fees, total outflows, and
uncategorized spend over bank_transactions for one restaurant and date
range, optionally scoped to one connected_bank_id. p_fee_patterns takes
lowercase LIKE patterns (e.g. ''%stripe%'') matched against the lowercased
description and merchant_name. SECURITY INVOKER; EXECUTE for authenticated
only.';
