-- Schedule sling-bulk-sync to run every 6 hours (at 3/9/15/21 UTC)
-- Offset from Toast (even hours) and Shift4 (odd hours) to distribute load

SELECT cron.schedule(
  'sling-bulk-sync',
  '0 3,9,15,21 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/sling-bulk-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
