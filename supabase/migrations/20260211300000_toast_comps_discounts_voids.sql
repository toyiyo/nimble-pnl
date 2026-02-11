-- =====================================================
-- Toast Comps/Discounts/Voids Support
-- =====================================================
-- Adds is_voided and discount_amount columns to toast_order_items,
-- backfills from raw_json, and rewrites sync_toast_to_unified_sales
-- to use gross pricing with offset entries.
--
-- Problem: Our POS Sales totals are higher than Toast's Net Amount because:
--   1. Fully comped items (price=0) are excluded by total_price != 0 filter
--   2. Item-level discounts are not tracked as offset entries
--   3. toast_orders.discount_amount is always NULL (Toast API doesn't populate it)
--   4. Voided items are imported as regular sales
--
-- Solution: "Gross + Offset Entries"
--   - Store revenue at gross price (preDiscountPrice) for inventory tracking
--   - Create negative discount entries to offset comps/discounts
--   - Create negative void entries for voided items
--   - Remove broken order-level discount section
-- =====================================================


-- =====================================================
-- SECTION 1: Schema Changes
-- =====================================================

-- Add is_voided column (from Toast selection.voided)
ALTER TABLE public.toast_order_items
  ADD COLUMN IF NOT EXISTS is_voided BOOLEAN DEFAULT false;

-- Add discount_amount column (preDiscountPrice - price)
ALTER TABLE public.toast_order_items
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC DEFAULT 0;

COMMENT ON COLUMN public.toast_order_items.is_voided IS
  'Whether this item was voided on the check. From Toast selection.voided field.';

COMMENT ON COLUMN public.toast_order_items.discount_amount IS
  'Discount applied to this item (unit_price - total_price). Comps are 100% discounts.';

-- Backfill existing rows from raw_json
UPDATE public.toast_order_items
SET
  is_voided = COALESCE((raw_json->>'voided')::BOOLEAN, false),
  discount_amount = GREATEST(COALESCE(unit_price, 0) - COALESCE(total_price, 0), 0)
WHERE is_voided = false AND discount_amount = 0;


-- =====================================================
-- SECTION 2: Rewrite sync_toast_to_unified_sales (single-arg)
-- =====================================================
-- Changes from previous version:
--   1. Revenue entries: use unit_price (gross) instead of total_price (net)
--   2. Revenue entries: filter on unit_price != 0 AND is_voided = false
--   3. NEW: Item discount/comp offset entries (negative)
--   4. NEW: Void offset entries (negative)
--   5. REMOVED: Order-level discount section (toast_orders.discount_amount is always NULL)

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

  -- 1. REVENUE entries (from order items at GROSS price)
  -- Uses unit_price (preDiscountPrice) so comped items still appear as revenue
  -- Offset entries below will zero out discounted/comped amounts
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, pos_category, item_type, raw_data, synced_at
  )
  SELECT
    toi.restaurant_id, 'toast', toi.toast_order_guid, toi.toast_item_guid,
    toi.item_name, toi.quantity, toi.unit_price, toi.unit_price * toi.quantity,
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
  -- Creates a negative entry for each discounted/comped item to offset the gross revenue
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, pos_category, item_type, adjustment_type, raw_data, synced_at
  )
  SELECT
    toi.restaurant_id, 'toast', toi.toast_order_guid, toi.toast_item_guid || '_discount',
    'Discount - ' || toi.item_name, toi.quantity, -toi.discount_amount, -toi.discount_amount * toi.quantity,
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
  -- Voided items are excluded from revenue (step 1) but need a negative entry
  -- so downstream inventory deduction can see them while financials stay correct
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, pos_category, item_type, adjustment_type, raw_data, synced_at
  )
  SELECT
    toi.restaurant_id, 'toast', toi.toast_order_guid, toi.toast_item_guid || '_void',
    'Void - ' || toi.item_name, toi.quantity, -toi.unit_price, -toi.unit_price * toi.quantity,
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

  -- 5. TIP entries (unchanged)
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
  'Syncs ALL Toast orders to unified_sales using gross pricing with discount/void offsets.';


-- =====================================================
-- SECTION 3: Rewrite sync_toast_to_unified_sales (date-range overload)
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

  -- 1. REVENUE entries at GROSS price (filtered by date)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, pos_category, item_type, raw_data, synced_at
  )
  SELECT
    toi.restaurant_id, 'toast', toi.toast_order_guid, toi.toast_item_guid,
    toi.item_name, toi.quantity, toi.unit_price, toi.unit_price * toi.quantity,
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
    'Discount - ' || toi.item_name, toi.quantity, -toi.discount_amount, -toi.discount_amount * toi.quantity,
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
    'Void - ' || toi.item_name, toi.quantity, -toi.unit_price, -toi.unit_price * toi.quantity,
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

  -- 5. TIP entries (filtered by payment_date, unchanged)
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
  'Syncs Toast orders within date range to unified_sales using gross pricing with discount/void offsets.';


-- =====================================================
-- SECTION 4: Clean up stale unified_sales for Toast
-- =====================================================
-- Remove old order-level discount entries that used toast_orders.discount_amount (always NULL).
-- These entries should not exist but clean up just in case.
DELETE FROM public.unified_sales
WHERE pos_system = 'toast'
  AND external_item_id LIKE '%_discount'
  AND item_name = 'Order Discount';
