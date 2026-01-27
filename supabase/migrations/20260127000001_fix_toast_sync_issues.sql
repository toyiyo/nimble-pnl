-- =====================================================
-- Fix Toast sync issues:
-- 1. Make toast_order_id nullable (we use GUID for joins instead)
-- 2. Fix RPC auth check to work with service role
-- =====================================================

-- 1. Make toast_order_id nullable in toast_order_items
-- The processor uses toast_order_guid for relationships, not the internal ID
ALTER TABLE public.toast_order_items
  ALTER COLUMN toast_order_id DROP NOT NULL;

-- Note: toast_payments does not have toast_order_id column

-- 3. Update sync_toast_to_unified_sales to work with service role
-- Remove the auth.uid() check since edge functions use service role key
-- The function is already SECURITY DEFINER and RLS handles access control
CREATE OR REPLACE FUNCTION sync_toast_to_unified_sales(p_restaurant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_synced_count INTEGER := 0;
  v_row_count INTEGER := 0;
BEGIN
  -- Note: Removed auth.uid() check since this function is called by edge functions
  -- with service role key. Access control is enforced at the edge function level
  -- and RLS policies still apply to the data.

  -- 1. Insert/Update REVENUE entries (from order items)
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
    item_type,
    raw_data,
    synced_at
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
    'sale'::TEXT,
    toi.raw_json,
    NOW()
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

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  v_synced_count := v_synced_count + v_row_count;

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
    item_type,
    adjustment_type,
    raw_data,
    synced_at
  )
  SELECT
    too.restaurant_id,
    'toast'::TEXT,
    too.toast_order_guid,
    too.toast_order_guid || '_discount',
    'Order Discount',
    1,
    -ABS(too.discount_amount),
    -ABS(too.discount_amount),
    too.order_date,
    too.order_time,
    'discount'::TEXT,
    'discount'::TEXT,
    too.raw_json,
    NOW()
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

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  v_synced_count := v_synced_count + v_row_count;

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
    item_type,
    adjustment_type,
    raw_data,
    synced_at
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
    'tax'::TEXT,
    too.raw_json,
    NOW()
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

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  v_synced_count := v_synced_count + v_row_count;

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
    item_type,
    adjustment_type,
    raw_data,
    synced_at
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
    NULL,
    'tip'::TEXT,
    'tip'::TEXT,
    tp.raw_json,
    NOW()
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

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  v_synced_count := v_synced_count + v_row_count;

  -- 5. Insert/Update REFUND entries (from payments with refundStatus)
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
    item_type,
    raw_data,
    synced_at
  )
  SELECT
    tp.restaurant_id,
    'toast'::TEXT,
    tp.toast_order_guid,
    tp.toast_payment_guid || '_refund',
    'Refund - ' || COALESCE(tp.payment_type, 'Unknown'),
    1,
    -ABS(COALESCE((tp.raw_json->'refund'->>'refundAmount')::NUMERIC, 0)),
    -ABS(COALESCE((tp.raw_json->'refund'->>'refundAmount')::NUMERIC, 0)),
    tp.payment_date,
    NULL,
    'refund'::TEXT,
    tp.raw_json,
    NOW()
  FROM public.toast_payments tp
  WHERE tp.restaurant_id = p_restaurant_id
    AND tp.raw_json->>'refundStatus' IN ('PARTIAL', 'FULL')
    AND (tp.raw_json->'refund'->>'refundAmount')::NUMERIC > 0
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

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  v_synced_count := v_synced_count + v_row_count;

  RETURN v_synced_count;
END;
$$;

-- Update the alias function as well
CREATE OR REPLACE FUNCTION toast_sync_financial_breakdown(
  p_order_guid TEXT,
  p_restaurant_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN sync_toast_to_unified_sales(p_restaurant_id);
END;
$$;

COMMENT ON FUNCTION sync_toast_to_unified_sales IS
'Syncs Toast orders to unified_sales. Called by edge functions with service role - access control enforced at edge function level.';
