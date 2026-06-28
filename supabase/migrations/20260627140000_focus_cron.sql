-- =====================================================
-- Focus POS pg_cron schedules
-- =====================================================
-- Schedules:
--   focus-bulk-sync        — every 6 hours, at :30 of hours 1,7,13,19 UTC
--                            (offset from Toast 0 0,2,4,...,22 and Shift4 0 1,3,...,23)
--   focus-unified-sales-sync — every 5 minutes (mirrors toast/shift4 safety-net pattern)
--
-- Both jobs use unschedule guards (idempotent re-run).
-- =====================================================

-- Ensure required extensions exist
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Grant cron schema usage to postgres (required for pg_cron job creation)
GRANT USAGE ON SCHEMA cron TO postgres;

-- ─────────────────────────────────────────────────────────────────────────────
-- focus-bulk-sync
-- Calls the focus-bulk-sync edge function via pg_net HTTP POST.
-- The edge function performs a Bearer-gated round-robin sync of up to 5 active
-- focus_connections (ORDER BY last_sync_time ASC NULLS FIRST LIMIT 5).
-- Schedule: 30 1,7,13,19 * * * (every 6 hours, offset from Toast + Shift4)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'focus-bulk-sync') THEN
    PERFORM cron.unschedule('focus-bulk-sync');
  END IF;
END $$;

SELECT cron.schedule(
  'focus-bulk-sync',
  '30 1,7,13,19 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.settings.supabase_url') || '/functions/v1/focus-bulk-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- focus-unified-sales-sync
-- Calls sync_all_focus_to_unified_sales() every 5 minutes as a safety net so
-- newly fetched daily reports appear in unified_sales quickly without waiting
-- for the 6-hour bulk-sync cycle.
-- Schedule: */5 * * * *
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'focus-unified-sales-sync') THEN
    PERFORM cron.unschedule('focus-unified-sales-sync');
  END IF;
END $$;

SELECT cron.schedule(
  'focus-unified-sales-sync',
  '*/5 * * * *',
  $$SELECT sync_all_focus_to_unified_sales()$$
);
