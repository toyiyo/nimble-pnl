-- Fix sync functions to match partial unique index for split sales support

-- Drop and recreate sync_clover_to_unified_sales
DROP FUNCTION IF EXISTS sync_clover_to_unified_sales(UUID);

CREATE OR REPLACE FUNCTION sync_clover_to_unified_sales(p_restaurant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  synced_count INTEGER := 0;
  v_restaurant_timezone TEXT;
BEGIN
  -- Get restaurant timezone
  SELECT timezone INTO v_restaurant_timezone
  FROM restaurants
  WHERE id = p_restaurant_id;
  
  v_restaurant_timezone := COALESCE(v_restaurant_timezone, 'America/Chicago');

  -- Insert with ON CONFLICT matching the partial unique index
  INSERT INTO unified_sales (
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
    raw_data,
    parent_sale_id
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
    ) as raw_data,
    NULL as parent_sale_id
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
    WHERE parent_sale_id IS NULL
  DO NOTHING;
  
  GET DIAGNOSTICS synced_count = ROW_COUNT;
  RETURN synced_count;
END;
$$;

-- Drop and recreate sync_square_to_unified_sales
DROP FUNCTION IF EXISTS sync_square_to_unified_sales(UUID);

CREATE OR REPLACE FUNCTION sync_square_to_unified_sales(p_restaurant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  synced_count INTEGER := 0;
  v_restaurant_timezone TEXT;
BEGIN
  -- Get restaurant timezone
  SELECT timezone INTO v_restaurant_timezone
  FROM restaurants
  WHERE id = p_restaurant_id;
  
  v_restaurant_timezone := COALESCE(v_restaurant_timezone, 'America/Chicago');

  -- Insert with ON CONFLICT matching the partial unique index
  INSERT INTO unified_sales (
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
    raw_data,
    parent_sale_id
  )
  SELECT 
    so.restaurant_id,
    'square' as pos_system,
    so.order_id as external_order_id,
    soli.uid as external_item_id,
    COALESCE(soli.name, 'Unknown Item') as item_name,
    COALESCE(soli.quantity, 1) as quantity,
    soli.base_price_money as unit_price,
    soli.total_money as total_price,
    so.service_date as sale_date,
    (so.closed_at AT TIME ZONE v_restaurant_timezone)::time as sale_time,
    soli.category_id as pos_category,
    jsonb_build_object(
      'square_order', so.raw_json,
      'square_line_item', soli.raw_json
    ) as raw_data,
    NULL as parent_sale_id
  FROM square_orders so
  JOIN square_order_line_items soli 
    ON so.order_id = soli.order_id 
    AND so.restaurant_id = soli.restaurant_id
  WHERE so.restaurant_id = p_restaurant_id
    AND so.state = 'COMPLETED'
    AND so.service_date IS NOT NULL
    AND so.closed_at IS NOT NULL
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id) 
    WHERE parent_sale_id IS NULL
  DO NOTHING;
  
  GET DIAGNOSTICS synced_count = ROW_COUNT;
  RETURN synced_count;
END;
$$;