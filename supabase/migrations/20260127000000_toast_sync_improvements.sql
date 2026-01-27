-- =====================================================
-- Toast Sync Improvements
-- =====================================================
-- This migration consolidates all Toast sync-related schema changes:
-- 1. Scheduled cron job for bulk sync (every 6 hours)
-- 2. Schema fixes for order items (nullable toast_order_id)
-- 3. Unique constraints for upsert operations
-- 4. Sync cursor for resumable initial imports
-- 5. Updated sync_toast_to_unified_sales function (service role compatible)
-- =====================================================


-- =====================================================
-- SECTION 1: Schema Changes
-- =====================================================

-- Make toast_order_id nullable in toast_order_items
-- The processor uses toast_order_guid for relationships, not the internal ID
ALTER TABLE public.toast_order_items
  ALTER COLUMN toast_order_id DROP NOT NULL;

-- Add sync_cursor column for resumable initial sync
-- Tracks progress during the 90-day initial import (days completed)
ALTER TABLE public.toast_connections
  ADD COLUMN IF NOT EXISTS sync_cursor INTEGER DEFAULT 0;

COMMENT ON COLUMN public.toast_connections.sync_cursor IS
  'Tracks progress during initial sync (days completed). Reset to 0 when initial_sync_done is true.';


-- =====================================================
-- SECTION 2: Unique Constraints for Upsert Operations
-- =====================================================

-- Add unique constraint for toast_order_items if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'toast_order_items_unique_item'
  ) THEN
    ALTER TABLE public.toast_order_items
      ADD CONSTRAINT toast_order_items_unique_item
      UNIQUE (restaurant_id, toast_item_guid, toast_order_guid);
  END IF;
END $$;

-- Add unique constraint for toast_payments if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'toast_payments_unique_payment'
  ) THEN
    ALTER TABLE public.toast_payments
      ADD CONSTRAINT toast_payments_unique_payment
      UNIQUE (restaurant_id, toast_payment_guid, toast_order_guid);
  END IF;
END $$;


-- =====================================================
-- SECTION 3: Sync Function (Service Role Compatible)
-- =====================================================

-- Syncs Toast orders to unified_sales table
-- Called by edge functions with service role key
CREATE OR REPLACE FUNCTION sync_toast_to_unified_sales(p_restaurant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_synced_count INTEGER := 0;
  v_row_count INTEGER;
BEGIN
  -- Authorization check: verify user has access to this restaurant
  -- Skip check when called from service role (auth.uid() is NULL)
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE restaurant_id = p_restaurant_id
      AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: user does not have access to this restaurant';
  END IF;

  -- Insert/Update REVENUE entries (from order items)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, pos_category, item_type, raw_data, synced_at
  )
  SELECT
    toi.restaurant_id, 'toast', toi.toast_order_guid, toi.toast_item_guid,
    toi.item_name, toi.quantity, toi.unit_price, toi.total_price,
    too.order_date, too.order_time, toi.menu_category, 'sale', toi.raw_json, NOW()
  FROM public.toast_order_items toi
  INNER JOIN public.toast_orders too
    ON toi.toast_order_guid = too.toast_order_guid
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

  -- Insert/Update DISCOUNT entries (from order discounts)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, item_type, adjustment_type, raw_data, synced_at
  )
  SELECT
    too.restaurant_id, 'toast', too.toast_order_guid, too.toast_order_guid || '_discount',
    'Order Discount', 1, -ABS(too.discount_amount), -ABS(too.discount_amount),
    too.order_date, too.order_time, 'discount', 'discount', too.raw_json, NOW()
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

  -- Insert/Update TAX entries
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

  -- Insert/Update TIP entries (from payments)
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

  -- Insert/Update REFUND entries (from payments with refundStatus)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, item_type, raw_data, synced_at
  )
  SELECT
    tp.restaurant_id, 'toast', tp.toast_order_guid, tp.toast_payment_guid || '_refund',
    'Refund - ' || COALESCE(tp.payment_type, 'Unknown'), 1,
    -- Toast API sends refundAmount in cents, divide by 100 for dollars
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
  'Syncs ALL Toast orders to unified_sales. For large datasets, use the date-range version.';

-- Overloaded version with date range for incremental/batched processing
-- This is the preferred version for large datasets to avoid CPU timeouts
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

  -- Insert/Update REVENUE entries (from order items) - filtered by date
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, pos_category, item_type, raw_data, synced_at
  )
  SELECT
    toi.restaurant_id, 'toast', toi.toast_order_guid, toi.toast_item_guid,
    toi.item_name, toi.quantity, toi.unit_price, toi.total_price,
    too.order_date, too.order_time, toi.menu_category, 'sale', toi.raw_json, NOW()
  FROM public.toast_order_items toi
  INNER JOIN public.toast_orders too
    ON toi.toast_order_guid = too.toast_order_guid
    AND toi.restaurant_id = too.restaurant_id
  WHERE toi.restaurant_id = p_restaurant_id
    AND too.order_date >= p_start_date
    AND too.order_date <= p_end_date
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

  -- Insert/Update DISCOUNT entries - filtered by date
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, item_type, adjustment_type, raw_data, synced_at
  )
  SELECT
    too.restaurant_id, 'toast', too.toast_order_guid, too.toast_order_guid || '_discount',
    'Order Discount', 1, -ABS(too.discount_amount), -ABS(too.discount_amount),
    too.order_date, too.order_time, 'discount', 'discount', too.raw_json, NOW()
  FROM public.toast_orders too
  WHERE too.restaurant_id = p_restaurant_id
    AND too.order_date >= p_start_date
    AND too.order_date <= p_end_date
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

  -- Insert/Update TAX entries - filtered by date
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

  -- Insert/Update TIP entries - filtered by payment_date
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

  -- Insert/Update REFUND entries - filtered by payment_date
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
  'Syncs Toast orders within date range to unified_sales. Use for large datasets to avoid CPU timeouts.';

-- DEPRECATED: Backward compatibility wrapper for toastOrderProcessor.ts
-- p_order_guid is intentionally ignored - this performs a full restaurant sync.
-- TODO: Update toastOrderProcessor.ts to call sync_toast_to_unified_sales directly.
CREATE OR REPLACE FUNCTION toast_sync_financial_breakdown(
  p_order_guid TEXT,  -- Unused, kept for signature compatibility
  p_restaurant_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Ignores p_order_guid; syncs all orders for restaurant
  RETURN sync_toast_to_unified_sales(p_restaurant_id);
END;
$$;


-- =====================================================
-- SECTION 4: Scheduled Cron Job
-- =====================================================

-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant usage to postgres (required for cron jobs)
GRANT USAGE ON SCHEMA cron TO postgres;

-- Remove existing job if present (for idempotency)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'toast-bulk-sync') THEN
    PERFORM cron.unschedule('toast-bulk-sync');
  END IF;
END $$;

-- Schedule bulk sync every 6 hours (3 AM, 9 AM, 3 PM, 9 PM)
-- Provides 4 sync opportunities per day without overloading Toast API
SELECT cron.schedule(
  'toast-bulk-sync',
  '0 3,9,15,21 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/toast-bulk-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Document the sync strategy
COMMENT ON EXTENSION pg_cron IS 'Toast POS sync runs every 6 hours to:
- Stay within Toast API rate limits (max 5 req/sec per restaurant)
- Catch missed orders between sync windows
- Handle order modifications after initial creation
- Provide reasonable freshness (6 hour max lag) for P&L reporting';


-- =====================================================
-- SECTION 5: Unified Sales Aggregation Cron (5 min)
-- =====================================================
-- Runs every 5 minutes to aggregate toast_orders into unified_sales
-- This ensures users see their imported data quickly without waiting
-- for the 6-hour bulk sync cycle.

-- Enable pg_net for HTTP requests (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Add sync_page column to track page cursor within a date range
-- This prevents missing orders when a single day has more orders than MAX_ORDERS_PER_REQUEST
ALTER TABLE toast_connections
ADD COLUMN IF NOT EXISTS sync_page INTEGER DEFAULT 1;

COMMENT ON COLUMN toast_connections.sync_page IS
  'Page cursor for initial sync pagination. Tracks which page within the current sync_cursor day. Reset to 1 when moving to the next day.';

-- Function to sync all active Toast connections to unified_sales
-- Uses full sync (no date filter) to handle historical backfills properly
CREATE OR REPLACE FUNCTION sync_all_toast_to_unified_sales()
RETURNS TABLE(restaurant_id UUID, orders_synced INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_connection RECORD;
  v_synced INTEGER;
BEGIN
  -- Loop through all active Toast connections
  FOR v_connection IN
    SELECT tc.restaurant_id
    FROM public.toast_connections tc
    WHERE tc.is_active = true
  LOOP
    BEGIN
      -- Sync ALL orders for this restaurant (no date filter)
      -- This handles both incremental updates and historical backfills
      SELECT sync_toast_to_unified_sales(v_connection.restaurant_id) INTO v_synced;

      restaurant_id := v_connection.restaurant_id;
      orders_synced := v_synced;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      -- Log error but continue with other restaurants
      RAISE WARNING 'Failed to sync restaurant %: %', v_connection.restaurant_id, SQLERRM;
    END;
  END LOOP;

  RETURN;
END;
$$;

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION sync_all_toast_to_unified_sales() TO service_role;

-- Unschedule existing job if it exists (for idempotent migrations)
DO $$
BEGIN
  PERFORM cron.unschedule('toast-unified-sales-sync');
EXCEPTION WHEN OTHERS THEN
  -- Job doesn't exist, that's fine
END;
$$;

-- Schedule unified_sales sync every 5 minutes
-- This aggregates toast_orders into unified_sales for all active connections
SELECT cron.schedule(
  'toast-unified-sales-sync',
  '*/5 * * * *',
  $$SELECT sync_all_toast_to_unified_sales()$$
);

COMMENT ON FUNCTION sync_all_toast_to_unified_sales IS
  'Aggregates toast_orders to unified_sales for all active Toast connections. Runs every 5 minutes via cron. Uses full sync (no date filter) to ensure historical backfills are properly synced.';
