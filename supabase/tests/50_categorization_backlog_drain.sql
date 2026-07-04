-- Tests for the deferred categorization backlog drain
-- Migration: 20260703090000_categorization_background_and_supplier_assign.sql (§7)
--
-- The original §7 drained the whole backlog synchronously inside the migration
-- and timed out production deploys (SQLSTATE 57014). It is now a bounded
-- 5-minute pg_cron tick that unschedules itself once converged.
--
-- Test plan (6 tests):
--  1  drain_categorization_backlog() exists
--  2  categorization-backlog-drain cron job exists on */5 * * * *
--  3  anon cannot execute the SECURITY DEFINER drain (PUBLIC revoked)
--  4  authenticated cannot execute it either
--  5  a tick on an empty database applies 0 rows (no error)
--  6  the converged (complete, error-free, 0-row) tick unschedules its own cron job

BEGIN;
SELECT plan(6);

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

-- Test 3/4: SECURITY DEFINER hardening — client roles cannot execute the drain.
SELECT ok(
  NOT has_function_privilege('anon', 'public.drain_categorization_backlog()', 'EXECUTE'),
  'anon cannot execute drain_categorization_backlog (PUBLIC revoked)'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.drain_categorization_backlog()', 'EXECUTE'),
  'authenticated cannot execute drain_categorization_backlog'
);

-- Test 5: on an empty database (no rules/backlog) a tick applies 0 rows.
SELECT is(
  public.drain_categorization_backlog(),
  0,
  'a drain tick on an empty database applies 0 rows'
);

-- Test 6: that complete, error-free, 0-row tick retired the cron job.
SELECT ok(
  NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'categorization-backlog-drain'),
  'a converged (complete + clean + 0-row) tick unschedules the drain job'
);

SELECT * FROM finish();
ROLLBACK;
