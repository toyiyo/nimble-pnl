-- Enable the pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule daily Square sync at 2 AM UTC (runs every day at 2:00 AM)
SELECT cron.schedule(
  'square-daily-sync',
  '0 2 * * *',
  $$
  select
    net.http_post(
        url:='https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/square-periodic-sync',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.service_role_key', true) || '"}'::jsonb,
        body:='{"scheduled": true}'::jsonb
    ) as request_id;
  $$
);

-- Create a function to manually trigger periodic sync (useful for testing)
CREATE OR REPLACE FUNCTION public.trigger_square_periodic_sync()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT net.http_post(
    url := 'https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/square-periodic-sync',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.service_role_key', true) || '"}',
    body := '{"manual": true}'
  );
$$;