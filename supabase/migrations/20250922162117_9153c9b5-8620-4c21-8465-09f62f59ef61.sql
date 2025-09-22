-- Fix the calculate_square_daily_pnl function to not insert into total_labor_cost
-- since it appears to be a computed column
CREATE OR REPLACE FUNCTION public.calculate_square_daily_pnl(p_restaurant_id uuid, p_service_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_labor_cost DECIMAL(10,2) := 0;
  v_pnl_id UUID;
BEGIN
  -- Calculate labor cost from Square shifts
  SELECT COALESCE(SUM(total_wage_money), 0) INTO v_labor_cost
  FROM public.square_shifts
  WHERE restaurant_id = p_restaurant_id 
    AND service_date = p_service_date;

  -- Update daily_sales table with Square data
  INSERT INTO public.daily_sales (restaurant_id, date, source, gross_revenue, discounts, comps)
  SELECT 
    p_restaurant_id,
    p_service_date,
    'square',
    COALESCE(SUM(gross_sales_money), 0),
    COALESCE(SUM(total_discount_money), 0),
    0 -- comps from Square orders if needed
  FROM public.square_orders
  WHERE restaurant_id = p_restaurant_id 
    AND service_date = p_service_date
    AND state = 'COMPLETED'
  ON CONFLICT (restaurant_id, date, source)
  DO UPDATE SET
    gross_revenue = EXCLUDED.gross_revenue,
    discounts = EXCLUDED.discounts,
    comps = EXCLUDED.comps,
    updated_at = now();

  -- Update daily_labor_costs table with Square data (excluding total_labor_cost)
  INSERT INTO public.daily_labor_costs (restaurant_id, date, source, hourly_wages, salary_wages, benefits)
  SELECT 
    p_restaurant_id,
    p_service_date,
    'square',
    COALESCE(SUM(total_wage_money), 0),
    0, -- salary wages separate if available
    0  -- benefits separate if available  
  FROM public.square_shifts
  WHERE restaurant_id = p_restaurant_id 
    AND service_date = p_service_date
  ON CONFLICT (restaurant_id, date, source)
  DO UPDATE SET
    hourly_wages = EXCLUDED.hourly_wages,
    salary_wages = EXCLUDED.salary_wages,
    benefits = EXCLUDED.benefits,
    updated_at = now();

  -- Trigger overall P&L calculation (aggregates across all sources)
  SELECT public.calculate_daily_pnl(p_restaurant_id, p_service_date) INTO v_pnl_id;

  RETURN v_pnl_id;
END;
$function$;