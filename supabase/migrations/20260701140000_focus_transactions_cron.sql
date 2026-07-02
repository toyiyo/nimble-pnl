-- =====================================================================
-- Focus POS transaction → unified_sales cron schedule
--
-- Adds a pg_cron job that calls sync_all_focus_transactions_to_unified_sales()
-- every 6 hours (offset from the existing focus-bulk-sync edge function call
-- and the focus-unified-sales-sync daily-reports job).
--
-- This is the safety-net that keeps unified_sales up-to-date for all
-- restaurants that use the Lynk datafeed (focus_orders / focus_order_items /
-- focus_payments tables). The bulk-sync edge function skips the RPC for large
-- imports; this cron picks those up with a short lag.
--
-- Schedule: 0 */6 * * * (every 6 hours, on the hour)
-- =====================================================================

-- Ensure required extensions exist (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant cron schema usage to postgres (required for pg_cron job creation)
GRANT USAGE ON SCHEMA cron TO postgres;

-- ─────────────────────────────────────────────────────────────────────────────
-- focus-transactions-unified-sales-sync
-- Calls sync_all_focus_transactions_to_unified_sales() every 6 hours to keep
-- the transaction-level unified_sales rows current for Lynk-enabled restaurants.
-- Uses unschedule guard for idempotent re-runs.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'focus-transactions-unified-sales-sync') THEN
    PERFORM cron.unschedule('focus-transactions-unified-sales-sync');
  END IF;
END $$;

SELECT cron.schedule(
  'focus-transactions-unified-sales-sync',
  '0 */6 * * *',
  $$SELECT sync_all_focus_transactions_to_unified_sales()$$
);
