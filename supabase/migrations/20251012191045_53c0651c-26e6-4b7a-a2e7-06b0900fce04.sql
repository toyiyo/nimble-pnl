-- Step 1: Clear existing Square data from unified_sales (they have wrong external_item_id)
DELETE FROM public.unified_sales WHERE pos_system = 'square';

-- Step 2: Update sync function to use line item UID instead of catalog_object_id
CREATE OR REPLACE FUNCTION public.sync_square_to_unified_sales(p_restaurant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  synced_count INTEGER := 0;
  v_restaurant_timezone TEXT;
BEGIN
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
    soli.uid as external_item_id,  -- CHANGED: Use line item UID instead of catalog_object_id
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
    ) as raw_data
  FROM square_orders so
  JOIN square_order_line_items soli ON so.order_id = soli.order_id AND so.restaurant_id = soli.restaurant_id
  WHERE so.restaurant_id = p_restaurant_id
    AND so.state = 'COMPLETED'
    AND so.service_date IS NOT NULL
    AND so.closed_at IS NOT NULL
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id) 
  DO NOTHING;
  
  GET DIAGNOSTICS synced_count = ROW_COUNT;
  RETURN synced_count;
END;
$function$;

-- Step 3: Add unique constraint to prevent future duplicates
ALTER TABLE public.unified_sales
ADD CONSTRAINT unified_sales_unique_square 
UNIQUE (restaurant_id, pos_system, external_order_id, external_item_id);