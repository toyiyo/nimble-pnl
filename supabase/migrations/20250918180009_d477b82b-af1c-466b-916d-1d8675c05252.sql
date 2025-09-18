-- Enable required extensions for cron jobs and HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule daily Square sync at 2 AM UTC (runs every day at 2:00 AM)
SELECT cron.schedule(
  'square-daily-sync',
  '0 2 * * *',
  $$
  select
    net.http_post(
        url:='https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/square-periodic-sync',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jZHVqdmRncXRhdW51eWlnZmxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc5NjgyMTYsImV4cCI6MjA3MzU0NDIxNn0.mlrSpU6RgiQLzLmYgtwcEBpOgoju9fow-_8xv4KRSZw"}'::jsonb,
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
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jZHVqdmRncXRhdW51eWlnZmxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc5NjgyMTYsImV4cCI6MjA3MzU0NDIxNn0.mlrSpU6RgiQLzLmYgtwcEBpOgoju9fow-_8xv4KRSZw"}',
    body := '{"manual": true}'
  );
$$;