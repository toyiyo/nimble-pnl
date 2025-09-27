-- Fix critical security issues

-- 1. Restrict unit_conversions table access (currently publicly readable)
DROP POLICY IF EXISTS "Anyone can view unit conversions" ON public.unit_conversions;

CREATE POLICY "Authenticated users can view unit conversions" 
ON public.unit_conversions 
FOR SELECT 
TO authenticated
USING (true);

-- 2. Update all database functions to have proper search_path for security
-- This prevents potential SQL injection via search_path manipulation

CREATE OR REPLACE FUNCTION public.sync_square_to_unified_sales(p_restaurant_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  synced_count INTEGER := 0;
BEGIN
  INSERT INTO public.unified_sales (
    restaurant_id,
    pos_system,
    external_order_id,
    external_item_id,
    item_name,
    quantity,
    unit_price,
    total_price,
    sale_date,
    pos_category,
    raw_data
  )
  SELECT 
    so.restaurant_id,
    'square' as pos_system,
    so.order_id as external_order_id,
    soli.catalog_object_id as external_item_id,
    COALESCE(soli.name, 'Unknown Item') as item_name,
    COALESCE(soli.quantity, 1) as quantity,
    soli.base_price_money as unit_price,
    soli.total_money as total_price,
    so.service_date as sale_date,
    soli.category_id as pos_category,
    jsonb_build_object(
      'square_order', so.raw_json,
      'square_line_item', soli.raw_json
    ) as raw_data
  FROM square_orders so
  JOIN square_order_line_items soli ON so.order_id = soli.order_id AND so.restaurant_id = soli.restaurant_id
  WHERE so.restaurant_id = p_restaurant_id
    AND so.state = 'COMPLETED'
    AND so.service_date IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM unified_sales us 
      WHERE us.external_order_id = so.order_id 
      AND us.external_item_id = soli.catalog_object_id
      AND us.pos_system = 'square'
      AND us.restaurant_id = p_restaurant_id
    );
  
  GET DIAGNOSTICS synced_count = ROW_COUNT;
  RETURN synced_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.simulate_inventory_deduction(p_restaurant_id uuid, p_pos_item_name text, p_quantity_sold integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_recipe_record RECORD;
  v_ingredient_record RECORD;
  v_deduction_amount NUMERIC;
  v_result jsonb := '{"recipe_name": "", "ingredients_deducted": [], "total_cost": 0}';
  v_ingredients jsonb := '[]';
  v_total_cost NUMERIC := 0;
BEGIN
  -- Find matching recipe by POS item name
  SELECT * INTO v_recipe_record
  FROM recipes 
  WHERE restaurant_id = p_restaurant_id 
    AND (pos_item_name = p_pos_item_name OR name = p_pos_item_name)
    AND is_active = true
  LIMIT 1;

  -- If no recipe found, return empty result
  IF v_recipe_record.id IS NULL THEN
    RETURN '{"recipe_name": "", "ingredients_deducted": [], "total_cost": 0}';
  END IF;

  -- Set recipe name in result
  v_result := jsonb_set(v_result, '{recipe_name}', to_jsonb(v_recipe_record.name));

  -- Loop through recipe ingredients and calculate what would be deducted
  FOR v_ingredient_record IN 
    SELECT ri.*, p.name as product_name, p.current_stock, p.cost_per_unit
    FROM recipe_ingredients ri
    JOIN products p ON ri.product_id = p.id
    WHERE ri.recipe_id = v_recipe_record.id
  LOOP
    -- Calculate deduction amount (recipe quantity * sales quantity)
    v_deduction_amount := v_ingredient_record.quantity * p_quantity_sold;

    -- Add to ingredients array (showing what would happen)
    v_ingredients := v_ingredients || jsonb_build_object(
      'product_name', v_ingredient_record.product_name,
      'quantity_deducted', v_deduction_amount,
      'unit', v_ingredient_record.unit::text,
      'remaining_stock', GREATEST(0, v_ingredient_record.current_stock - v_deduction_amount)
    );

    -- Add to total cost
    v_total_cost := v_total_cost + (v_deduction_amount * COALESCE(v_ingredient_record.cost_per_unit, 0));
  END LOOP;

  -- Set final result
  v_result := jsonb_set(v_result, '{ingredients_deducted}', v_ingredients);
  v_result := jsonb_set(v_result, '{total_cost}', to_jsonb(v_total_cost));

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.calculate_recipe_cost(recipe_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  total_cost NUMERIC := 0;
  ingredient_record RECORD;
  cost_per_recipe_unit NUMERIC;
BEGIN
  FOR ingredient_record IN
    SELECT ri.quantity, ri.unit, p.cost_per_unit, p.conversion_factor, p.uom_purchase, p.uom_recipe
    FROM recipe_ingredients ri
    JOIN products p ON ri.product_id = p.id
    WHERE ri.recipe_id = calculate_recipe_cost.recipe_id
  LOOP
    -- Calculate cost per recipe unit from cost per purchase unit
    cost_per_recipe_unit := COALESCE(ingredient_record.cost_per_unit, 0) / COALESCE(ingredient_record.conversion_factor, 1);
    
    -- Add to total cost: recipe_quantity * cost_per_recipe_unit
    total_cost := total_cost + (ingredient_record.quantity * cost_per_recipe_unit);
  END LOOP;
  
  RETURN total_cost;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_product_cost_per_recipe_unit(product_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  product_record RECORD;
BEGIN
  SELECT cost_per_unit, conversion_factor INTO product_record
  FROM products 
  WHERE id = product_id;
  
  IF product_record.cost_per_unit IS NULL THEN
    RETURN 0;
  END IF;
  
  -- Return cost per recipe unit = cost per purchase unit / conversion factor
  RETURN product_record.cost_per_unit / COALESCE(product_record.conversion_factor, 1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_sale_already_processed(p_restaurant_id uuid, p_pos_item_name text, p_quantity_sold integer, p_sale_date text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
    v_reference_id text;
BEGIN
    -- Create the same reference ID format used in processing
    v_reference_id := p_pos_item_name || '_' || p_sale_date;
    
    -- Check if this exact sale has already been processed
    RETURN EXISTS (
        SELECT 1 FROM inventory_transactions 
        WHERE restaurant_id = p_restaurant_id 
        AND reference_id = v_reference_id
        AND transaction_type = 'usage'
        AND reason LIKE 'POS sale: ' || p_pos_item_name || '%'
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.aggregate_unified_sales_to_daily(p_restaurant_id uuid, p_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
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
    0 as discounts,
    0 as comps,
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

CREATE OR REPLACE FUNCTION public.calculate_square_daily_pnl(p_restaurant_id uuid, p_service_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
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
    0
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
  INSERT INTO public.daily_labor_costs (restaurant_id, date, source, hourly_wages, salary_wages, benefits)
  SELECT 
    p_restaurant_id,
    p_service_date,
    'square',
    COALESCE(SUM(total_wage_money), 0),
    0,
    0
  FROM public.square_shifts
  WHERE restaurant_id = p_restaurant_id 
    AND service_date = p_service_date
  ON CONFLICT (restaurant_id, date, source)
  DO UPDATE SET
    hourly_wages = EXCLUDED.hourly_wages,
    salary_wages = EXCLUDED.salary_wages,
    benefits = EXCLUDED.benefits,
    updated_at = now();

  -- Trigger overall P&L calculation
  SELECT public.calculate_daily_pnl(p_restaurant_id, p_service_date) INTO v_pnl_id;

  RETURN v_pnl_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.calculate_daily_pnl(p_restaurant_id uuid, p_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
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