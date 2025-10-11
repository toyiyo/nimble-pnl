-- SECURITY FIX: Remove hardcoded JWT token from trigger_square_periodic_sync
-- The square-periodic-sync function has verify_jwt = false, so no Authorization header is needed

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