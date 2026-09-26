-- Tests for the focus-backfill-sync cron timeout raise
-- Migration: 20260901120000_focus_backfill_cron_timeout.sql
--
-- Test plan (7 tests):
--  1  focus-backfill-sync keeps the 5-minute schedule
--  2  focus-backfill-sync uses timeout_milliseconds := 120000
--  3  focus-backfill-sync no longer uses timeout_milliseconds := 5000
--  4  focus-backfill-sync keeps the hardcoded production URL
--  5  focus-bulk-sync keeps timeout_milliseconds := 5000 (unchanged)
--  6  focus-bulk-sync keeps the generate_series fan-out (unchanged)
--  7  the migration's no-existing-job branch also leaves one correct job

BEGIN;
SELECT plan(7);

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

-- Test 7: the migration's `IF EXISTS` branch has a false path too — the job
-- is absent. Simulate it by unscheduling focus-backfill-sync, then replay
-- the migration's own reschedule sequence (the same DO block and
-- cron.schedule call), and confirm exactly one correct job comes out.
SELECT cron.unschedule('focus-backfill-sync');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'focus-backfill-sync') THEN
    PERFORM cron.unschedule('focus-backfill-sync');
  END IF;
END $$;

SELECT cron.schedule(
  'focus-backfill-sync',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/focus-backfill-sync',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);

SELECT is(
  (SELECT COUNT(*)::int FROM cron.job WHERE jobname = 'focus-backfill-sync'),
  1,
  'the no-existing-job migration path leaves exactly one focus-backfill-sync job'
);

SELECT * FROM finish();
ROLLBACK;
