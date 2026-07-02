-- Tests for Focus POS backfill-specific pg_cron schedule
-- Migration: 2026070212xxxx_focus_backfill_cron.sql
--
-- Test plan:
--  1  focus-backfill-sync job exists in cron.job
--  2  focus-backfill-sync schedule is every 5 minutes (*/5 * * * *)

BEGIN;
SELECT plan(2);

-- Test 1: focus-backfill-sync job exists
SELECT ok(
  EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'focus-backfill-sync'),
  'cron job focus-backfill-sync exists'
);

-- Test 2: focus-backfill-sync schedule is every 5 minutes
SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'focus-backfill-sync'),
  '*/5 * * * *',
  'focus-backfill-sync runs every 5 minutes (*/5 * * * *)'
);

SELECT * FROM finish();
ROLLBACK;
