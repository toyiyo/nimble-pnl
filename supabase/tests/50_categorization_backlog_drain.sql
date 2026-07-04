-- Tests for the deferred categorization backlog drain
-- Migration: 20260703090000_categorization_background_and_supplier_assign.sql (§7)
--
-- The original §7 drained the whole backlog synchronously inside the migration
-- and timed out production deploys (SQLSTATE 57014). It is now a bounded
-- 5-minute pg_cron tick that unschedules itself once converged.
--
-- Test plan (4 tests):
--  1  drain_categorization_backlog() exists
--  2  categorization-backlog-drain cron job exists on */5 * * * *
--  3  a tick on an empty database applies 0 rows (no error)
--  4  the converged (0-row) tick unschedules its own cron job

BEGIN;
SELECT plan(4);

-- Test 1: the drain function exists.
SELECT has_function(
  'public',
  'drain_categorization_backlog',
  'drain_categorization_backlog() exists'
);

-- Test 2: the drain cron job is scheduled every 5 minutes.
SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'categorization-backlog-drain'),
  '*/5 * * * *',
  'categorization-backlog-drain runs every 5 minutes'
);

-- Test 3: on an empty database (no rules/backlog) a tick applies 0 rows.
SELECT is(
  public.drain_categorization_backlog(),
  0,
  'a drain tick on an empty database applies 0 rows'
);

-- Test 4: that converged tick retired the cron job (self-unschedule).
SELECT ok(
  NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'categorization-backlog-drain'),
  'a converged (0-row) tick unschedules the categorization-backlog-drain job'
);

SELECT * FROM finish();
ROLLBACK;
