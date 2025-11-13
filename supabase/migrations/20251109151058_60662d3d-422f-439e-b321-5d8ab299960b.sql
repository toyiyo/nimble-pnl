-- Improve aggregate_unified_sales_to_daily with better money math and performance
CREATE OR REPLACE FUNCTION public.aggregate_unified_sales_to_daily(p_restaurant_id uuid, p_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_temp, public
AS $function$
DECLARE
  v_gross numeric;
  v_txn_count bigint;
BEGIN
  -- Guard against NULL parameters
  IF p_restaurant_id IS NULL OR p_date IS NULL THEN
    RETURN;
  END IF;

  -- Aggregate once, round once (better for money math)
  SELECT
    ROUND(
      COALESCE(SUM(COALESCE(us.total_price, us.unit_price * us.quantity, 0)), 0)
    , 2) AS gross,
    COUNT(DISTINCT us.external_order_id) AS txn
  INTO v_gross, v_txn_count
  FROM public.unified_sales us
  WHERE us.restaurant_id = p_restaurant_id
    AND us.sale_date::date = p_date
    AND us.adjustment_type IS NULL;  -- Exclude pass-throughs

  -- Upsert daily sales
  INSERT INTO public.daily_sales (
    restaurant_id, date, source, gross_revenue, discounts, comps, transaction_count
  )
  VALUES (
    p_restaurant_id, p_date, 'unified_pos', v_gross, 0::numeric, 0::numeric, v_txn_count
  )
  ON CONFLICT (restaurant_id, date, source)
  DO UPDATE SET
    gross_revenue = EXCLUDED.gross_revenue,
    discounts = EXCLUDED.discounts,
    comps = EXCLUDED.comps,
    transaction_count = EXCLUDED.transaction_count,
    updated_at = now();

  -- Trigger P&L recalculation
  PERFORM public.calculate_daily_pnl(p_restaurant_id, p_date);
END;
$function$;

-- Create index for better query performance (without CONCURRENTLY to avoid transaction block error)
CREATE INDEX IF NOT EXISTS idx_unified_sales_restaurant_date
  ON public.unified_sales (restaurant_id, (sale_date::date));