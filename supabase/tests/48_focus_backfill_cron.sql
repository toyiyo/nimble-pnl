-- Tests for Focus POS backfill-specific pg_cron schedule
-- Migrations: 20260702120000_focus_backfill_cron.sql (create)
--             20260702160000_focus_crons_gateless.sql (gate-less reschedule)
--
-- Test plan:
--  1  focus-backfill-sync job exists in cron.job
--  2  focus-backfill-sync schedule is every 5 minutes (*/5 * * * *)
--  3  gate-less: cron body sends NO Authorization header (no Bearer)
--  4  no dependency on the (unset) app.settings.service_role_key GUC

BEGIN;
SELECT plan(4);

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

-- Test 3: gate-less — the cron body must not send an Authorization header.
SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'focus-backfill-sync') NOT ILIKE '%Authorization%',
  'focus-backfill-sync cron sends no Authorization header (gate-less, matches toast/shift4)'
);

-- Test 4: no dependency on the unset service_role_key GUC (that broke every run).
SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'focus-backfill-sync') NOT ILIKE '%service_role_key%',
  'focus-backfill-sync cron does not read app.settings.service_role_key'
);

SELECT * FROM finish();
ROLLBACK;
