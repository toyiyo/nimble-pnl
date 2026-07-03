-- Tests for Focus POS pg_cron schedules
-- Migrations: 20260627140000_focus_cron.sql (create)
--             20260702160000_focus_crons_gateless.sql (gate-less reschedule)
--
-- Test plan:
--  1  focus-bulk-sync job exists in cron.job
--  2  focus-unified-sales-sync job exists in cron.job
--  3  focus-bulk-sync schedule is every 6 hours (offset from Toast/Shift4)
--  4  focus-unified-sales-sync schedule is every 5 minutes
--  5  gate-less: focus-bulk-sync cron body sends no Authorization header
--  6  focus-bulk-sync cron body has no app.settings.service_role_key dependency

BEGIN;
SELECT plan(6);

-- Test 1: focus-bulk-sync job exists
SELECT ok(
  EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'focus-bulk-sync'),
  'cron job focus-bulk-sync exists'
);

-- Test 2: focus-unified-sales-sync job exists
SELECT ok(
  EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'focus-unified-sales-sync'),
  'cron job focus-unified-sales-sync exists'
);

-- Test 3: focus-bulk-sync schedule is every 6 hours offset from Toast/Shift4
-- Toast runs at 0 0,2,4,...,22  (even hours on the hour)
-- Shift4 runs at 0 1,3,5,...,23 (odd hours on the hour)
-- Focus runs at 30 1,7,13,19   (every 6 hours, at :30 of hours 1,7,13,19)
SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'focus-bulk-sync'),
  '30 1,7,13,19 * * *',
  'focus-bulk-sync runs every 6 hours at offset schedule (30 1,7,13,19 * * *)'
);

-- Test 4: focus-unified-sales-sync schedule is every 5 minutes
SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'focus-unified-sales-sync'),
  '*/5 * * * *',
  'focus-unified-sales-sync runs every 5 minutes (*/5 * * * *)'
);

-- Test 5: gate-less — the focus-bulk-sync cron body must send no Authorization header
-- (reschedule migration 20260702160000 makes it match toast/shift4).
SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'focus-bulk-sync') NOT ILIKE '%Authorization%',
  'focus-bulk-sync cron sends no Authorization header (gate-less, matches toast/shift4)'
);

-- Test 6: no dependency on the unset service_role_key GUC (that broke every run).
SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'focus-bulk-sync') NOT ILIKE '%service_role_key%',
  'focus-bulk-sync cron does not read app.settings.service_role_key'
);

SELECT * FROM finish();
ROLLBACK;
