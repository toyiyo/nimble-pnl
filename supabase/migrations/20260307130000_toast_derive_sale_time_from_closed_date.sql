-- Migration: toast_derive_sale_time_from_closed_date
-- Purpose: Derive sale_time from Toast raw_json closedDate instead of order_time (which is always NULL).
--
-- Background:
-- Commit 1678ca27 intentionally set order_time to NULL when businessDate exists,
-- because closedDate is UTC and mixing UTC time with businessDate would cause
-- late-night orders to appear on the wrong business day. This was correct for
-- sale_date (P&L accuracy), but left sale_time empty, breaking hourly analysis.
--
-- Fix: Extract the TIME portion from closedDate, converted to the restaurant's
-- local timezone. sale_date continues to use businessDate (unchanged).
-- sale_time is only used by hourly features (staffing suggestions), not P&L.
--
-- Part 1: Backfill existing unified_sales rows
-- Part 2: Redefine sync_toast_to_unified_sales(UUID) to derive sale_time
-- Part 3: Redefine sync_toast_to_unified_sales(UUID, DATE, DATE) to derive sale_time

-- =============================================================================
-- Part 1: Backfill sale_time in unified_sales from toast_orders raw_json
-- =============================================================================

UPDATE public.unified_sales us
SET sale_time = (
  (too.raw_json->>'closedDate')::timestamptz
  AT TIME ZONE COALESCE(r.timezone, 'America/Chicago')
)::time
FROM public.toast_orders too
JOIN public.restaurants r ON r.id = too.restaurant_id
WHERE us.pos_system = 'toast'
  AND us.external_order_id = too.toast_order_guid
  AND us.restaurant_id = too.restaurant_id
  AND us.sale_time IS NULL
  AND too.raw_json->>'closedDate' IS NOT NULL;

-- =============================================================================
-- Part 2: Redefine sync_toast_to_unified_sales(UUID) — single-arg overload
-- =============================================================================

CREATE OR REPLACE FUNCTION sync_toast_to_unified_sales(p_restaurant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
DECLARE
  v_synced_count INTEGER := 0;
  v_row_count INTEGER;
  v_sync_start TIMESTAMPTZ := clock_timestamp();
  v_tz TEXT;
BEGIN
  -- Authorization check: skip when called from service role (auth.uid() is NULL)
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE restaurant_id = p_restaurant_id
      AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: user does not have access to this restaurant';
  END IF;

  -- Look up restaurant timezone once
  SELECT COALESCE(r.timezone, 'America/Chicago') INTO v_tz
  FROM public.restaurants r WHERE r.id = p_restaurant_id;

  -- Set GUC flag to skip per-row triggers during bulk sync (transaction-local).
  PERFORM set_config('app.skip_unified_sales_triggers', 'true', true);

  -- 0a. DELETE stale sale entries for now-voided items
  DELETE FROM public.unified_sales us
  USING public.toast_order_items toi
  WHERE us.restaurant_id = p_restaurant_id
    AND us.pos_system = 'toast'
    AND us.item_type = 'sale'
    AND us.external_item_id = toi.toast_item_guid
    AND us.restaurant_id = toi.restaurant_id
    AND toi.is_voided = true;

  -- 0b. DELETE stale tax entries for $0-tax orders
  DELETE FROM public.unified_sales us
  USING public.toast_orders too
  WHERE us.restaurant_id = p_restaurant_id
    AND us.pos_system = 'toast'
    AND us.item_type = 'tax'
    AND us.external_item_id = too.toast_order_guid || '_tax'
    AND us.restaurant_id = too.restaurant_id
    AND (too.tax_amount IS NULL OR too.tax_amount = 0);

  -- 0c. DELETE stale discount entries for now-voided items
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
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, pos_category, item_type, raw_data, synced_at
  )
  SELECT
    toi.restaurant_id, 'toast', toi.toast_order_guid, toi.toast_item_guid,
    toi.item_name, toi.quantity, toi.unit_price / NULLIF(toi.quantity, 0), toi.unit_price,
    too.order_date,
    CASE WHEN too.raw_json->>'closedDate' IS NOT NULL
         THEN ((too.raw_json->>'closedDate')::timestamptz AT TIME ZONE v_tz)::time
         ELSE too.order_time
    END,
    toi.menu_category, 'sale', toi.raw_json, NOW()
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
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, pos_category, item_type, adjustment_type, raw_data, synced_at
  )
  SELECT
    toi.restaurant_id, 'toast', toi.toast_order_guid, toi.toast_item_guid || '_discount',
    'Discount - ' || toi.item_name, toi.quantity, -toi.discount_amount / NULLIF(toi.quantity, 0), -toi.discount_amount,
    too.order_date,
    CASE WHEN too.raw_json->>'closedDate' IS NOT NULL
         THEN ((too.raw_json->>'closedDate')::timestamptz AT TIME ZONE v_tz)::time
         ELSE too.order_time
    END,
    toi.menu_category, 'discount', 'discount', toi.raw_json, NOW()
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
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, pos_category, item_type, adjustment_type, raw_data, synced_at
  )
  SELECT
    toi.restaurant_id, 'toast', toi.toast_order_guid, toi.toast_item_guid || '_void',
    'Void - ' || toi.item_name, toi.quantity, -toi.unit_price / NULLIF(toi.quantity, 0), -toi.unit_price,
    too.order_date,
    CASE WHEN too.raw_json->>'closedDate' IS NOT NULL
         THEN ((too.raw_json->>'closedDate')::timestamptz AT TIME ZONE v_tz)::time
         ELSE too.order_time
    END,
    toi.menu_category, 'discount', 'void', toi.raw_json, NOW()
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

  -- 4. TAX entries
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, item_type, adjustment_type, raw_data, synced_at
  )
  SELECT
    too.restaurant_id, 'toast', too.toast_order_guid, too.toast_order_guid || '_tax',
    'Sales Tax', 1, too.tax_amount, too.tax_amount,
    too.order_date,
    CASE WHEN too.raw_json->>'closedDate' IS NOT NULL
         THEN ((too.raw_json->>'closedDate')::timestamptz AT TIME ZONE v_tz)::time
         ELSE too.order_time
    END,
    'tax', 'tax', too.raw_json, NOW()
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
  DELETE FROM public.unified_sales us
  USING public.toast_payments tp
  WHERE us.restaurant_id = p_restaurant_id
    AND us.pos_system = 'toast'
    AND us.item_type = 'tip'
    AND us.external_item_id = tp.toast_payment_guid || '_tip'
    AND us.restaurant_id = tp.restaurant_id
    AND tp.payment_status IN ('DENIED', 'VOIDED');

  -- 5b. TIP entries (filter out denied/voided payments)
  -- Tips don't have closedDate in toast_payments; keep NULL sale_time for tips
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

  -- 6. REFUND entries
  -- Refunds don't have closedDate; keep NULL sale_time for refunds
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

  -- Reset GUC flag to re-enable per-row triggers
  PERFORM set_config('app.skip_unified_sales_triggers', 'false', true);

  -- Batch-categorize uncategorized sale rows
  IF auth.uid() IS NOT NULL THEN
    PERFORM apply_rules_to_pos_sales(p_restaurant_id, 10000);
  ELSE
    RAISE LOG 'sync_toast_to_unified_sales: skipping batch categorization (service-role caller, auth.uid() is NULL)';
  END IF;

  -- Batch-aggregate daily sales for dates touched in this sync
  PERFORM public.aggregate_unified_sales_to_daily(p_restaurant_id, d.sale_date)
  FROM (SELECT DISTINCT sale_date FROM public.unified_sales
        WHERE restaurant_id = p_restaurant_id AND pos_system = 'toast'
          AND synced_at >= v_sync_start) d;

  RETURN v_synced_count;
END;
$$;

COMMENT ON FUNCTION sync_toast_to_unified_sales(UUID) IS
  'Syncs ALL Toast orders to unified_sales. Derives sale_time from raw_json closedDate in restaurant timezone. Skips per-row triggers via GUC flag during bulk ops, then batch-categorizes and batch-aggregates after sync.';

-- =============================================================================
-- Part 3: Redefine sync_toast_to_unified_sales(UUID, DATE, DATE) — date-range overload
-- =============================================================================

CREATE OR REPLACE FUNCTION sync_toast_to_unified_sales(
  p_restaurant_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
DECLARE
  v_synced_count INTEGER := 0;
  v_row_count INTEGER;
  v_tz TEXT;
BEGIN
  -- Authorization check: skip when called from service role (auth.uid() is NULL)
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE restaurant_id = p_restaurant_id
      AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: user does not have access to this restaurant';
  END IF;

  -- Look up restaurant timezone once
  SELECT COALESCE(r.timezone, 'America/Chicago') INTO v_tz
  FROM public.restaurants r WHERE r.id = p_restaurant_id;

  -- Set GUC flag to skip per-row triggers during bulk sync (transaction-local)
  PERFORM set_config('app.skip_unified_sales_triggers', 'true', true);

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
    too.order_date,
    CASE WHEN too.raw_json->>'closedDate' IS NOT NULL
         THEN ((too.raw_json->>'closedDate')::timestamptz AT TIME ZONE v_tz)::time
         ELSE too.order_time
    END,
    toi.menu_category, 'sale', toi.raw_json, NOW()
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
    too.order_date,
    CASE WHEN too.raw_json->>'closedDate' IS NOT NULL
         THEN ((too.raw_json->>'closedDate')::timestamptz AT TIME ZONE v_tz)::time
         ELSE too.order_time
    END,
    toi.menu_category, 'discount', 'discount', toi.raw_json, NOW()
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
    too.order_date,
    CASE WHEN too.raw_json->>'closedDate' IS NOT NULL
         THEN ((too.raw_json->>'closedDate')::timestamptz AT TIME ZONE v_tz)::time
         ELSE too.order_time
    END,
    toi.menu_category, 'discount', 'void', toi.raw_json, NOW()
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

  -- 4. TAX entries (filtered by date)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, item_type, adjustment_type, raw_data, synced_at
  )
  SELECT
    too.restaurant_id, 'toast', too.toast_order_guid, too.toast_order_guid || '_tax',
    'Sales Tax', 1, too.tax_amount, too.tax_amount,
    too.order_date,
    CASE WHEN too.raw_json->>'closedDate' IS NOT NULL
         THEN ((too.raw_json->>'closedDate')::timestamptz AT TIME ZONE v_tz)::time
         ELSE too.order_time
    END,
    'tax', 'tax', too.raw_json, NOW()
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
  -- Tips don't have closedDate in toast_payments; keep NULL sale_time for tips
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

  -- 6. REFUND entries (filtered by payment_date)
  -- Refunds don't have closedDate; keep NULL sale_time for refunds
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

  -- Reset GUC flag to re-enable per-row triggers
  PERFORM set_config('app.skip_unified_sales_triggers', 'false', true);

  -- Batch-categorize uncategorized sale rows
  IF auth.uid() IS NOT NULL THEN
    PERFORM apply_rules_to_pos_sales(p_restaurant_id, 10000);
  ELSE
    RAISE LOG 'sync_toast_to_unified_sales: skipping batch categorization (service-role caller, auth.uid() is NULL)';
  END IF;

  -- Batch-aggregate daily sales for affected dates in range
  PERFORM public.aggregate_unified_sales_to_daily(p_restaurant_id, d.sale_date)
  FROM (SELECT DISTINCT sale_date FROM public.unified_sales
        WHERE restaurant_id = p_restaurant_id AND pos_system = 'toast'
          AND sale_date >= p_start_date AND sale_date <= p_end_date) d;

  RETURN v_synced_count;
END;
$$;

COMMENT ON FUNCTION sync_toast_to_unified_sales(UUID, DATE, DATE) IS
  'Syncs Toast orders within date range to unified_sales. Derives sale_time from raw_json closedDate in restaurant timezone. Skips per-row triggers via GUC flag during bulk ops, then batch-categorizes and batch-aggregates after sync.';
