-- Fix the timezone conversion in sync_square_to_unified_sales
-- closed_at is already timestamptz, so we just need to convert directly to restaurant timezone
CREATE OR REPLACE FUNCTION public.sync_square_to_unified_sales(p_restaurant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    so.restaurant_id,
    'square' as pos_system,
    so.order_id as external_order_id,
    soli.catalog_object_id as external_item_id,
    COALESCE(soli.name, 'Unknown Item') as item_name,
    COALESCE(soli.quantity, 1) as quantity,
    soli.base_price_money as unit_price,
    soli.total_money as total_price,
    so.service_date as sale_date,
    -- Extract time from closed_at by converting timestamptz to restaurant's local time
    (so.closed_at AT TIME ZONE v_restaurant_timezone)::time as sale_time,
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
    AND so.closed_at IS NOT NULL
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