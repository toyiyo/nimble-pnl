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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Check if net schema exists (pg_net extension installed)
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'net') THEN
    -- Use EXECUTE to avoid syntax errors when net schema doesn't exist
    -- NOTE: No Authorization header needed - function has verify_jwt = false
    EXECUTE format(
      'SELECT net.http_post(
        url := %L,
        headers := %L,
        body := %L
      )',
      'https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/square-periodic-sync',
      '{"Content-Type": "application/json"}',
      '{"manual": true}'
    );
  ELSE
    -- Log notice if net schema not available (test environment)
    RAISE NOTICE 'pg_net extension not available, skipping HTTP request';
  END IF;
END;
$$;