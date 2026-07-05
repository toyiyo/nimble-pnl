# Preview-Branch Cron Guard — Implementation Plan

**Design:** `docs/superpowers/specs/2026-07-04-preview-branch-cron-guard-design.md`
(read it first — it contains the near-complete SQL for every object and the
folded design-review decisions).

**Branch:** `fix/preview-branch-cron-guard` (worktree
`.claude/worktrees/reverent-morse-11145b`).

**Environment notes for executors:**
- Local Supabase stack is RUNNING (ports 54321/54322, `psql -h localhost -p
  54322 -U postgres`, password `postgres`). pg_cron 1.6.4 + pg_net 0.20.3
  verified. All 13 legacy cron jobs currently exist locally.
- `.env.local` is symlinked into the worktree; `npm ci` already done.
- `npx supabase db reset` from the worktree replays THIS worktree's
  migrations into the local stack (safe — dev DB).
- pgTAP runner: `npm run test:db` (runs every `supabase/tests/*.sql`;
  `plan(N)` must match assertion count).

## Task 1 — pgTAP tests (RED)

Create `supabase/tests/53_cron_env_guard.sql` implementing design §G exactly
(9 groups; follow the style of `supabase/tests/51_focus_sync_scheduler.sql`
and `52_focus_legacy_cron_no_claim_bump.sql`: `BEGIN; SELECT plan(N); …
SELECT * FROM finish(); ROLLBACK;`). Key assertions:

1. `deploy_env` table exists; RLS enabled (`relrowsecurity`); zero policies
   (`pg_policies`); `throws_ok` inserting `('environment','prod')` (CHECK).
2. Marker absent on fresh local DB → `is_production()` false.
3. In-txn `INSERT ('environment','production')` → true; `DELETE` → false.
4. `lives_ok`: `cron_invoke_edge('focus-bulk-sync')` returns NULL while
   non-prod (`is( … , NULL::bigint)`).
5. `cron_edge_url('focus-backfill-sync')` =
   `'https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/focus-backfill-sync'`.
6. `throws_ok` for `cron_edge_url('a/b')`, `('x?y=1')`, `('')`, `('Foo')`;
   `throws_ok` for `cron_invoke_edge('a/b')` EVEN while non-prod (validation
   precedes the env guard).
7. `cron.job` wiring for the five jobs (`focus-backfill-sync`,
   `focus-bulk-sync`, `toast-bulk-sync`, `shift4-bulk-sync`,
   `square-daily-sync`): command `LIKE '%cron_invoke_edge%'`, command
   `NOT LIKE '%ncdujvdgqtaunuyigflp%'`, schedules unchanged
   (`*/5 * * * *`, `0 0,2,…,22 * * *`, `0 1,3,…,23 * * *`, `0 2 * * *`),
   and `focus-bulk-sync` command still contains `generate_series` and
   `focus_due_sync_count`.
8. `sling-bulk-sync`, `trial-expiry-emails`, `process-weekly-brief-queue`
   ABSENT from `cron.job` (non-prod unschedule ran locally).
9. `has_function_privilege` false for `anon` and `authenticated` on both
   `public.cron_invoke_edge(text,jsonb,integer)` and
   `public.cron_edge_url(text)`; `has_table_privilege` false for
   `anon`/`authenticated` SELECT on `deploy_env`.

RED check: run `npm run test:db` → file 53 must FAIL (objects don't exist
yet); all pre-existing files stay green. Commit the failing test.

## Task 2 — Migration (GREEN)

Create `supabase/migrations/20260705120000_cron_env_guard.sql` implementing
design §A–§F in order (SQL is spelled out in the design):

- Header comment: problem, mechanism, DR-rebuild re-seed instruction,
  REVOKE-after-REPLACE warning.
- `CREATE EXTENSION IF NOT EXISTS pg_cron;` / `pg_net;` + `GRANT USAGE ON
  SCHEMA cron TO postgres;` (matches sibling migrations).
- §A `deploy_env` (+ RLS + REVOKE + CHECK).
- §B self-seed `WHERE EXISTS (SELECT 1 FROM public.restaurants)`.
- §C `is_production()` (sql, STABLE, `SET search_path = pg_catalog, public`,
  fail-safe comment, REVOKE + GRANT service_role).
- §D `cron_edge_url()` (plpgsql IMMUTABLE, name regex `^[a-z0-9-]+$`) and
  `cron_invoke_edge()` (plpgsql VOLATILE; validate FIRST via cron_edge_url,
  then env-guard with RAISE LOG + NULL, else `net.http_post`); both
  `SET search_path = pg_catalog, public`; REVOKE both from PUBLIC, anon,
  authenticated.
- §E five idempotent unschedule-if-exists + `cron.schedule` blocks (exact
  schedules/commands in design table; square body
  `'{"scheduled": true}'::jsonb`).
- §F non-prod-only `DO` block unscheduling `sling-bulk-sync`,
  `trial-expiry-emails`, `process-weekly-brief-queue`.

GREEN check: `npx supabase db reset` (replays all migrations) then
`npm run test:db` → ALL files green including 53. Commit.

## Task 3 — Migration atomicity verification (design-review critical #2)

Not a pgTAP file — a one-off local proof, output pasted into the commit/PR:

```bash
# capture pre-state
psql "$LOCAL" -c "select jobname, left(command,60) from cron.job order by jobname" > /tmp/before.txt
# run the migration file + a forced error in ONE transaction (-1)
cat supabase/migrations/20260705120000_cron_env_guard.sql > /tmp/atomic.sql
echo 'SELECT 1/0;' >> /tmp/atomic.sql
psql "$LOCAL" -1 -f /tmp/atomic.sql ; # expect: division by zero, txn aborts
psql "$LOCAL" -c "select jobname, left(command,60) from cron.job order by jobname" > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt && echo "ATOMIC ✓ (no partial cron state)"
```

Run against the local stack AFTER a fresh `db reset` to pre-migration state —
i.e. temporarily `git stash` the migration, reset, unstash… simpler: run reset
with the migration renamed `.skip`, do the atomicity proof, rename back,
reset again, re-run test:db. Then `git commit` nothing (proof only) — paste
the diff-clean output into the Task 3 commit message or PR body.

## Task 4 — CLAUDE.md pattern documentation

Add to `CLAUDE.md` (near the Toast/POS integration section or a new
`### pg_cron jobs` subsection under Integrations): the §H text from the
design — never inline `net.http_post` + project URL in cron commands; use
`public.cron_invoke_edge('<fn>', '<body>'::jsonb)`; pure-SQL bodies need no
guard; REVOKE must be re-issued if a future migration REPLACEs the helper;
DR-rebuild re-seed instruction. Keep it short (≤15 lines) — CLAUDE.md is a
convention file, the design doc holds the full rationale. Commit.

## Task 5 — Drift sync + progress

If implementation deviated from the design doc anywhere, update the design
doc in the same PR (lessons: plan/spec pseudo-code must match shipped code).
Update `progress.md` phase status.

## Dependencies

Task 1 → Task 2 → Task 3 (needs the migration file) → Task 4/5 (independent,
after green).

## Verification gates (Phase 8, run from the worktree)

`npm run test` (vitest — should be untouched/green), `npm run test:db`,
`npm run typecheck`, `npm run lint`, `npm run build`. E2E only if the
workflow demands it (no app-code changes; migrations + SQL only).
