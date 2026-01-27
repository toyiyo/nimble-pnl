-- =====================================================
-- Toast Unified Sales Cron Job
-- =====================================================
-- Runs every 5 minutes to aggregate toast_orders into unified_sales
-- This ensures users see their imported data quickly without waiting
-- for the 6-hour bulk sync cycle.

-- Ensure pg_cron is enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Grant usage to postgres
GRANT USAGE ON SCHEMA cron TO postgres;

-- Function to sync all active Toast connections to unified_sales
CREATE OR REPLACE FUNCTION sync_all_toast_to_unified_sales()
RETURNS TABLE(restaurant_id UUID, orders_synced INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_connection RECORD;
  v_synced INTEGER;
  v_start_date DATE;
  v_end_date DATE;
BEGIN
  -- Process last 7 days to catch any missed orders
  v_start_date := CURRENT_DATE - INTERVAL '7 days';
  v_end_date := CURRENT_DATE + INTERVAL '1 day';

  -- Loop through all active Toast connections
  FOR v_connection IN
    SELECT tc.restaurant_id
    FROM public.toast_connections tc
    WHERE tc.is_active = true
  LOOP
    BEGIN
      -- Sync this restaurant's orders to unified_sales
      SELECT sync_toast_to_unified_sales(
        v_connection.restaurant_id,
        v_start_date,
        v_end_date
      ) INTO v_synced;

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
'Aggregates toast_orders to unified_sales for all active Toast connections.
Runs every 5 minutes via cron to ensure imported data appears quickly.
Uses date-range sync (last 7 days) to minimize CPU usage while catching any missed orders.';
