-- Shift4/Lighthouse Sync Enhancements
-- Adds bulk sync capabilities: sync tracking, health monitoring, and cron scheduling

-- Schema changes for shift4_connections

ALTER TABLE public.shift4_connections
  ADD COLUMN IF NOT EXISTS sync_cursor INTEGER DEFAULT 0;
COMMENT ON COLUMN public.shift4_connections.sync_cursor IS
  'Progress during initial 90-day sync (days completed). Reset to 0 when complete.';

ALTER TABLE public.shift4_connections
  ADD COLUMN IF NOT EXISTS initial_sync_done BOOLEAN DEFAULT FALSE;
COMMENT ON COLUMN public.shift4_connections.initial_sync_done IS
  'True after 90-day initial sync completes. Incremental syncs use 25-hour window.';

ALTER TABLE public.shift4_connections
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
COMMENT ON COLUMN public.shift4_connections.is_active IS
  'False when disabled. Bulk sync cron skips inactive connections.';

ALTER TABLE public.shift4_connections
  ADD COLUMN IF NOT EXISTS connection_status TEXT DEFAULT 'connected';
COMMENT ON COLUMN public.shift4_connections.connection_status IS
  'Health status: connected, error, disconnected.';

ALTER TABLE public.shift4_connections
  ADD COLUMN IF NOT EXISTS last_error TEXT;
COMMENT ON COLUMN public.shift4_connections.last_error IS
  'Last sync error message. NULL when healthy.';

ALTER TABLE public.shift4_connections
  ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ;

ALTER TABLE public.shift4_connections
  ADD COLUMN IF NOT EXISTS last_sync_time TIMESTAMPTZ;
COMMENT ON COLUMN public.shift4_connections.last_sync_time IS
  'Last successful sync timestamp. Used for round-robin ordering.';

UPDATE public.shift4_connections
SET is_active = TRUE
WHERE is_active IS NULL;

CREATE INDEX IF NOT EXISTS idx_shift4_connections_bulk_sync
  ON public.shift4_connections(is_active, last_sync_time ASC NULLS FIRST);


-- Sync function for data consistency (safety net)

CREATE OR REPLACE FUNCTION sync_all_shift4_to_unified_sales()
RETURNS TABLE(restaurant_id UUID, rows_synced INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_connection RECORD;
  v_synced INTEGER;
BEGIN
  -- Loop through all active Shift4 connections
  FOR v_connection IN
    SELECT sc.restaurant_id
    FROM public.shift4_connections sc
    WHERE sc.is_active = true
  LOOP
    BEGIN
      -- Call the existing sync function for this restaurant
      SELECT public.sync_shift4_to_unified_sales(v_connection.restaurant_id) INTO v_synced;

      restaurant_id := v_connection.restaurant_id;
      rows_synced := v_synced;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      -- Log error but continue with other restaurants
      RAISE WARNING 'Failed to sync Shift4 restaurant %: %', v_connection.restaurant_id, SQLERRM;
    END;
  END LOOP;

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_all_shift4_to_unified_sales() TO service_role;


-- Scheduled cron jobs

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
GRANT USAGE ON SCHEMA cron TO postgres;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'shift4-bulk-sync') THEN
    PERFORM cron.unschedule('shift4-bulk-sync');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'shift4-unified-sales-sync') THEN
    PERFORM cron.unschedule('shift4-unified-sales-sync');
  END IF;
END $$;

-- Shift4 bulk sync: every 2h at odd hours (offset from Toast at even hours)
SELECT cron.schedule(
  'shift4-bulk-sync',
  '0 1,3,5,7,9,11,13,15,17,19,21,23 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/shift4-bulk-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Shift4 unified_sales sync: every 5 minutes (safety net for data consistency)
SELECT cron.schedule(
  'shift4-unified-sales-sync',
  '*/5 * * * *',
  $$SELECT sync_all_shift4_to_unified_sales()$$
);


-- Update Toast cron to even hours (distributes load with Shift4 on odd hours)

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'toast-bulk-sync') THEN
    PERFORM cron.unschedule('toast-bulk-sync');
  END IF;
END $$;

SELECT cron.schedule(
  'toast-bulk-sync',
  '0 0,2,4,6,8,10,12,14,16,18,20,22 * * *',
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

COMMENT ON TABLE public.shift4_connections IS
  'Shift4/Lighthouse POS connections. Bulk sync at odd hours, Toast at even hours.';
