-- =====================================================
-- Focus POS crons: gate-less + URL-safe reschedule
-- =====================================================
-- Fixes two problems with the focus-backfill-sync and focus-bulk-sync cron jobs:
--
--   1. They built the target URL from current_setting('app.settings.supabase_url')
--      WITHOUT the missing_ok flag. That GUC is not set on this project (it uses
--      hardcoded URLs for the Toast/Shift4 crons instead), so every run threw
--      "unrecognized configuration parameter" and the backfill never ran in the
--      background — the whole 90-day import fell back to manual clicks.
--
--   2. They sent Authorization: Bearer <app.settings.service_role_key>, another
--      unset GUC. The focus-backfill-sync / focus-bulk-sync edge functions are now
--      gate-less (verify_jwt=false, no in-function Bearer check) — matching the
--      existing toast-bulk-sync / shift4-bulk-sync workers — so no service-role key
--      is needed in the cron. These workers only PULL the restaurant's own Focus
--      data via idempotent upserts.
--
-- URL sourcing: current_setting('app.settings.supabase_url', true) (missing_ok).
-- The `SELECT ... WHERE url <> ''` guard makes the job a NO-OP when the GUC is
-- unset (e.g. local dev), so a developer's local pg_cron can never cross-fire at
-- another environment. To enable in an environment, set the (NON-SECRET, public)
-- project URL once:
--     ALTER DATABASE postgres
--       SET app.settings.supabase_url = 'https://<project-ref>.supabase.co';
--
-- Idempotent: unschedule guards run before scheduling.
-- =====================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
GRANT USAGE ON SCHEMA cron TO postgres;

-- ─────────────────────────────────────────────────────────────────────────────
-- focus-backfill-sync — every 5 minutes (durable 90-day Lynk backfill engine)
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
  $cron$
  SELECT net.http_post(
    url     := current_setting('app.settings.supabase_url', true) || '/functions/v1/focus-backfill-sync',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 5000
  )
  WHERE coalesce(current_setting('app.settings.supabase_url', true), '') <> '';
  $cron$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- focus-bulk-sync — every 6 hours at :30 of 1,7,13,19 UTC (incremental worker)
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
  $cron$
  SELECT net.http_post(
    url     := current_setting('app.settings.supabase_url', true) || '/functions/v1/focus-bulk-sync',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 5000
  )
  WHERE coalesce(current_setting('app.settings.supabase_url', true), '') <> '';
  $cron$
);
