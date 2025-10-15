-- Create function to sync Clover data to unified_sales table
CREATE OR REPLACE FUNCTION public.sync_clover_to_unified_sales(p_restaurant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  synced_count INTEGER := 0;
  v_restaurant_timezone TEXT;
BEGIN
  -- Get restaurant timezone
  SELECT timezone INTO v_restaurant_timezone
  FROM restaurants
  WHERE id = p_restaurant_id;
  
  v_restaurant_timezone := COALESCE(v_restaurant_timezone, 'America/Chicago');

  -- Insert Clover line items into unified_sales
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
    sale_time,
    pos_category,
    raw_data
  )
  SELECT 
    co.restaurant_id,
    'clover' as pos_system,
    co.order_id as external_order_id,
    cli.line_item_id as external_item_id,
    COALESCE(cli.name, 'Unknown Item') as item_name,
    COALESCE(cli.unit_quantity, 1) as quantity,
    cli.price as unit_price,
    cli.price * COALESCE(cli.unit_quantity, 1) as total_price,
    co.service_date as sale_date,
    (co.closed_time AT TIME ZONE v_restaurant_timezone)::time as sale_time,
    cli.category_id as pos_category,
    jsonb_build_object(
      'clover_order', co.raw_json,
      'clover_line_item', cli.raw_json
    ) as raw_data
  FROM clover_orders co
  JOIN clover_order_line_items cli 
    ON co.order_id = cli.order_id 
    AND co.restaurant_id = cli.restaurant_id
  WHERE co.restaurant_id = p_restaurant_id
    AND co.state = 'locked'
    AND co.service_date IS NOT NULL
    AND co.closed_time IS NOT NULL
    AND cli.is_revenue = true
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id) 
  DO NOTHING;
  
  GET DIAGNOSTICS synced_count = ROW_COUNT;
  RETURN synced_count;
END;
$function$;