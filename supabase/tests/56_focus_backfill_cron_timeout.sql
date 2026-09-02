-- Tests for the focus-backfill-sync cron timeout raise
-- Migration: 20260901120000_focus_backfill_cron_timeout.sql
--
-- Test plan (6 tests):
--  1  focus-backfill-sync keeps the 5-minute schedule
--  2  focus-backfill-sync uses timeout_milliseconds := 120000
--  3  focus-backfill-sync no longer uses timeout_milliseconds := 5000
--  4  focus-backfill-sync keeps the hardcoded production URL
--  5  focus-bulk-sync keeps timeout_milliseconds := 5000 (unchanged)
--  6  focus-bulk-sync keeps the generate_series fan-out (unchanged)

BEGIN;
SELECT plan(6);

-- Test 1: the schedule is unchanged.
SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'focus-backfill-sync'),
  '*/5 * * * *',
  'focus-backfill-sync keeps the 5-minute schedule'
);

-- Test 2: the pg_net timeout now covers a full backfill run (50-90 s observed).
SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'focus-backfill-sync')
    ILIKE '%timeout_milliseconds := 120000%',
  'focus-backfill-sync uses timeout_milliseconds := 120000'
);

-- Test 3: the old 5 s timeout is gone. It aborted every run and the pg_net
-- retry started a duplicate worker (vendor HTTP 400, cosmetic last_error).
SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'focus-backfill-sync')
    NOT ILIKE '%timeout_milliseconds := 5000%',
  'focus-backfill-sync no longer uses timeout_milliseconds := 5000'
);

-- Test 4: the hardcoded URL survives the reschedule (GUC URLs no-op on Supabase).
SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'focus-backfill-sync')
    ILIKE '%https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/focus-backfill-sync%',
  'focus-backfill-sync keeps the hardcoded production URL'
);

-- Test 5: focus-bulk-sync is out of scope and keeps its 5 s timeout.
SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'focus-bulk-sync')
    ILIKE '%timeout_milliseconds := 5000%',
  'focus-bulk-sync keeps timeout_milliseconds := 5000'
);

-- Test 6: focus-bulk-sync keeps its intentional generate_series fan-out.
SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'focus-bulk-sync')
    ILIKE '%generate_series%',
  'focus-bulk-sync keeps the generate_series fan-out'
);

SELECT * FROM finish();
ROLLBACK;
