-- get_cash_flow_metrics: one-round-trip cash flow aggregate for the
-- Financial Pulse hero and section. Fixes three client-side bugs (design
-- docs/superpowers/specs/2026-08-20-cashflow-metrics-rpc-design.md §1):
-- transfer rows counted as cash flow, the final day of the window dropped
-- by an exclusive end bound, and a 1,000-row client fetch cap.
--
-- Transfer exclusion has two parts, the same two parts as isInternalTransfer
-- in src/lib/cashflowInsights.ts: the is_transfer flag, and a category
-- heuristic. The heuristic excludes a row when its category is non-P&L
-- (asset, liability, equity) AND is a cash subtype or has "transfer" in the
-- name. categorize_bank_transaction assigns transfer categories without the
-- flag, so the flag alone undercounts. A row with no category counts. A row
-- with a non-P&L category outside cash/transfer (a loan payment, an owner
-- contribution) counts: it is real external cash. Keep this predicate
-- identical to isInternalTransfer.
--
-- Gate: user_has_capability(p_restaurant_id, 'view:transactions'), the same
-- function the bank_transactions RLS policy uses
-- (supabase/migrations/20260120100100_update_rls_for_collaborators.sql).
-- A bare user_restaurants membership gate (the get_labor_sales_analytics
-- model) would let roles RLS blocks (chef, staff, kiosk,
-- collaborator_inventory, collaborator_chef) read cash flow totals.

CREATE OR REPLACE FUNCTION public.get_cash_flow_metrics(
  p_restaurant_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_bank_account_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_comparison_start DATE := p_start_date - (p_end_date - p_start_date + 1);
  v_result JSONB;
BEGIN
  -- Access check: the caller needs view:transactions, the same capability
  -- the bank_transactions RLS policy requires. SECURITY DEFINER bypasses
  -- RLS, so this gate is the tenant isolation boundary.
  IF NOT public.user_has_capability(p_restaurant_id, 'view:transactions') THEN
    RAISE EXCEPTION 'Access denied to restaurant';
  END IF;

  WITH period_rows AS (
    SELECT bt.amount, (bt.transaction_date AT TIME ZONE 'UTC')::date AS day_key
    FROM public.bank_transactions bt
    WHERE bt.restaurant_id = p_restaurant_id
      AND bt.status = 'posted'
      AND bt.is_transfer = false
      AND NOT EXISTS (
        SELECT 1 FROM public.chart_of_accounts coa
        WHERE coa.id = bt.category_id
          AND coa.account_type IN ('asset', 'liability', 'equity')
          AND (coa.account_subtype = 'cash' OR coa.account_name ~* 'transfer')
      )
      AND (p_bank_account_id IS NULL OR bt.connected_bank_id = p_bank_account_id)
      AND bt.transaction_date >= p_start_date::timestamp AT TIME ZONE 'UTC'
      AND bt.transaction_date < (p_end_date + 1)::timestamp AT TIME ZONE 'UTC'
  ),
  comparison_rows AS (
    SELECT bt.amount
    FROM public.bank_transactions bt
    WHERE bt.restaurant_id = p_restaurant_id
      AND bt.status = 'posted'
      AND bt.is_transfer = false
      AND NOT EXISTS (
        SELECT 1 FROM public.chart_of_accounts coa
        WHERE coa.id = bt.category_id
          AND coa.account_type IN ('asset', 'liability', 'equity')
          AND (coa.account_subtype = 'cash' OR coa.account_name ~* 'transfer')
      )
      AND (p_bank_account_id IS NULL OR bt.connected_bank_id = p_bank_account_id)
      AND bt.transaction_date >= v_comparison_start::timestamp AT TIME ZONE 'UTC'
      AND bt.transaction_date < p_start_date::timestamp AT TIME ZONE 'UTC'
  )
  SELECT jsonb_build_object(
    'daily', (
      SELECT COALESCE(jsonb_agg(d ORDER BY d.day), '[]'::jsonb)
      FROM (
        SELECT
          day_key AS day,
          ROUND(COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0), 2) AS inflow,
          ROUND(COALESCE(SUM(-amount) FILTER (WHERE amount < 0), 0), 2) AS outflow
        FROM period_rows
        GROUP BY day_key
      ) d
    ),
    'comparison', (
      SELECT jsonb_build_object(
        'inflow', ROUND(COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0), 2),
        'outflow', ROUND(COALESCE(SUM(-amount) FILTER (WHERE amount < 0), 0), 2)
      )
      FROM comparison_rows
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_cash_flow_metrics(UUID, DATE, DATE, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.get_cash_flow_metrics(UUID, DATE, DATE, UUID) FROM PUBLIC, anon;
