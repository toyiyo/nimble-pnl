-- Add source field to daily tables and update constraints
-- This enables multiple POS systems per restaurant

-- Add source column to daily_sales
ALTER TABLE public.daily_sales 
ADD COLUMN source text NOT NULL DEFAULT 'manual';

-- Add source column to daily_food_costs  
ALTER TABLE public.daily_food_costs
ADD COLUMN source text NOT NULL DEFAULT 'manual';

-- Add source column to daily_labor_costs
ALTER TABLE public.daily_labor_costs  
ADD COLUMN source text NOT NULL DEFAULT 'manual';

-- Drop existing unique constraints
ALTER TABLE public.daily_sales DROP CONSTRAINT IF EXISTS daily_sales_restaurant_id_date_key;
ALTER TABLE public.daily_food_costs DROP CONSTRAINT IF EXISTS daily_food_costs_restaurant_id_date_key;  
ALTER TABLE public.daily_labor_costs DROP CONSTRAINT IF EXISTS daily_labor_costs_restaurant_id_date_key;

-- Add new unique constraints with source
ALTER TABLE public.daily_sales 
ADD CONSTRAINT daily_sales_restaurant_id_date_source_key 
UNIQUE (restaurant_id, date, source);

ALTER TABLE public.daily_food_costs
ADD CONSTRAINT daily_food_costs_restaurant_id_date_source_key  
UNIQUE (restaurant_id, date, source);

ALTER TABLE public.daily_labor_costs
ADD CONSTRAINT daily_labor_costs_restaurant_id_date_source_key
UNIQUE (restaurant_id, date, source);

-- Update calculate_daily_pnl function to aggregate across sources
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
  -- Get aggregated net revenue across all sources
  SELECT COALESCE(SUM(gross_revenue - discounts - comps), 0) INTO v_net_revenue
  FROM public.daily_sales
  WHERE restaurant_id = p_restaurant_id AND date = p_date;
  
  v_net_revenue := COALESCE(v_net_revenue, 0);

  -- Get aggregated food cost across all sources  
  SELECT COALESCE(SUM(purchases + inventory_adjustments), 0) INTO v_food_cost
  FROM public.daily_food_costs
  WHERE restaurant_id = p_restaurant_id AND date = p_date;
  
  v_food_cost := COALESCE(v_food_cost, 0);

  -- Get aggregated labor cost across all sources
  SELECT COALESCE(SUM(hourly_wages + salary_wages + benefits), 0) INTO v_labor_cost
  FROM public.daily_labor_costs
  WHERE restaurant_id = p_restaurant_id AND date = p_date;
  
  v_labor_cost := COALESCE(v_labor_cost, 0);

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

-- Update calculate_square_daily_pnl function to use 'square' source
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

  -- Update daily_labor_costs table with Square data
  INSERT INTO public.daily_labor_costs (restaurant_id, date, source, hourly_wages, salary_wages, benefits, total_labor_cost)
  SELECT 
    p_restaurant_id,
    p_service_date,
    'square',
    COALESCE(SUM(total_wage_money), 0),
    0, -- salary wages separate if available
    0, -- benefits separate if available  
    COALESCE(SUM(total_wage_money), 0)
  FROM public.square_shifts
  WHERE restaurant_id = p_restaurant_id 
    AND service_date = p_service_date
  ON CONFLICT (restaurant_id, date, source)
  DO UPDATE SET
    hourly_wages = EXCLUDED.hourly_wages,
    total_labor_cost = EXCLUDED.total_labor_cost,
    updated_at = now();

  -- Trigger overall P&L calculation (aggregates across all sources)
  SELECT public.calculate_daily_pnl(p_restaurant_id, p_service_date) INTO v_pnl_id;

  RETURN v_pnl_id;
END;
$function$;