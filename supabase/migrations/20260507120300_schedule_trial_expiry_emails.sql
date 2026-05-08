-- Daily cron for the trial-expiry-emails worker.
-- Fires at 09:00 UTC every day. The edge function does its own dedupe via
-- trial_emails_sent, so re-firing is safe. Runs on the same trial-day math
-- as the RPC (UTC-anchored).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

GRANT USAGE ON SCHEMA cron TO postgres;

-- Idempotency: drop any earlier registration before re-scheduling.
DO $$
BEGIN
  PERFORM cron.unschedule('trial-expiry-emails');
EXCEPTION
  WHEN OTHERS THEN
    -- job didn't exist; first deploy of this migration
    NULL;
END $$;

SELECT cron.schedule(
  'trial-expiry-emails',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/trial-expiry-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

COMMENT ON EXTENSION pg_cron IS
  'Trial-expiry email sequence runs daily at 09:00 UTC. RPC encapsulates day-window + dedupe.';
