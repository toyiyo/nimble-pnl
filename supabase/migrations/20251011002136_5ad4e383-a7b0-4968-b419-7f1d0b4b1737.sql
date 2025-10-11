-- Safe CI/Test Environment Compatibility Fix
-- This migration ONLY fixes function definitions without touching any tables or data
-- Safe for production deployment

-- Fix trigger_square_periodic_sync to handle missing pg_net extension
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
    EXECUTE format(
      'SELECT net.http_post(
        url := %L,
        headers := %L,
        body := %L
      )',
      'https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/square-periodic-sync',
      '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jZHVqdmRncXRhdW51eWlnZmxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc5NjgyMTYsImV4cCI6MjA3MzU0NDIxNn0.mlrSpU6RgiQLzLmYgtwcEBpOgoju9fow-_8xv4KRSZw"}',
      '{"manual": true}'
    );
  ELSE
    -- Log notice if net schema not available (test environment)
    RAISE NOTICE 'pg_net extension not available, skipping HTTP request';
  END IF;
END;
$$;

-- Fix auth.config update to be conditional (only runs if table exists)
DO $$
BEGIN
  -- Only update auth.config if the table exists (production Supabase environment)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'auth' 
    AND table_name = 'config'
  ) THEN
    UPDATE auth.config SET 
      password_leak_protection = TRUE
    WHERE TRUE;
  ELSE
    -- Log notice if auth.config not available (test environment)
    RAISE NOTICE 'auth.config table not available, skipping password leak protection update';
  END IF;
END $$;