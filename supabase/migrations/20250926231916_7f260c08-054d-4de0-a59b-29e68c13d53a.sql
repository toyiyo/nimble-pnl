-- Fix the trigger function to check for null values
CREATE OR REPLACE FUNCTION public.trigger_unified_sales_aggregation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only aggregate if restaurant_id is not null
  IF NEW.restaurant_id IS NOT NULL AND NEW.sale_date IS NOT NULL THEN
    PERFORM public.aggregate_unified_sales_to_daily(NEW.restaurant_id, NEW.sale_date::date);
  END IF;
  RETURN NEW;
END;
$function$;

-- Now clean up incorrectly priced unified_sales data and re-sync with correct prices
DELETE FROM unified_sales WHERE pos_system = 'square';

-- Re-sync all Square data with corrected pricing
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
    -- Fixed: square_order_line_items already stores prices in dollars, not cents
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
WHERE so.state = 'COMPLETED'
    AND so.service_date IS NOT NULL;