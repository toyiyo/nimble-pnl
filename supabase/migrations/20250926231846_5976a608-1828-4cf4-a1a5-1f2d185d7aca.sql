-- Fix the aggregate function to handle null values correctly
CREATE OR REPLACE FUNCTION public.aggregate_unified_sales_to_daily(p_restaurant_id uuid, p_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only proceed if restaurant_id is not null
  IF p_restaurant_id IS NULL THEN
    RETURN;
  END IF;

  -- Insert or update daily_sales from unified_sales
  INSERT INTO public.daily_sales (
    restaurant_id,
    date,
    source,
    gross_revenue,
    discounts,
    comps,
    transaction_count
  )
  SELECT 
    p_restaurant_id,
    p_date,
    'unified_pos' as source,
    COALESCE(SUM(total_price), 0) as gross_revenue,
    0 as discounts, -- Can be enhanced later with discount data from POS
    0 as comps,     -- Can be enhanced later with comp data from POS
    COUNT(DISTINCT external_order_id) as transaction_count
  FROM unified_sales
  WHERE restaurant_id = p_restaurant_id 
    AND sale_date = p_date
  ON CONFLICT (restaurant_id, date, source)
  DO UPDATE SET
    gross_revenue = EXCLUDED.gross_revenue,
    discounts = EXCLUDED.discounts,
    comps = EXCLUDED.comps,
    transaction_count = EXCLUDED.transaction_count,
    updated_at = now();

  -- Also calculate P&L for this date
  PERFORM public.calculate_daily_pnl(p_restaurant_id, p_date);
END;
$function$;