-- Tests: legacy Focus crons must never write the claim scheduler's due-marker.
-- Migration: 20260705003631_focus_legacy_cron_no_claim_bump.sql
--
-- Background: last_sync_time became the claim scheduler's due-marker in
-- 20260704200320_focus_sync_frequency.sql. The legacy daily-report
-- aggregation job bumped it every 5 minutes ("Fix 2" round-robin advance),
-- which made `_focus_connection_is_due` permanently false and stopped ALL incremental
-- Focus ingestion in production. These tests pin that no aggregation-only
-- function touches the marker again.
--
-- NOTE (live pg_cron): the pgTAP database runs a real pg_cron, so the job is
-- (re)scheduled inside this rolled-back transaction before its schedule is
-- asserted (precedent: 50_categorization_backlog_drain.sql).

BEGIN;
SELECT plan(3);

-- 1. The legacy daily-report aggregator no longer bumps the due-marker.
SELECT ok(
  pg_get_functiondef('public.sync_all_focus_to_unified_sales()'::regprocedure)
    NOT LIKE '%SET last_sync_time%',
  'sync_all_focus_to_unified_sales() does not write last_sync_time (claim due-marker)'
);

-- 2. Belt-and-braces: the transactions aggregator never bumped it — pin that.
SELECT ok(
  pg_get_functiondef('public.sync_all_focus_transactions_to_unified_sales()'::regprocedure)
    NOT LIKE '%SET last_sync_time%',
  'sync_all_focus_transactions_to_unified_sales() does not write last_sync_time'
);

-- 3. The legacy job stays scheduled every 5 minutes (rescheduled in-txn,
--    immune to the live-cron race and to the manual prod mitigation).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'focus-unified-sales-sync') THEN
    PERFORM cron.unschedule('focus-unified-sales-sync');
  END IF;
  PERFORM cron.schedule(
    'focus-unified-sales-sync',
    '*/5 * * * *',
    'SELECT public.sync_all_focus_to_unified_sales()'
  );
END $$;
SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'focus-unified-sales-sync'),
  '*/5 * * * *',
  'focus-unified-sales-sync remains scheduled every 5 minutes'
);

SELECT * FROM finish();
ROLLBACK;
