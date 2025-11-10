-- Update sync_square_to_unified_sales to handle adjustments (tax, tip, discount, service charges)
-- This ensures both sync and webhooks create the same adjustment entries

DROP FUNCTION IF EXISTS sync_square_to_unified_sales(UUID);

CREATE OR REPLACE FUNCTION sync_square_to_unified_sales(p_restaurant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  synced_count INTEGER := 0;
  adjustment_count INTEGER := 0;
  v_restaurant_timezone TEXT;
BEGIN
  -- Get restaurant timezone
  SELECT timezone INTO v_restaurant_timezone
  FROM restaurants
  WHERE id = p_restaurant_id;
  
  v_restaurant_timezone := COALESCE(v_restaurant_timezone, 'America/Chicago');

  -- Sync line items (revenue items - EXCLUDING TAX)
  -- Use gross_sales_money (pre-tax amount) instead of total_money (includes tax)
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
    parent_sale_id,
    adjustment_type
  )
  SELECT 
    so.restaurant_id,
    'square' as pos_system,
    so.order_id as external_order_id,
    soli.uid as external_item_id,
    COALESCE(soli.name, 'Unknown Item') as item_name,
    COALESCE(soli.quantity, 1) as quantity,
    soli.base_price_money as unit_price,
    -- Use gross_sales_money from line item (excludes tax, discounts, modifiers already applied)
    -- This is the REVENUE amount, not the total collected
    COALESCE(
      ((soli.raw_json->>'gross_sales_money')::jsonb->>'amount')::numeric / 100.0,
      soli.total_money
    ) as total_price,
    so.service_date as sale_date,
    (so.closed_at AT TIME ZONE v_restaurant_timezone)::time as sale_time,
    soli.category_id as pos_category,
    jsonb_build_object(
      'square_order', so.raw_json,
      'square_line_item', soli.raw_json
    ) as raw_data,
    NULL as parent_sale_id,
    NULL as adjustment_type  -- NULL for regular revenue items
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
  DO UPDATE SET
    total_price = EXCLUDED.total_price,
    unit_price = EXCLUDED.unit_price,
    quantity = EXCLUDED.quantity,
    sale_date = EXCLUDED.sale_date,
    sale_time = EXCLUDED.sale_time,
    raw_data = EXCLUDED.raw_data;
  
  GET DIAGNOSTICS synced_count = ROW_COUNT;

  -- Sync tax adjustments
  -- Use unique constraint on (restaurant_id, pos_system, external_order_id, external_item_id)
  INSERT INTO unified_sales (
    restaurant_id,
    pos_system,
    external_order_id,
    external_item_id,
    item_name,
    item_type,
    adjustment_type,
    quantity,
    total_price,
    sale_date,
    sale_time,
    raw_data
  )
  SELECT 
    so.restaurant_id,
    'square' as pos_system,
    so.order_id as external_order_id,
    so.order_id || '_tax' as external_item_id,  -- Unique ID for tax adjustment
    'Sales Tax' as item_name,
    'tax' as item_type,
    'tax' as adjustment_type,
    1 as quantity,
    so.total_tax_money as total_price,
    so.service_date as sale_date,
    (so.closed_at AT TIME ZONE v_restaurant_timezone)::time as sale_time,
    jsonb_build_object(
      'total_tax_money', (so.raw_json->'total_tax_money'),
      'taxes', (so.raw_json->'taxes')
    ) as raw_data
  FROM square_orders so
  WHERE so.restaurant_id = p_restaurant_id
    AND so.state = 'COMPLETED'
    AND so.service_date IS NOT NULL
    AND so.closed_at IS NOT NULL
    AND so.total_tax_money > 0
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET
    total_price = EXCLUDED.total_price,
    sale_date = EXCLUDED.sale_date,
    sale_time = EXCLUDED.sale_time,
    raw_data = EXCLUDED.raw_data;

  GET DIAGNOSTICS adjustment_count = ROW_COUNT;

  -- Sync tip adjustments
  INSERT INTO unified_sales (
    restaurant_id,
    pos_system,
    external_order_id,
    external_item_id,
    item_name,
    item_type,
    adjustment_type,
    quantity,
    total_price,
    sale_date,
    sale_time,
    raw_data
  )
  SELECT 
    so.restaurant_id,
    'square' as pos_system,
    so.order_id as external_order_id,
    so.order_id || '_tip' as external_item_id,  -- Unique ID for tip adjustment
    'Tips' as item_name,
    'tip' as item_type,
    'tip' as adjustment_type,
    1 as quantity,
    so.total_tip_money as total_price,
    so.service_date as sale_date,
    (so.closed_at AT TIME ZONE v_restaurant_timezone)::time as sale_time,
    jsonb_build_object(
      'total_tip_money', (so.raw_json->'total_tip_money')
    ) as raw_data
  FROM square_orders so
  WHERE so.restaurant_id = p_restaurant_id
    AND so.state = 'COMPLETED'
    AND so.service_date IS NOT NULL
    AND so.closed_at IS NOT NULL
    AND so.total_tip_money > 0
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET
    total_price = EXCLUDED.total_price,
    sale_date = EXCLUDED.sale_date,
    sale_time = EXCLUDED.sale_time,
    raw_data = EXCLUDED.raw_data;

  -- Sync service charge adjustments
  INSERT INTO unified_sales (
    restaurant_id,
    pos_system,
    external_order_id,
    external_item_id,
    item_name,
    item_type,
    adjustment_type,
    quantity,
    total_price,
    sale_date,
    sale_time,
    raw_data
  )
  SELECT 
    so.restaurant_id,
    'square' as pos_system,
    so.order_id as external_order_id,
    so.order_id || '_service_charge' as external_item_id,  -- Unique ID
    'Service Charge' as item_name,
    'service_charge' as item_type,
    'service_charge' as adjustment_type,
    1 as quantity,
    so.total_service_charge_money as total_price,
    so.service_date as sale_date,
    (so.closed_at AT TIME ZONE v_restaurant_timezone)::time as sale_time,
    jsonb_build_object(
      'total_service_charge_money', (so.raw_json->'total_service_charge_money')
    ) as raw_data
  FROM square_orders so
  WHERE so.restaurant_id = p_restaurant_id
    AND so.state = 'COMPLETED'
    AND so.service_date IS NOT NULL
    AND so.closed_at IS NOT NULL
    AND so.total_service_charge_money > 0
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET
    total_price = EXCLUDED.total_price,
    sale_date = EXCLUDED.sale_date,
    sale_time = EXCLUDED.sale_time,
    raw_data = EXCLUDED.raw_data;

  -- Sync discount adjustments (negative amount)
  INSERT INTO unified_sales (
    restaurant_id,
    pos_system,
    external_order_id,
    external_item_id,
    item_name,
    item_type,
    adjustment_type,
    quantity,
    total_price,
    sale_date,
    sale_time,
    raw_data
  )
  SELECT 
    so.restaurant_id,
    'square' as pos_system,
    so.order_id as external_order_id,
    so.order_id || '_discount' as external_item_id,  -- Unique ID
    'Discount' as item_name,
    'discount' as item_type,
    'discount' as adjustment_type,
    1 as quantity,
    -so.total_discount_money as total_price,  -- negative for discounts
    so.service_date as sale_date,
    (so.closed_at AT TIME ZONE v_restaurant_timezone)::time as sale_time,
    jsonb_build_object(
      'total_discount_money', (so.raw_json->'total_discount_money')
    ) as raw_data
  FROM square_orders so
  WHERE so.restaurant_id = p_restaurant_id
    AND so.state = 'COMPLETED'
    AND so.service_date IS NOT NULL
    AND so.closed_at IS NOT NULL
    AND so.total_discount_money > 0
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET
    total_price = EXCLUDED.total_price,
    sale_date = EXCLUDED.sale_date,
    sale_time = EXCLUDED.sale_time,
    raw_data = EXCLUDED.raw_data;

  RETURN synced_count + adjustment_count;
END;
$$;

COMMENT ON FUNCTION sync_square_to_unified_sales IS 
'Syncs Square orders to unified_sales table, including both line items (revenue only, excludes tax) and adjustments (tax, tip, service charges, discounts). Uses gross_sales_money to exclude tax from line item totals. Adjustments are marked with adjustment_type for proper filtering in revenue calculations.';
