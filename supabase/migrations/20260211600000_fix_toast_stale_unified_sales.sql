-- =====================================================
-- Fix Stale Toast unified_sales Entries
-- =====================================================
-- The sync_toast_to_unified_sales RPC uses upsert (ON CONFLICT DO UPDATE),
-- which cannot delete rows that the SELECT no longer includes. When items
-- become voided or orders get fully comp'd ($0 tax), stale entries persist.
--
-- Fix: Add DELETE steps before the existing upsert INSERTs to remove
-- stale sale/tax/discount entries for voided items and $0-tax orders.
--
-- Affected restaurants:
--   Home:   373 stale voided sales / $5.4K inflated gross, 12 stale tax / $25
--   Russos: 360 stale voided sales / $5.2K inflated gross, 15 stale tax / $38
-- =====================================================


-- =====================================================
-- SECTION 1: Fix single-arg overload
-- =====================================================

CREATE OR REPLACE FUNCTION sync_toast_to_unified_sales(p_restaurant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_synced_count INTEGER := 0;
  v_row_count INTEGER;
BEGIN
  -- Authorization check: skip when called from service role (auth.uid() is NULL)
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE restaurant_id = p_restaurant_id
      AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: user does not have access to this restaurant';
  END IF;

  -- 0a. DELETE stale sale entries for now-voided items
  -- The upsert in Step 1 filters is_voided = false, so voided items
  -- that were previously synced as sales will never be updated/removed.
  DELETE FROM public.unified_sales us
  USING public.toast_order_items toi
  WHERE us.restaurant_id = p_restaurant_id
    AND us.pos_system = 'toast'
    AND us.item_type = 'sale'
    AND us.external_item_id = toi.toast_item_guid
    AND us.restaurant_id = toi.restaurant_id
    AND toi.is_voided = true;

  -- 0b. DELETE stale tax entries for $0-tax orders
  -- The upsert in Step 4 filters tax_amount != 0, so orders whose tax
  -- dropped to $0 (e.g. fully comp'd) will never be updated/removed.
  DELETE FROM public.unified_sales us
  USING public.toast_orders too
  WHERE us.restaurant_id = p_restaurant_id
    AND us.pos_system = 'toast'
    AND us.item_type = 'tax'
    AND us.external_item_id = too.toast_order_guid || '_tax'
    AND us.restaurant_id = too.restaurant_id
    AND (too.tax_amount IS NULL OR too.tax_amount = 0);

  -- 0c. DELETE stale discount entries for now-voided items
  -- The upsert in Step 2 filters is_voided = false, so discounts on
  -- voided items will never be updated/removed.
  DELETE FROM public.unified_sales us
  USING public.toast_order_items toi
  WHERE us.restaurant_id = p_restaurant_id
    AND us.pos_system = 'toast'
    AND us.item_type = 'discount'
    AND us.adjustment_type = 'discount'
    AND us.external_item_id = toi.toast_item_guid || '_discount'
    AND us.restaurant_id = toi.restaurant_id
    AND toi.is_voided = true;

  -- 1. REVENUE entries (from order items at GROSS price)
  -- unit_price in toast_order_items is a LINE TOTAL (qty * per-unit price from Toast).
  -- We divide by quantity for true per-unit, and use the raw value as total_price.
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, pos_category, item_type, raw_data, synced_at
  )
  SELECT
    toi.restaurant_id, 'toast', toi.toast_order_guid, toi.toast_item_guid,
    toi.item_name, toi.quantity, toi.unit_price / NULLIF(toi.quantity, 0), toi.unit_price,
    too.order_date, too.order_time, toi.menu_category, 'sale', toi.raw_json, NOW()
  FROM public.toast_order_items toi
  INNER JOIN public.toast_orders too
    ON toi.toast_order_guid = too.toast_order_guid
    AND toi.restaurant_id = too.restaurant_id
  WHERE toi.restaurant_id = p_restaurant_id
    AND toi.unit_price IS NOT NULL
    AND toi.unit_price != 0
    AND toi.is_voided = false
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

  -- 2. ITEM DISCOUNT/COMP offset entries (negative amounts)
  -- discount_amount is also a LINE TOTAL. Divide by quantity for per-unit.
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, pos_category, item_type, adjustment_type, raw_data, synced_at
  )
  SELECT
    toi.restaurant_id, 'toast', toi.toast_order_guid, toi.toast_item_guid || '_discount',
    'Discount - ' || toi.item_name, toi.quantity, -toi.discount_amount / NULLIF(toi.quantity, 0), -toi.discount_amount,
    too.order_date, too.order_time, toi.menu_category, 'discount', 'discount', toi.raw_json, NOW()
  FROM public.toast_order_items toi
  INNER JOIN public.toast_orders too
    ON toi.toast_order_guid = too.toast_order_guid
    AND toi.restaurant_id = too.restaurant_id
  WHERE toi.restaurant_id = p_restaurant_id
    AND toi.discount_amount > 0
    AND toi.is_voided = false
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

  -- 3. VOID offset entries (negative amounts)
  -- unit_price is a LINE TOTAL. Divide by quantity for per-unit.
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, pos_category, item_type, adjustment_type, raw_data, synced_at
  )
  SELECT
    toi.restaurant_id, 'toast', toi.toast_order_guid, toi.toast_item_guid || '_void',
    'Void - ' || toi.item_name, toi.quantity, -toi.unit_price / NULLIF(toi.quantity, 0), -toi.unit_price,
    too.order_date, too.order_time, toi.menu_category, 'discount', 'void', toi.raw_json, NOW()
  FROM public.toast_order_items toi
  INNER JOIN public.toast_orders too
    ON toi.toast_order_guid = too.toast_order_guid
    AND toi.restaurant_id = too.restaurant_id
  WHERE toi.restaurant_id = p_restaurant_id
    AND toi.is_voided = true
    AND toi.unit_price IS NOT NULL
    AND toi.unit_price != 0
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

  -- 4. TAX entries (unchanged)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, item_type, adjustment_type, raw_data, synced_at
  )
  SELECT
    too.restaurant_id, 'toast', too.toast_order_guid, too.toast_order_guid || '_tax',
    'Sales Tax', 1, too.tax_amount, too.tax_amount,
    too.order_date, too.order_time, 'tax', 'tax', too.raw_json, NOW()
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

  -- 5a. DELETE stale tip entries for denied/voided payments
  -- The upsert below won't remove rows that the query no longer selects,
  -- so we must explicitly delete tips from denied/voided payments.
  DELETE FROM public.unified_sales us
  USING public.toast_payments tp
  WHERE us.restaurant_id = p_restaurant_id
    AND us.pos_system = 'toast'
    AND us.item_type = 'tip'
    AND us.external_item_id = tp.toast_payment_guid || '_tip'
    AND us.restaurant_id = tp.restaurant_id
    AND tp.payment_status IN ('DENIED', 'VOIDED');

  -- 5b. TIP entries (filter out denied/voided payments)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, item_type, adjustment_type, raw_data, synced_at
  )
  SELECT
    tp.restaurant_id, 'toast', tp.toast_order_guid, tp.toast_payment_guid || '_tip',
    'Tip - ' || COALESCE(tp.payment_type, 'Unknown'), 1, tp.tip_amount, tp.tip_amount,
    tp.payment_date, NULL, 'tip', 'tip', tp.raw_json, NOW()
  FROM public.toast_payments tp
  WHERE tp.restaurant_id = p_restaurant_id
    AND tp.tip_amount IS NOT NULL
    AND tp.tip_amount != 0
    AND tp.payment_status NOT IN ('DENIED', 'VOIDED')
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

  -- 6. REFUND entries (unchanged)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, item_type, raw_data, synced_at
  )
  SELECT
    tp.restaurant_id, 'toast', tp.toast_order_guid, tp.toast_payment_guid || '_refund',
    'Refund - ' || COALESCE(tp.payment_type, 'Unknown'), 1,
    -ABS(COALESCE((tp.raw_json->'refund'->>'refundAmount')::NUMERIC / 100, 0)),
    -ABS(COALESCE((tp.raw_json->'refund'->>'refundAmount')::NUMERIC / 100, 0)),
    tp.payment_date, NULL, 'refund', tp.raw_json, NOW()
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

COMMENT ON FUNCTION sync_toast_to_unified_sales(UUID) IS
  'Syncs ALL Toast orders to unified_sales using gross pricing with discount/void offsets. Deletes stale entries for voided items and $0-tax orders.';


-- =====================================================
-- SECTION 2: Fix date-range overload
-- =====================================================

CREATE OR REPLACE FUNCTION sync_toast_to_unified_sales(
  p_restaurant_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_synced_count INTEGER := 0;
  v_row_count INTEGER;
BEGIN
  -- Authorization check: skip when called from service role (auth.uid() is NULL)
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE restaurant_id = p_restaurant_id
      AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: user does not have access to this restaurant';
  END IF;

  -- 0a. DELETE stale sale entries for now-voided items (filtered by date)
  DELETE FROM public.unified_sales us
  USING public.toast_order_items toi
  JOIN public.toast_orders too
    ON toi.toast_order_guid = too.toast_order_guid
    AND toi.restaurant_id = too.restaurant_id
  WHERE us.restaurant_id = p_restaurant_id
    AND us.pos_system = 'toast'
    AND us.item_type = 'sale'
    AND us.external_item_id = toi.toast_item_guid
    AND us.restaurant_id = toi.restaurant_id
    AND toi.is_voided = true
    AND too.order_date >= p_start_date
    AND too.order_date <= p_end_date;

  -- 0b. DELETE stale tax entries for $0-tax orders (filtered by date)
  DELETE FROM public.unified_sales us
  USING public.toast_orders too
  WHERE us.restaurant_id = p_restaurant_id
    AND us.pos_system = 'toast'
    AND us.item_type = 'tax'
    AND us.external_item_id = too.toast_order_guid || '_tax'
    AND us.restaurant_id = too.restaurant_id
    AND (too.tax_amount IS NULL OR too.tax_amount = 0)
    AND too.order_date >= p_start_date
    AND too.order_date <= p_end_date;

  -- 0c. DELETE stale discount entries for now-voided items (filtered by date)
  DELETE FROM public.unified_sales us
  USING public.toast_order_items toi
  JOIN public.toast_orders too
    ON toi.toast_order_guid = too.toast_order_guid
    AND toi.restaurant_id = too.restaurant_id
  WHERE us.restaurant_id = p_restaurant_id
    AND us.pos_system = 'toast'
    AND us.item_type = 'discount'
    AND us.adjustment_type = 'discount'
    AND us.external_item_id = toi.toast_item_guid || '_discount'
    AND us.restaurant_id = toi.restaurant_id
    AND toi.is_voided = true
    AND too.order_date >= p_start_date
    AND too.order_date <= p_end_date;

  -- 1. REVENUE entries at GROSS price (filtered by date)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, pos_category, item_type, raw_data, synced_at
  )
  SELECT
    toi.restaurant_id, 'toast', toi.toast_order_guid, toi.toast_item_guid,
    toi.item_name, toi.quantity, toi.unit_price / NULLIF(toi.quantity, 0), toi.unit_price,
    too.order_date, too.order_time, toi.menu_category, 'sale', toi.raw_json, NOW()
  FROM public.toast_order_items toi
  INNER JOIN public.toast_orders too
    ON toi.toast_order_guid = too.toast_order_guid
    AND toi.restaurant_id = too.restaurant_id
  WHERE toi.restaurant_id = p_restaurant_id
    AND too.order_date >= p_start_date
    AND too.order_date <= p_end_date
    AND toi.unit_price IS NOT NULL
    AND toi.unit_price != 0
    AND toi.is_voided = false
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

  -- 2. ITEM DISCOUNT/COMP offset entries (filtered by date)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, pos_category, item_type, adjustment_type, raw_data, synced_at
  )
  SELECT
    toi.restaurant_id, 'toast', toi.toast_order_guid, toi.toast_item_guid || '_discount',
    'Discount - ' || toi.item_name, toi.quantity, -toi.discount_amount / NULLIF(toi.quantity, 0), -toi.discount_amount,
    too.order_date, too.order_time, toi.menu_category, 'discount', 'discount', toi.raw_json, NOW()
  FROM public.toast_order_items toi
  INNER JOIN public.toast_orders too
    ON toi.toast_order_guid = too.toast_order_guid
    AND toi.restaurant_id = too.restaurant_id
  WHERE toi.restaurant_id = p_restaurant_id
    AND too.order_date >= p_start_date
    AND too.order_date <= p_end_date
    AND toi.discount_amount > 0
    AND toi.is_voided = false
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

  -- 3. VOID offset entries (filtered by date)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, pos_category, item_type, adjustment_type, raw_data, synced_at
  )
  SELECT
    toi.restaurant_id, 'toast', toi.toast_order_guid, toi.toast_item_guid || '_void',
    'Void - ' || toi.item_name, toi.quantity, -toi.unit_price / NULLIF(toi.quantity, 0), -toi.unit_price,
    too.order_date, too.order_time, toi.menu_category, 'discount', 'void', toi.raw_json, NOW()
  FROM public.toast_order_items toi
  INNER JOIN public.toast_orders too
    ON toi.toast_order_guid = too.toast_order_guid
    AND toi.restaurant_id = too.restaurant_id
  WHERE toi.restaurant_id = p_restaurant_id
    AND too.order_date >= p_start_date
    AND too.order_date <= p_end_date
    AND toi.is_voided = true
    AND toi.unit_price IS NOT NULL
    AND toi.unit_price != 0
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

  -- 4. TAX entries (filtered by date, unchanged)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, item_type, adjustment_type, raw_data, synced_at
  )
  SELECT
    too.restaurant_id, 'toast', too.toast_order_guid, too.toast_order_guid || '_tax',
    'Sales Tax', 1, too.tax_amount, too.tax_amount,
    too.order_date, too.order_time, 'tax', 'tax', too.raw_json, NOW()
  FROM public.toast_orders too
  WHERE too.restaurant_id = p_restaurant_id
    AND too.order_date >= p_start_date
    AND too.order_date <= p_end_date
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

  -- 5a. DELETE stale tip entries for denied/voided payments (filtered by date)
  DELETE FROM public.unified_sales us
  USING public.toast_payments tp
  WHERE us.restaurant_id = p_restaurant_id
    AND us.pos_system = 'toast'
    AND us.item_type = 'tip'
    AND us.external_item_id = tp.toast_payment_guid || '_tip'
    AND us.restaurant_id = tp.restaurant_id
    AND tp.payment_date >= p_start_date
    AND tp.payment_date <= p_end_date
    AND tp.payment_status IN ('DENIED', 'VOIDED');

  -- 5b. TIP entries (filtered by payment_date, filter out denied/voided payments)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, item_type, adjustment_type, raw_data, synced_at
  )
  SELECT
    tp.restaurant_id, 'toast', tp.toast_order_guid, tp.toast_payment_guid || '_tip',
    'Tip - ' || COALESCE(tp.payment_type, 'Unknown'), 1, tp.tip_amount, tp.tip_amount,
    tp.payment_date, NULL, 'tip', 'tip', tp.raw_json, NOW()
  FROM public.toast_payments tp
  WHERE tp.restaurant_id = p_restaurant_id
    AND tp.payment_date >= p_start_date
    AND tp.payment_date <= p_end_date
    AND tp.tip_amount IS NOT NULL
    AND tp.tip_amount != 0
    AND tp.payment_status NOT IN ('DENIED', 'VOIDED')
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

  -- 6. REFUND entries (filtered by payment_date, unchanged)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, item_type, raw_data, synced_at
  )
  SELECT
    tp.restaurant_id, 'toast', tp.toast_order_guid, tp.toast_payment_guid || '_refund',
    'Refund - ' || COALESCE(tp.payment_type, 'Unknown'), 1,
    -ABS(COALESCE((tp.raw_json->'refund'->>'refundAmount')::NUMERIC / 100, 0)),
    -ABS(COALESCE((tp.raw_json->'refund'->>'refundAmount')::NUMERIC / 100, 0)),
    tp.payment_date, NULL, 'refund', tp.raw_json, NOW()
  FROM public.toast_payments tp
  WHERE tp.restaurant_id = p_restaurant_id
    AND tp.payment_date >= p_start_date
    AND tp.payment_date <= p_end_date
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

COMMENT ON FUNCTION sync_toast_to_unified_sales(UUID, DATE, DATE) IS
  'Syncs Toast orders within date range to unified_sales using gross pricing with discount/void offsets. Deletes stale entries for voided items and $0-tax orders.';
