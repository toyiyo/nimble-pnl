-- Bank transaction aggregates for one restaurant and date range (cluster 6).
-- SECURITY INVOKER: RLS on bank_transactions scopes the caller (spec §8).
DROP FUNCTION IF EXISTS public.get_bank_transaction_summary(UUID, DATE, DATE, UUID, TEXT[], NUMERIC);

CREATE FUNCTION public.get_bank_transaction_summary(
  p_restaurant_id UUID, p_start_date DATE, p_end_date DATE,
  p_bank_account_id UUID DEFAULT NULL, p_statuses TEXT[] DEFAULT NULL,
  p_min_inflow NUMERIC DEFAULT NULL
)
RETURNS TABLE(inflow NUMERIC, outflow NUMERIC, net NUMERIC, tx_count BIGINT,
              inflow_count BIGINT, outflow_count BIGINT, avg_inflow NUMERIC, max_inflow NUMERIC,
              floored_inflow NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(SUM(bt.amount) FILTER (WHERE bt.amount > 0), 0)::NUMERIC,
         ABS(COALESCE(SUM(bt.amount) FILTER (WHERE bt.amount < 0), 0))::NUMERIC,
         COALESCE(SUM(bt.amount), 0)::NUMERIC,
         COUNT(*)::BIGINT,
         COUNT(*) FILTER (WHERE bt.amount > 0 AND (p_min_inflow IS NULL OR bt.amount > p_min_inflow))::BIGINT,
         COUNT(*) FILTER (WHERE bt.amount < 0)::BIGINT,
         COALESCE(AVG(bt.amount) FILTER (WHERE bt.amount > 0 AND (p_min_inflow IS NULL OR bt.amount > p_min_inflow)), 0)::NUMERIC,
         COALESCE(MAX(bt.amount) FILTER (WHERE bt.amount > 0 AND (p_min_inflow IS NULL OR bt.amount > p_min_inflow)), 0)::NUMERIC,
         COALESCE(SUM(bt.amount) FILTER (WHERE bt.amount > 0 AND (p_min_inflow IS NULL OR bt.amount > p_min_inflow)), 0)::NUMERIC
  FROM bank_transactions bt
  WHERE bt.restaurant_id = p_restaurant_id
    AND bt.transaction_date >= p_start_date AND bt.transaction_date <= p_end_date
    AND (p_bank_account_id IS NULL OR bt.connected_bank_id = p_bank_account_id)
    AND (p_statuses IS NULL OR bt.status::text = ANY(p_statuses));
$$;

CREATE OR REPLACE FUNCTION public.get_bank_spending_by_category(
  p_restaurant_id UUID, p_start_date DATE, p_end_date DATE, p_statuses TEXT[] DEFAULT NULL
)
RETURNS TABLE(category_id UUID, category_name TEXT, spend NUMERIC, tx_count BIGINT)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT bt.category_id,
         COALESCE(coa.account_name, 'Uncategorized'),
         ABS(COALESCE(SUM(bt.amount), 0))::NUMERIC,
         COUNT(*)::BIGINT
  FROM bank_transactions bt
  LEFT JOIN chart_of_accounts coa ON coa.id = bt.category_id AND coa.restaurant_id = p_restaurant_id
  WHERE bt.restaurant_id = p_restaurant_id
    AND bt.transaction_date >= p_start_date AND bt.transaction_date <= p_end_date
    AND bt.amount < 0
    AND (p_statuses IS NULL OR bt.status::text = ANY(p_statuses))
  GROUP BY bt.category_id, coa.account_name
  ORDER BY 3 DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_bank_transactions_daily(
  p_restaurant_id UUID, p_start_date DATE, p_end_date DATE, p_bank_account_id UUID DEFAULT NULL
)
RETURNS TABLE(day DATE, inflow NUMERIC, outflow NUMERIC, net NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT bt.transaction_date,
         COALESCE(SUM(bt.amount) FILTER (WHERE bt.amount > 0), 0)::NUMERIC,
         ABS(COALESCE(SUM(bt.amount) FILTER (WHERE bt.amount < 0), 0))::NUMERIC,
         COALESCE(SUM(bt.amount), 0)::NUMERIC
  FROM bank_transactions bt
  WHERE bt.restaurant_id = p_restaurant_id
    AND bt.transaction_date >= p_start_date AND bt.transaction_date <= p_end_date
    AND (p_bank_account_id IS NULL OR bt.connected_bank_id = p_bank_account_id)
  GROUP BY bt.transaction_date
  ORDER BY bt.transaction_date;
$$;

REVOKE EXECUTE ON FUNCTION public.get_bank_transaction_summary(UUID, DATE, DATE, UUID, TEXT[], NUMERIC) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_bank_transaction_summary(UUID, DATE, DATE, UUID, TEXT[], NUMERIC) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_bank_transaction_summary(UUID, DATE, DATE, UUID, TEXT[], NUMERIC) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_bank_spending_by_category(UUID, DATE, DATE, TEXT[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_bank_spending_by_category(UUID, DATE, DATE, TEXT[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_bank_spending_by_category(UUID, DATE, DATE, TEXT[]) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_bank_transactions_daily(UUID, DATE, DATE, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_bank_transactions_daily(UUID, DATE, DATE, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_bank_transactions_daily(UUID, DATE, DATE, UUID) TO authenticated;

COMMENT ON FUNCTION public.get_bank_transaction_summary IS
'Inflow/outflow/net summary over bank_transactions, optionally scoped to one
connected_bank_id and one set of statuses. p_min_inflow applies a strictly-
greater-than floor to the deposit metrics only (inflow_count, avg_inflow,
max_inflow, floored_inflow); inflow, outflow, net, tx_count, and
outflow_count stay unfloored. floored_inflow is the sum of only the deposits
that pass the p_min_inflow floor (equal to inflow when p_min_inflow is NULL);
callers that want a floored revenue total should read floored_inflow instead
of inflow. SECURITY INVOKER; EXECUTE for authenticated only.';

COMMENT ON FUNCTION public.get_bank_spending_by_category IS
'Spend by category from negative-amount bank_transactions rows. SECURITY
INVOKER; EXECUTE for authenticated only.';

COMMENT ON FUNCTION public.get_bank_transactions_daily IS
'Daily inflow/outflow/net series from bank_transactions, optionally scoped
to one connected_bank_id. SECURITY INVOKER; EXECUTE for authenticated only.';
