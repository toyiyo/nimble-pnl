-- =====================================================
-- Focus POS backfill-sync pg_cron schedule
-- =====================================================
-- Adds the focus-backfill-sync cron job which is the durable engine for the
-- 90-day Lynk backfill. It runs every 5 minutes and processes only connections
-- where is_active=true AND initial_sync_done=false AND api_key IS NOT NULL.
-- No-op when all Lynk connections have finished backfilling (negligible steady-state cost).
--
-- The job uses current_setting('app.settings.service_role_key', true) with the
-- missing_ok flag so an unset GUC yields a graceful edge 401 (empty Bearer token)
-- rather than a cron-body exception.
--
-- Idempotent: unschedule guard runs before scheduling.
-- =====================================================

-- Ensure required extensions exist
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Grant cron schema usage to postgres (required for pg_cron job creation)
GRANT USAGE ON SCHEMA cron TO postgres;

-- ─────────────────────────────────────────────────────────────────────────────
-- focus-backfill-sync
-- Calls the focus-backfill-sync edge function via pg_net HTTP POST.
-- The edge function performs a Bearer-gated round-robin backfill of up to 5
-- active Lynk connections (is_active=true, initial_sync_done=false, api_key IS NOT NULL)
-- ordering by last_sync_time ASC NULLS FIRST.
-- Schedule: */5 * * * * (every 5 minutes — idiomatic for fast durable backfill)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'focus-backfill-sync') THEN
    PERFORM cron.unschedule('focus-backfill-sync');
  END IF;
END $$;

SELECT cron.schedule(
  'focus-backfill-sync',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.settings.supabase_url') || '/functions/v1/focus-backfill-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || coalesce(current_setting('app.settings.service_role_key', true), '')
    ),
    body    := '{}'::jsonb
  );
  $$
);
