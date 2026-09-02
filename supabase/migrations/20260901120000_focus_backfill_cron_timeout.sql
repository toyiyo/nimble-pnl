-- =====================================================
-- Raise the focus-backfill-sync cron timeout to 120 s
-- Design: docs/superpowers/specs/2026-09-01-focus-backfill-cron-timeout-design.md
--
-- The 5 s pg_net timeout aborted every backfill run (50-90 s observed).
-- The pg_net retry then started a duplicate edge worker. Two workers
-- requested the same business date; the vendor returned HTTP 400 to one;
-- that worker wrote a cosmetic last_error on the connection row.
-- 120 s covers the slowest observed run and stays below the Supabase
-- request idle timeout (150 s).
--
-- WARNING: cron.unschedule + cron.schedule assigns a new jobid.
-- Key monitoring on jobname = 'focus-backfill-sync', not on the old id 28.
--
-- Verification note: Supabase's pg_net docs list timeout_milliseconds as a
-- plain int parameter with no documented upper bound
-- (https://supabase.com/docs/guides/database/extensions/pg_net). After this
-- migration ships, watch cron.job_run_details and the edge function logs
-- across one real backfill run (50-90 s) to confirm the request completes
-- and the duplicate-worker race is gone.
-- =====================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'focus-backfill-sync') THEN
    PERFORM cron.unschedule('focus-backfill-sync');
  END IF;
END $$;

SELECT cron.schedule(
  'focus-backfill-sync',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/focus-backfill-sync',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
