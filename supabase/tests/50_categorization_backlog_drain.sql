-- Tests for the standing categorization backlog sweep
-- Migrations: 20260703090000 (§7, original), 20260804090700 (convergence guard),
--             20260804091000 (standing sweep — retirement removed)
--
-- The original §7 drained the whole backlog synchronously inside the migration
-- and timed out production deploys (SQLSTATE 57014). It became a bounded
-- 5-minute pg_cron tick that unschedules itself once converged — which stranded
-- every categorization path not wired into a sync function. It is now a
-- PERMANENT 5-minute tick that never retires.
--
-- Test plan (10 tests):
--  1  drain_categorization_backlog() exists
--  2  the drain job can be (re)scheduled on */5 * * * *
--  3  anon cannot execute the SECURITY DEFINER drain (PUBLIC revoked)
--  4  authenticated cannot execute it either
--  5  a tick on an empty database applies 0 rows (no error)
--  6  that converged tick leaves its own cron job scheduled
--  7  categorization_rules_watermark returns the newest active-rule timestamp
--  8  categorization_rules_watermark is NULL when no active rule covers the scope
--  9  a tick with a backlog waiting leaves the job scheduled
-- 10  a tick that exhausts the backlog still leaves the job scheduled
--
-- Tests 6 and 10 are the inverted forms of assertions that pinned the old
-- self-retirement. They are the regression guard for the 2026-07-04 strand:
-- if retirement ever returns, both fail.

BEGIN;
SELECT plan(10);

-- Test 1: the drain function exists.
SELECT has_function(
  'public',
  'drain_categorization_backlog',
  'drain_categorization_backlog() exists'
);

-- (Re)schedule the job inside this transaction — idempotent with the
-- migration-time schedule and immune to the live-cron race described above.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'categorization-backlog-drain') THEN
    PERFORM cron.unschedule('categorization-backlog-drain');
  END IF;
  PERFORM cron.schedule(
    'categorization-backlog-drain',
    '*/5 * * * *',
    'SELECT public.drain_categorization_backlog()'
  );
END $$;

-- Test 2: the drain job is scheduled every 5 minutes.
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

-- ---------------------------------------------------------------------------
-- Retirement guard (20260804090700). v_claimed = 0 is NOT sufficient to retire:
-- the sweeps claim FOR UPDATE SKIP LOCKED, so a concurrent sweep holding the
-- last candidates makes a tick claim 0 while the backlog is still there. The
-- drain now also proves no claimable candidate remains. Tests 9/10 pin both
-- directions — it must not retire with work left, and must still retire once
-- there is none (a guard that is too wide would never converge).
-- ---------------------------------------------------------------------------

INSERT INTO restaurants (id, name) VALUES
  ('bbbbbbbb-0000-0000-0000-0000000000a1', 'Drain Guard Restaurant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO chart_of_accounts
  (id, restaurant_id, account_name, account_code, account_type, account_subtype, normal_balance)
VALUES
  ('bbbbbbbb-0000-0000-0000-0000000000c1', 'bbbbbbbb-0000-0000-0000-0000000000a1',
   'Food Sales', '4000', 'revenue', 'sales', 'credit')
ON CONFLICT (id) DO NOTHING;

INSERT INTO categorization_rules
  (id, restaurant_id, rule_name, applies_to, category_id, item_name_pattern,
   item_name_match_type, is_active, auto_apply, priority, created_at, updated_at)
VALUES
  ('bbbbbbbb-0000-0000-0000-0000000000f1', 'bbbbbbbb-0000-0000-0000-0000000000a1',
   'Drain guard rule', 'pos_sales', 'bbbbbbbb-0000-0000-0000-0000000000c1',
   'Guard Me', 'exact', true, true, 10,
   '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- Test 7: the shared watermark sees an active rule regardless of auto_apply,
-- because the MATCHERS ignore auto_apply. A watermark narrower than the
-- matcher's rule set is a silent permanent missed match.
SELECT is(
  public.categorization_rules_watermark(
    'bbbbbbbb-0000-0000-0000-0000000000a1', 'pos_sales'),
  '2026-01-01T00:00:00Z'::timestamptz,
  'categorization_rules_watermark returns the newest active-rule timestamp'
);

-- Test 8: no active rule for the scope means nothing can match, signalled as
-- NULL — which also makes the drain's leftover check skip the restaurant.
SELECT is(
  public.categorization_rules_watermark(
    'bbbbbbbb-0000-0000-0000-0000000000a1', 'bank_transactions'),
  NULL,
  'categorization_rules_watermark is NULL when no active rule covers the scope'
);

-- Two candidates, neither evaluated (rules_evaluated_at defaults to -infinity).
-- One matches the rule, one does not — so the drain must not treat "applied
-- nothing more" as "drained".
SELECT set_config('app.skip_unified_sales_triggers', 'true', true);

INSERT INTO unified_sales
  (id, restaurant_id, pos_system, external_order_id, item_name, quantity,
   sale_date, total_price)
VALUES
  ('bbbbbbbb-0000-0000-0000-0000000000d1', 'bbbbbbbb-0000-0000-0000-0000000000a1',
   'toast', 'ord-guard-1', 'Guard Me', 1, CURRENT_DATE, 10.00),
  ('bbbbbbbb-0000-0000-0000-0000000000d2', 'bbbbbbbb-0000-0000-0000-0000000000a1',
   'toast', 'ord-guard-2', 'Not In Any Rule', 1, CURRENT_DATE, 20.00)
ON CONFLICT (id) DO NOTHING;

SELECT set_config('app.skip_unified_sales_triggers', 'false', true);

-- Re-arm the job that test 6 retired, then stamp the backlog as unevaluated so
-- a tick has real work waiting for it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'categorization-backlog-drain') THEN
    PERFORM cron.schedule(
      'categorization-backlog-drain',
      '*/5 * * * *',
      'SELECT public.drain_categorization_backlog()'
    );
  END IF;
END $$;

-- Each tick runs as its OWN statement, never folded into the assertion as
-- `drain() >= 0 AND (NOT) EXISTS (...)`. The outer query scans cron.job under
-- the snapshot taken when the statement began, so a cron.unschedule() the
-- function performs inside that same command is invisible to it — the
-- combined form reads the pre-tick job list and silently tests nothing.

-- Test 9: a tick that still finds claimable candidates keeps the job alive.
SELECT public.drain_categorization_backlog();

SELECT ok(
  EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'categorization-backlog-drain'),
  'a tick with a backlog waiting does not retire the drain job'
);

-- Test 10: the previous tick stamped every candidate, so nothing claimable is
-- left and the next tick converges. Guards against a leftover check so wide
-- that unmatched rows keep the job scheduled forever.
SELECT public.drain_categorization_backlog();

SELECT ok(
  NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'categorization-backlog-drain'),
  'once every candidate is evaluated the drain still retires itself'
);

SELECT * FROM finish();
ROLLBACK;
