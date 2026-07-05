-- Tests for the preview-branch cron guard
-- Migration: 20260705120000_cron_env_guard.sql
-- Design: docs/superpowers/specs/2026-07-04-preview-branch-cron-guard-design.md
--
-- Background: Supabase preview branches and local `supabase db reset` stacks
-- apply every migration, including cron.schedule(...) calls that
-- net.http_post the hardcoded PRODUCTION project URL. This guard adds a
-- durable `deploy_env` marker (seeded ONLY when `restaurants` has rows OLDER
-- THAN 90 DAYS at migration-apply time — true only in prod: preview/local
-- rows can never predate the branch itself, and previews live days-to-weeks)
-- and a central dispatch helper
-- `cron_invoke_edge()` that no-ops off-prod, so preview/local crons never
-- reach prod's edge functions.
--
-- NOTE (live pg_cron): this pgTAP database runs a real pg_cron and, once the
-- GREEN migration lands, will already carry the migration-time cron.job rows
-- (mirroring what a fresh preview branch gets). Tests 7/8 read cron.job
-- directly rather than rescheduling in-txn (unlike 50/51/52) because the
-- exact command text IS the thing under test (must reference
-- cron_invoke_edge, must NOT contain the hardcoded prod URL) — rescheduling
-- with a stand-in body would defeat the assertion.
--
-- NOTE (non-prod state): this local/CI database has zero rows in
-- `public.restaurants` at migration-apply time (no seed.sql, no migration
-- INSERTs into restaurants outside RPC bodies), so `deploy_env` has no
-- 'environment' row here and `is_production()` is false — the same state a
-- fresh preview branch is in. Tests 2/3 additionally prove the marker
-- read/write semantics in-txn without depending on that global fact alone.

BEGIN;
SELECT plan(51);

-- ── 1: deploy_env table — existence, RLS, zero policies, CHECK constraint ───
SELECT has_table('public', 'deploy_env', 'public.deploy_env exists');

SELECT ok(
  (SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE c.relname = 'deploy_env' AND n.nspname = 'public'),
  'deploy_env has RLS enabled'
);

SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'deploy_env'),
  0,
  'deploy_env has zero client policies (service-role/postgres only)'
);

SELECT throws_ok(
  $$INSERT INTO public.deploy_env (key, value) VALUES ('environment', 'prod')$$,
  NULL,
  NULL,
  'CHECK constraint rejects environment value other than exactly ''production'' (typo guard)'
);

-- ── 2: fresh non-prod state — marker absent → is_production() false ────────
-- This local/CI database has no restaurants rows at migration-apply time, so
-- the migration's self-seed WHERE EXISTS(...) never inserted the marker row.
SELECT is(
  (SELECT count(*)::int FROM public.deploy_env WHERE key = 'environment'),
  0,
  'no environment marker row exists in this non-prod database'
);

SELECT is(
  public.is_production(),
  false,
  'is_production() is false with no marker row (fail-safe / correctly non-prod)'
);

-- ── 3: in-txn marker insert/delete flips is_production() both ways ─────────
INSERT INTO public.deploy_env (key, value) VALUES ('environment', 'production');

SELECT is(
  public.is_production(),
  true,
  'is_production() becomes true once the production marker is inserted'
);

DELETE FROM public.deploy_env WHERE key = 'environment';

SELECT is(
  public.is_production(),
  false,
  'is_production() reverts to false once the marker is deleted'
);

-- ── 3b: seed-predicate semantics — the migration's exact INSERT must ignore
--        young (QA/preview-age) restaurants and fire only for rows older than
--        90 days (the prod signature). Directly covers the Codex-review
--        ordering: pre-existing preview + QA restaurant + later migration
--        apply must NOT latch 'production'. RLS is no obstacle here (test
--        runs as postgres, the table owner); rollback discards everything.
INSERT INTO public.restaurants (name)
VALUES ('pgTAP young QA restaurant (rolled back)');

INSERT INTO public.deploy_env (key, value)
SELECT 'environment', 'production'
WHERE EXISTS (
  SELECT 1 FROM public.restaurants
  WHERE created_at < now() - interval '90 days'
)
ON CONFLICT (key) DO NOTHING;

SELECT is(
  (SELECT count(*)::int FROM public.deploy_env WHERE key = 'environment'),
  0,
  'seed predicate ignores restaurants younger than 90 days (QA-on-preview ordering cannot latch production)'
);

INSERT INTO public.restaurants (name, created_at)
VALUES ('pgTAP prod-age restaurant (rolled back)', now() - interval '100 days');

INSERT INTO public.deploy_env (key, value)
SELECT 'environment', 'production'
WHERE EXISTS (
  SELECT 1 FROM public.restaurants
  WHERE created_at < now() - interval '90 days'
)
ON CONFLICT (key) DO NOTHING;

SELECT is(
  (SELECT count(*)::int FROM public.deploy_env WHERE key = 'environment'),
  1,
  'seed predicate fires when a restaurant older than 90 days exists (prod signature)'
);

SELECT is(
  public.is_production(),
  true,
  'is_production() reflects the freshly seeded marker'
);

-- Restore the non-prod state the remaining sections depend on.
DELETE FROM public.deploy_env WHERE key = 'environment';
DELETE FROM public.restaurants WHERE name LIKE 'pgTAP %(rolled back)';

SELECT is(
  public.is_production(),
  false,
  'non-prod state restored after seed-predicate checks (marker removed)'
);

-- ── 4: cron_invoke_edge no-ops (returns NULL, no error) while non-prod ─────
SELECT lives_ok(
  $$SELECT public.cron_invoke_edge('focus-bulk-sync')$$,
  'cron_invoke_edge(''focus-bulk-sync'') does not raise while non-production'
);

SELECT is(
  public.cron_invoke_edge('focus-bulk-sync'),
  NULL::bigint,
  'cron_invoke_edge(''focus-bulk-sync'') returns NULL (skipped) while non-production'
);

-- ── 5: cron_edge_url builds the exact, single hardcoded prod URL ──────────
SELECT is(
  public.cron_edge_url('focus-backfill-sync'),
  'https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/focus-backfill-sync',
  'cron_edge_url(''focus-backfill-sync'') returns the exact prod edge-function URL'
);

-- ── 6: invalid edge-function names raise on cron_edge_url AND ─────────────
--       cron_invoke_edge, even while non-prod (validation precedes the
--       environment guard, so a typo is caught in CI/local/preview).
SELECT throws_ok(
  $$SELECT public.cron_edge_url('a/b')$$,
  NULL, NULL,
  'cron_edge_url rejects a function name containing a slash'
);

SELECT throws_ok(
  $$SELECT public.cron_edge_url('x?y=1')$$,
  NULL, NULL,
  'cron_edge_url rejects a function name containing a query string'
);

SELECT throws_ok(
  $$SELECT public.cron_edge_url('')$$,
  NULL, NULL,
  'cron_edge_url rejects an empty function name'
);

SELECT throws_ok(
  $$SELECT public.cron_edge_url('Foo')$$,
  NULL, NULL,
  'cron_edge_url rejects a mixed-case function name'
);

SELECT throws_ok(
  $$SELECT public.cron_invoke_edge('a/b')$$,
  NULL, NULL,
  'cron_invoke_edge rejects an invalid function name even while non-production (validation precedes the env guard)'
);

-- ── 7: cron.job wiring — the five rewrapped jobs use the helper, never the
--       hardcoded prod URL directly, and keep their original schedules ─────
SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'focus-backfill-sync') LIKE '%cron_invoke_edge%',
  'focus-backfill-sync command calls cron_invoke_edge'
);
SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'focus-backfill-sync') NOT LIKE '%ncdujvdgqtaunuyigflp%',
  'focus-backfill-sync command no longer inlines the hardcoded prod URL'
);
SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'focus-backfill-sync'),
  '*/5 * * * *',
  'focus-backfill-sync schedule unchanged at every 5 minutes'
);

SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'focus-bulk-sync') LIKE '%cron_invoke_edge%',
  'focus-bulk-sync command calls cron_invoke_edge'
);
SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'focus-bulk-sync') NOT LIKE '%ncdujvdgqtaunuyigflp%',
  'focus-bulk-sync command no longer inlines the hardcoded prod URL'
);
SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'focus-bulk-sync'),
  '*/5 * * * *',
  'focus-bulk-sync schedule unchanged at every 5 minutes'
);
SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'focus-bulk-sync') LIKE '%generate_series%',
  'focus-bulk-sync command retains the generate_series fan-out'
);
SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'focus-bulk-sync') LIKE '%focus_due_sync_count%',
  'focus-bulk-sync command retains the focus_due_sync_count() fan-out sizing'
);

SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'toast-bulk-sync') LIKE '%cron_invoke_edge%',
  'toast-bulk-sync command calls cron_invoke_edge'
);
SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'toast-bulk-sync') NOT LIKE '%ncdujvdgqtaunuyigflp%',
  'toast-bulk-sync command does not inline the hardcoded prod URL'
);
SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'toast-bulk-sync'),
  '0 0,2,4,6,8,10,12,14,16,18,20,22 * * *',
  'toast-bulk-sync schedule unchanged at even hours'
);

SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'shift4-bulk-sync') LIKE '%cron_invoke_edge%',
  'shift4-bulk-sync command calls cron_invoke_edge'
);
SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'shift4-bulk-sync') NOT LIKE '%ncdujvdgqtaunuyigflp%',
  'shift4-bulk-sync command does not inline the hardcoded prod URL'
);
SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'shift4-bulk-sync'),
  '0 1,3,5,7,9,11,13,15,17,19,21,23 * * *',
  'shift4-bulk-sync schedule unchanged at odd hours'
);

SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'square-daily-sync') LIKE '%cron_invoke_edge%',
  'square-daily-sync command calls cron_invoke_edge'
);
SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'square-daily-sync') NOT LIKE '%ncdujvdgqtaunuyigflp%',
  'square-daily-sync command no longer inlines the hardcoded prod URL'
);
SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'square-daily-sync'),
  '0 2 * * *',
  'square-daily-sync schedule unchanged at 02:00 daily'
);

-- ── 8: non-prod-only unschedule — these three jobs read an unset GUC and ───
--       can never work off-prod; this non-prod database must not carry them.
SELECT ok(
  NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sling-bulk-sync'),
  'sling-bulk-sync is unscheduled in this non-production database'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'trial-expiry-emails'),
  'trial-expiry-emails is unscheduled in this non-production database'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-weekly-brief-queue'),
  'process-weekly-brief-queue is unscheduled in this non-production database'
);

-- ── 9: privileges — client roles cannot invoke the guard/dispatch helpers
--       or read the marker table directly ──────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.cron_invoke_edge(text, jsonb, integer)', 'EXECUTE'),
  'anon cannot execute cron_invoke_edge'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.cron_invoke_edge(text, jsonb, integer)', 'EXECUTE'),
  'authenticated cannot execute cron_invoke_edge'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.cron_edge_url(text)', 'EXECUTE'),
  'anon cannot execute cron_edge_url'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.cron_edge_url(text)', 'EXECUTE'),
  'authenticated cannot execute cron_edge_url'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.deploy_env', 'SELECT'),
  'anon has no SELECT privilege on deploy_env'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.deploy_env', 'SELECT'),
  'authenticated has no SELECT privilege on deploy_env'
);

-- ── 10: client-callable RPC bypass closed — trigger_square_periodic_sync ───
--        (Codex pass-2 finding: the legacy SECURITY DEFINER RPC hardcoded the
--        prod URL and kept the default PUBLIC EXECUTE grant, so any client —
--        or any preview/local DB — could fire prod's Square sync around the
--        cron guard. Now routed through cron_invoke_edge and locked down.)
SELECT ok(
  NOT has_function_privilege('anon', 'public.trigger_square_periodic_sync()', 'EXECUTE'),
  'anon cannot execute trigger_square_periodic_sync (client bypass closed)'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.trigger_square_periodic_sync()', 'EXECUTE'),
  'authenticated cannot execute trigger_square_periodic_sync (client bypass closed)'
);
SELECT ok(
  (SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'trigger_square_periodic_sync')
    LIKE '%cron_invoke_edge%',
  'trigger_square_periodic_sync routes through cron_invoke_edge'
);
SELECT ok(
  (SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'trigger_square_periodic_sync')
    NOT LIKE '%ncdujvdgqtaunuyigflp%',
  'trigger_square_periodic_sync no longer inlines the hardcoded prod URL'
);
SELECT lives_ok(
  $$SELECT public.trigger_square_periodic_sync()$$,
  'trigger_square_periodic_sync no-ops without error while non-production'
);

SELECT * FROM finish();
ROLLBACK;
