-- =====================================================
-- Update sync_toast_to_unified_sales to create separate entries
-- for revenue, discounts, tax, tips, and refunds
-- =====================================================

CREATE OR REPLACE FUNCTION sync_toast_to_unified_sales(p_restaurant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_synced_count INTEGER := 0;
BEGIN
  -- 1. Insert/Update REVENUE entries (from order items)
  -- Use ON CONFLICT to preserve categorization instead of deleting
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
    type,
    raw_data,
    synced_at,
    source
  )
  SELECT
    toi.restaurant_id,
    'toast'::TEXT,
    toi.toast_order_guid,
    toi.toast_item_guid,
    toi.item_name,
    toi.quantity,
    toi.unit_price,
    toi.total_price,
    too.order_date,
    too.order_time,
    toi.menu_category,
    'revenue'::TEXT,
    toi.raw_json,
    NOW(),
    'toast_api'
  FROM public.toast_order_items toi
  INNER JOIN public.toast_orders too ON toi.toast_order_guid = too.toast_order_guid
    AND toi.restaurant_id = too.restaurant_id
  WHERE toi.restaurant_id = p_restaurant_id
    AND toi.total_price IS NOT NULL
    AND toi.total_price != 0
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET
    item_name = EXCLUDED.item_name,
    quantity = EXCLUDED.quantity,
    unit_price = EXCLUDED.unit_price,
    total_price = EXCLUDED.total_price,
    sale_date = EXCLUDED.sale_date,
    sale_time = EXCLUDED.sale_time,
    pos_category = EXCLUDED.pos_category,
    raw_data = EXCLUDED.raw_data,
    synced_at = EXCLUDED.synced_at;

  GET DIAGNOSTICS v_synced_count = ROW_COUNT;

  -- 2. Insert/Update DISCOUNT entries (from order discounts)
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
    type,
    raw_data,
    synced_at,
    source
  )
  SELECT
    too.restaurant_id,
    'toast'::TEXT,
    too.toast_order_guid,
    too.toast_order_guid || '_discount',
    'Order Discount',
    1,
    -ABS(too.discount_amount), -- Negative amount for discount
    -ABS(too.discount_amount),
    too.order_date,
    too.order_time,
    'discount'::TEXT,
    too.raw_json,
    NOW(),
    'toast_api'
  FROM public.toast_orders too
  WHERE too.restaurant_id = p_restaurant_id
    AND too.discount_amount IS NOT NULL
    AND too.discount_amount != 0
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET
    item_name = EXCLUDED.item_name,
    total_price = EXCLUDED.total_price,
    unit_price = EXCLUDED.unit_price,
    sale_date = EXCLUDED.sale_date,
    sale_time = EXCLUDED.sale_time,
    raw_data = EXCLUDED.raw_data,
    synced_at = EXCLUDED.synced_at;

  -- 3. Insert/Update TAX entries
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
    type,
    raw_data,
    synced_at,
    source
  )
  SELECT
    too.restaurant_id,
    'toast'::TEXT,
    too.toast_order_guid,
    too.toast_order_guid || '_tax',
    'Sales Tax',
    1,
    too.tax_amount,
    too.tax_amount,
    too.order_date,
    too.order_time,
    'tax'::TEXT,
    too.raw_json,
    NOW(),
    'toast_api'
  FROM public.toast_orders too
  WHERE too.restaurant_id = p_restaurant_id
    AND too.tax_amount IS NOT NULL
    AND too.tax_amount != 0
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET
    item_name = EXCLUDED.item_name,
    total_price = EXCLUDED.total_price,
    unit_price = EXCLUDED.unit_price,
    sale_date = EXCLUDED.sale_date,
    sale_time = EXCLUDED.sale_time,
    raw_data = EXCLUDED.raw_data,
    synced_at = EXCLUDED.synced_at;

  -- 4. Insert/Update TIP entries (from payments)
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
    type,
    raw_data,
    synced_at,
    source
  )
  SELECT
    tp.restaurant_id,
    'toast'::TEXT,
    tp.toast_order_guid,
    tp.toast_payment_guid || '_tip',
    'Tip - ' || COALESCE(tp.payment_type, 'Unknown'),
    1,
    tp.tip_amount,
    tp.tip_amount,
    tp.payment_date,
    NULL, -- payment_time not tracked
    'tip'::TEXT,
    tp.raw_json,
    NOW(),
    'toast_api'
  FROM public.toast_payments tp
  WHERE tp.restaurant_id = p_restaurant_id
    AND tp.tip_amount IS NOT NULL
    AND tp.tip_amount != 0
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET
    item_name = EXCLUDED.item_name,
    total_price = EXCLUDED.total_price,
    unit_price = EXCLUDED.unit_price,
    sale_date = EXCLUDED.sale_date,
    sale_time = EXCLUDED.sale_time,
    raw_data = EXCLUDED.raw_data,
    synced_at = EXCLUDED.synced_at;

  -- 5. Insert/Update REFUND entries (from payments with negative amounts or refund status)
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
    type,
    raw_data,
    synced_at,
    source
  )
  SELECT
    tp.restaurant_id,
    'toast'::TEXT,
    tp.toast_order_guid,
    tp.toast_payment_guid || '_refund',
    'Refund - ' || COALESCE(tp.payment_type, 'Unknown'),
    1,
    -ABS(tp.amount), -- Negative amount for refund
    -ABS(tp.amount),
    tp.payment_date,
    NULL,
    'refund'::TEXT,
    tp.raw_json,
    NOW(),
    'toast_api'
  FROM public.toast_payments tp
  WHERE tp.restaurant_id = p_restaurant_id
    AND (
      tp.payment_status = 'REFUNDED'
      OR tp.amount < 0
    )
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET
    item_name = EXCLUDED.item_name,
    total_price = EXCLUDED.total_price,
    unit_price = EXCLUDED.unit_price,
    sale_date = EXCLUDED.sale_date,
    sale_time = EXCLUDED.sale_time,
    raw_data = EXCLUDED.raw_data,
    synced_at = EXCLUDED.synced_at;

  RETURN v_synced_count;
END;
$$;

-- Grant execution to authenticated users
GRANT EXECUTE ON FUNCTION sync_toast_to_unified_sales TO authenticated;

COMMENT ON FUNCTION sync_toast_to_unified_sales IS 
'Syncs Toast orders to unified_sales with separate entries for revenue, discounts, tax, tips, and refunds. Uses ON CONFLICT to preserve existing categorization when updating records.';
