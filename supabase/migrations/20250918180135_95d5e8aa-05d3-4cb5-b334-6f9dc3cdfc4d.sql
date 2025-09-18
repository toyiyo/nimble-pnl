-- Fix function search path security issue
CREATE OR REPLACE FUNCTION public.trigger_square_periodic_sync()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT net.http_post(
    url := 'https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/square-periodic-sync',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jZHVqdmRncXRhdW51eWlnZmxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc5NjgyMTYsImV4cCI6MjA3MzU0NDIxNn0.mlrSpU6RgiQLzLmYgtwcEBpOgoju9fow-_8xv4KRSZw"}',
    body := '{"manual": true}'
  );
$$;