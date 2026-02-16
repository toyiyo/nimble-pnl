-- Idempotent: unschedule if it already exists
DO $$
BEGIN
  PERFORM cron.unschedule('generate-daily-briefs');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Schedule daily brief generation at 6:00 AM UTC
SELECT cron.schedule(
  'generate-daily-briefs',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/generate-daily-brief',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
