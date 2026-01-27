-- =====================================================
-- Create scheduled cron job for Toast POS sync
-- Runs every 6 hours to sync orders without overloading systems
-- =====================================================

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant usage to postgres (required for cron jobs)
GRANT USAGE ON SCHEMA cron TO postgres;

-- Create the cron job to call toast-bulk-sync edge function
-- Runs at 3 AM, 9 AM, 3 PM, 9 PM (every 6 hours)
-- This provides 4 sync opportunities per day without overloading Toast API
SELECT cron.schedule(
  'toast-bulk-sync',                    -- Job name
  '0 3,9,15,21 * * *',                 -- Every 6 hours (3 AM, 9 AM, 3 PM, 9 PM)
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/toast-bulk-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Add comment explaining the sync strategy
COMMENT ON EXTENSION pg_cron IS 'Toast POS sync runs every 6 hours to:
1. Stay within Toast API rate limits (max 5 req/sec per restaurant)
2. Catch any missed orders between sync windows
3. Handle edge cases where orders are modified after initial creation
4. Provide reasonable freshness (6 hour max lag) for P&L reporting

The toast-bulk-sync function:
- Syncs all active Toast connections
- Initial sync: imports last 90 days of orders
- Regular sync: imports orders since last sync + 1 hour buffer
- Rate limited: 250ms between API page requests
- Automatically refreshes OAuth tokens when expired';
