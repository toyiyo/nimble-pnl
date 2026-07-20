-- =====================================================
-- Revel Bulk Sync Cron
-- =====================================================
-- Schedules revel-bulk-sync every 6 hours, offset from the Toast cron
-- (:20 past the hour). Uses the exact same net.http_post mechanism as the
-- Toast bulk-sync cron job (20260127000000_toast_sync_improvements.sql):
-- current_setting('app.settings.supabase_url') / ('app.settings.service_role_key')
-- for URL + Authorization header. Only job name, schedule, and function path differ.
-- =====================================================

-- Enable pg_cron extension (idempotent; already enabled by Toast migration, but
-- safe to repeat)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant usage to postgres (required for cron jobs)
GRANT USAGE ON SCHEMA cron TO postgres;

-- Remove existing job if present (for idempotency)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'revel-bulk-sync') THEN
    PERFORM cron.unschedule('revel-bulk-sync');
  END IF;
END $$;

-- Schedule bulk sync every 6 hours at :20 past, offset from the Toast cron
-- (0 3,9,15,21 * * *) to avoid both POS syncs hammering the DB/API at once.
SELECT cron.schedule(
  'revel-bulk-sync',
  '20 */6 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/revel-bulk-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
