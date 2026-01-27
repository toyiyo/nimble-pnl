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
    -ABS(COALESCE((tp.raw_json->'refund'->>'refundAmount')::NUMERIC, 0)),
    -ABS(COALESCE((tp.raw_json->'refund'->>'refundAmount')::NUMERIC, 0)),
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

COMMENT ON FUNCTION sync_toast_to_unified_sales IS
  'Syncs Toast orders to unified_sales. Called by edge functions with service role.';

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
