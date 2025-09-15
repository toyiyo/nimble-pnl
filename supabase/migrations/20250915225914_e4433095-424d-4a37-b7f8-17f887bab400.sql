-- Fix the calculate_daily_pnl function to handle missing cost data properly
CREATE OR REPLACE FUNCTION public.calculate_daily_pnl(p_restaurant_id uuid, p_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_net_revenue DECIMAL(10,2) := 0;
  v_food_cost DECIMAL(10,2) := 0;
  v_labor_cost DECIMAL(10,2) := 0;
  v_pnl_id UUID;
BEGIN
  -- Get net revenue for the date (calculated from sales data)
  SELECT COALESCE(gross_revenue - discounts - comps, 0) INTO v_net_revenue
  FROM public.daily_sales
  WHERE restaurant_id = p_restaurant_id AND date = p_date;

  -- Get food cost for the date (calculated from food costs data)
  SELECT COALESCE(purchases + inventory_adjustments, 0) INTO v_food_cost
  FROM public.daily_food_costs
  WHERE restaurant_id = p_restaurant_id AND date = p_date;

  -- Get labor cost for the date (calculated from labor costs data)
  SELECT COALESCE(hourly_wages + salary_wages + benefits, 0) INTO v_labor_cost
  FROM public.daily_labor_costs
  WHERE restaurant_id = p_restaurant_id AND date = p_date;

  -- Insert or update daily P&L with calculated values
  INSERT INTO public.daily_pnl (restaurant_id, date, net_revenue, food_cost, labor_cost)
  VALUES (p_restaurant_id, p_date, v_net_revenue, v_food_cost, v_labor_cost)
  ON CONFLICT (restaurant_id, date)
  DO UPDATE SET
    net_revenue = EXCLUDED.net_revenue,
    food_cost = EXCLUDED.food_cost,
    labor_cost = EXCLUDED.labor_cost,
    updated_at = now()
  RETURNING id INTO v_pnl_id;

  RETURN v_pnl_id;
END;
$function$;