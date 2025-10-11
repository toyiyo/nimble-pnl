-- SECURITY FIX: Remove hardcoded JWT token from Square cron job
-- The square-periodic-sync function has verify_jwt = false, so no Authorization header is needed

-- Unschedule the existing cron job
SELECT cron.unschedule('square-daily-sync');

-- Reschedule without the Authorization header
SELECT cron.schedule(
  'square-daily-sync',
  '0 2 * * *',
  $$
  select
    net.http_post(
        url:='https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/square-periodic-sync',
        headers:='{"Content-Type": "application/json"}'::jsonb,
        body:='{"scheduled": true}'::jsonb
    ) as request_id;
  $$
);