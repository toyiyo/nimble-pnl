-- Fix the calculate_square_daily_pnl function to not insert into generated net_revenue column
CREATE OR REPLACE FUNCTION public.calculate_square_daily_pnl(p_restaurant_id uuid, p_service_date date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_labor_cost DECIMAL(10,2) := 0;
  v_pnl_id UUID;
BEGIN
  -- Calculate labor cost from Square shifts
  SELECT COALESCE(SUM(total_wage_money), 0) INTO v_labor_cost
  FROM public.square_shifts
  WHERE restaurant_id = p_restaurant_id 
    AND service_date = p_service_date;

  -- Update daily_sales table (don't insert net_revenue as it's computed)
  INSERT INTO public.daily_sales (restaurant_id, date, gross_revenue, discounts, comps)
  SELECT 
    p_restaurant_id,
    p_service_date,
    COALESCE(SUM(gross_sales_money), 0),
    COALESCE(SUM(total_discount_money), 0),
    0 -- comps from Square orders if needed
  FROM public.square_orders
  WHERE restaurant_id = p_restaurant_id 
    AND service_date = p_service_date
    AND state = 'COMPLETED'
  ON CONFLICT (restaurant_id, date)
  DO UPDATE SET
    gross_revenue = EXCLUDED.gross_revenue,
    discounts = EXCLUDED.discounts,
    comps = EXCLUDED.comps,
    updated_at = now();

  -- Update daily_labor_costs table
  INSERT INTO public.daily_labor_costs (restaurant_id, date, hourly_wages, salary_wages, benefits, total_labor_cost)
  SELECT 
    p_restaurant_id,
    p_service_date,
    COALESCE(SUM(total_wage_money), 0),
    0, -- salary wages separate if available
    0, -- benefits separate if available  
    COALESCE(SUM(total_wage_money), 0)
  FROM public.square_shifts
  WHERE restaurant_id = p_restaurant_id 
    AND service_date = p_service_date
  ON CONFLICT (restaurant_id, date)
  DO UPDATE SET
    hourly_wages = EXCLUDED.hourly_wages,
    total_labor_cost = EXCLUDED.total_labor_cost,
    updated_at = now();

  -- Trigger overall P&L calculation
  SELECT public.calculate_daily_pnl(p_restaurant_id, p_service_date) INTO v_pnl_id;

  RETURN v_pnl_id;
END;
$$;