# Preview-Branch Cron Guard — Design

**Date:** 2026-07-04
**Author:** Claude (autonomous session, task from Jose)
**Status:** Approved direction from task description; details decided here

## Problem

Supabase preview branches (created per-PR by the GitHub integration) and local
`supabase db reset` stacks apply **all** migrations — including every
`cron.schedule(...)` call. Several cron commands `net.http_post` at the
hardcoded production project URL (`https://ncdujvdgqtaunuyigflp.supabase.co`),
because `ALTER DATABASE SET app.settings.*` is permission-denied on Supabase
and there is no in-database way to derive "my own" project URL.

Observed in prod edge logs on 2026-07-05: ~11 invocations of
`focus-bulk-sync` / `focus-backfill-sync` per 5-minute tick instead of 1 —
every open PR's preview DB fires its own pg_cron at prod's workers. Benign
today (workers are pull-only, gate-less, and the claim RPC is atomic so racing
workers no-op) but wasteful, confusing in logs, and a footgun if a future
worker is not race-safe.

### Which jobs actually cause the noise (verified against migration-defined commands)

| Job | Schedule | Command form | Fires from previews? |
|---|---|---|---|
| `focus-backfill-sync` | `*/5 * * * *` | hardcoded prod URL | **Yes** |
| `focus-bulk-sync` | `*/5 * * * *` × K fan-out | hardcoded prod URL | **Yes** |
| `square-daily-sync` | `0 2 * * *` | hardcoded prod URL | **Yes** (daily) |
| `toast-bulk-sync` | even hours | `current_setting('app.settings.supabase_url')` — **unset, no missing_ok** | No — job **errors** every run |
| `shift4-bulk-sync` | odd hours | same unset GUC | No — errors |
| `sling-bulk-sync` | 4×/day | same unset GUC | No — errors |
| `trial-expiry-emails` | daily 09:00 | same unset GUC | No — errors |
| `process-weekly-brief-queue` | every minute | same unset GUC (inside `process_weekly_brief_queue()`) | No — errors |
| pure-SQL jobs (`*-unified-sales-sync`, `categorization-backlog-drain`, `enqueue-weekly-briefs`) | various | local SQL only | Harmless everywhere |

Correction to the task premise: the toast/shift4 cron *commands in the repo*
use the unset GUC form, not a hardcoded URL — so they error rather than post.
The observed prod spam is the focus pair (+ square daily). The GUC-form jobs
are **latent prod bugs** (they error in prod too): partially addressed here
(toast/shift4 rewrap restores their designed behavior), rest flagged as
follow-ups.

## Investigation: what identifies a preview branch from inside Postgres?

Facts established (prod SQL + Supabase docs, 2026-07-04):

- **No official marker exists.** Docs describe no GUC/catalog value that says
  "this is a preview branch". `current_database()` is `postgres` everywhere.
- **`app.settings.*` GUCs:** `ALTER DATABASE ... SET` is permission-denied for
  the `postgres` role on Supabase. Prod's `pg_db_role_setting` contains only
  `app.settings.jwt_exp` (legacy platform artifact, undocumented, could vanish,
  unverifiable on previews). Existing crons that read `app.settings.supabase_url`
  error out — proof this mechanism is unusable.
- **`pg_control_system().system_identifier`:** constant for prod, different on
  previews (fresh clusters) — but changes on major PG upgrades (`pg_upgrade`
  re-initdbs), which would silently kill prod crons. Rejected.
- **Vault secret seeded only in prod:** viable (vault data is not copied to
  previews) but requires an out-of-band prod write before merge, and couples
  the guard to vault availability in every environment. Kept as fallback only.
- **Data presence at migration time — CHOSEN.** Three independent guarantees:
  1. Supabase branching docs: "No production data is copied to your Preview
     branch"; previews are seeded only from `supabase/seed.sql`.
  2. This repo has **no `seed.sql`**.
  3. No migration inserts rows into `public.restaurants` (all
     `INSERT INTO restaurants` hits are inside runtime RPC function bodies).
  Therefore, at the instant this migration runs: **prod has restaurants rows;
  a preview branch or fresh local stack has zero.** `list_branches` confirms
  previews are `with_data: false`.

The migration snapshots that fact into a durable marker. The runtime guard
reads the **marker**, never live data — a preview user creating a restaurant
later (manual QA, E2E) must not flip the environment to "production".

## Design

One new migration `supabase/migrations/20260705120000_cron_env_guard.sql`:

### A. Marker table

```sql
CREATE TABLE IF NOT EXISTS public.deploy_env (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.deploy_env ENABLE ROW LEVEL SECURITY;
-- Internal state: zero client policies (same pattern as focus_datafeed_state).
REVOKE ALL ON public.deploy_env FROM PUBLIC, anon, authenticated;
```

### B. Self-seeding (the one-time environment decision)

```sql
INSERT INTO public.deploy_env (key, value)
SELECT 'environment', 'production'
WHERE EXISTS (SELECT 1 FROM public.restaurants)
ON CONFLICT (key) DO NOTHING;
```

Runs in the same transaction as the cron rewrap — prod flips atomically with
zero gap; previews/local never seed the row.

### C. Runtime guard

```sql
CREATE OR REPLACE FUNCTION public.is_production()
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.deploy_env
    WHERE key = 'environment' AND value = 'production'
  )
$$;
REVOKE ALL ON FUNCTION public.is_production() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_production() TO service_role;
```

Security-invoker is fine: cron jobs run as `postgres` (table owner, bypasses
RLS); `service_role` has BYPASSRLS.

### D. Central dispatch helper — the single source of the prod URL

```sql
CREATE OR REPLACE FUNCTION public.cron_invoke_edge(
  p_function   text,
  p_body       jsonb   DEFAULT '{}'::jsonb,
  p_timeout_ms integer DEFAULT 5000
) RETURNS bigint            -- net.http_post request id; NULL when skipped
LANGUAGE plpgsql VOLATILE
AS $$ ... $$;
```

Behavior:
- `p_function` must match `^[a-z0-9-]+$` (defense against URL mangling), else
  raise exception.
- If `NOT public.is_production()`: `RAISE LOG 'cron_invoke_edge: skipped %
  (non-production environment)'` and return NULL. The job "succeeds" quietly —
  no failed-run noise, and the log line answers "why doesn't my cron fire
  locally".
- Else `net.http_post(url := '<prod-url>/functions/v1/' || p_function,
  headers := '{"Content-Type": "application/json"}', body := p_body,
  timeout_milliseconds := p_timeout_ms)`.
- `REVOKE ALL ... FROM PUBLIC, anon, authenticated` — REQUIRED: the workers
  are deliberately gate-less (`verify_jwt=false`, no Bearer check), so client
  roles must not be able to use this function as a prod-worker trigger.
  Only the `postgres` owner (pg_cron) keeps EXECUTE.

### E. Rewrap the five worker-invoking jobs (idempotent unschedule + schedule)

All five workers verified `verify_jwt = false` with no inbound Authorization
gate, so the no-auth helper preserves calling semantics:

| Job | Schedule (unchanged) | New command |
|---|---|---|
| `focus-backfill-sync` | `*/5 * * * *` | `SELECT public.cron_invoke_edge('focus-backfill-sync');` |
| `focus-bulk-sync` | `*/5 * * * *` | `SELECT public.cron_invoke_edge('focus-bulk-sync') FROM generate_series(1, LEAST(20, GREATEST(1, CEIL(public.focus_due_sync_count() / 5.0)))::int);` |
| `toast-bulk-sync` | `0 0,2,…,22 * * *` | `SELECT public.cron_invoke_edge('toast-bulk-sync');` |
| `shift4-bulk-sync` | `0 1,3,…,23 * * *` | `SELECT public.cron_invoke_edge('shift4-bulk-sync');` |
| `square-daily-sync` | `0 2 * * *` | `SELECT public.cron_invoke_edge('square-periodic-sync', '{"scheduled": true}'::jsonb);` |

Notes:
- Unschedule-by-name converges prod regardless of whether its live jobs were
  hand-patched (e.g. the #581 mitigation precedent) or still carry the broken
  GUC form.
- toast/shift4 rewrap **restores their designed scheduled behavior** in prod
  (both currently error on the unset GUC). Both workers are built for
  scheduled invocation (bounded batches, round-robin), so this is a fix, not
  a behavior risk.
- The focus fan-out subquery runs on previews too, but returns ≥1 row of a
  no-op helper call — fine.

### F. Non-prod-only: unschedule jobs that can never work off-prod

```sql
DO $$ BEGIN
  IF NOT public.is_production() THEN
    -- These read app.settings.* GUCs that are unset everywhere; off-prod they
    -- can never be fixed and only generate failed-run noise every tick.
    PERFORM cron.unschedule(jobname) FROM cron.job
     WHERE jobname IN ('sling-bulk-sync', 'trial-expiry-emails',
                       'process-weekly-brief-queue');
  END IF;
END $$;
```

Prod's copies stay untouched (they are pre-existing latent bugs, flagged as
follow-ups — fixing them needs a vault-stored service key, separate PR).

### G. pgTAP tests — `supabase/tests/26_cron_env_guard.sql`

Local `db reset` applies the migration to an empty DB, so the local state IS
the preview-branch state. Tests (inside `BEGIN…ROLLBACK`):

1. `deploy_env` exists, RLS enabled, zero policies.
2. Fresh non-prod state: marker row absent → `is_production()` = false.
3. Insert marker in-txn → `is_production()` = true (delete → false again).
4. `cron_invoke_edge('x')` while non-prod: returns NULL and leaves
   `net.http_request_queue` count unchanged (nothing enqueued).
5. With marker inserted in-txn: `cron_invoke_edge('focus-backfill-sync')`
   returns a request id and enqueues exactly one row with the expected URL —
   then ROLLBACK discards the queued row before pg_net's worker can send it
   (the worker only sees committed rows), so the test never actually posts.
6. Invalid function name (`'a/b'`) raises.
7. Cron wiring: the five jobs exist in `cron.job` with commands matching
   `%cron_invoke_edge%` and NOT matching `%ncdujvdgqtaunuyigflp%`.
8. Non-prod unschedule: `sling-bulk-sync`, `trial-expiry-emails`,
   `process-weekly-brief-queue` absent from `cron.job` (locally the migration
   ran with no marker).
9. Privileges: `has_function_privilege('authenticated', ..., 'EXECUTE')` =
   false for both functions; same for `anon`.

### H. CLAUDE.md pattern documentation

New subsection under Integrations/architecture docs:

> **pg_cron + edge functions:** never inline `net.http_post` with a project
> URL in a cron command. Schedule
> `$$SELECT public.cron_invoke_edge('<function-name>', '<body>'::jsonb)$$`
> instead — it holds the single hardcoded prod URL and no-ops on preview
> branches / local stacks (`public.is_production()` reads the `deploy_env`
> marker seeded at migration time from data presence). Pure-SQL cron bodies
> need no guard. If prod is ever rebuilt by replaying migrations onto an
> empty database, re-seed the marker manually.

## Failure-mode analysis

| Scenario | Outcome |
|---|---|
| Prod deploy (GH Action `supabase db push`) | Marker seeds + jobs rewrap in one txn → zero gap, crons keep firing. |
| New preview branch after merge | Migration runs on empty DB → no marker → helper no-ops from first tick. |
| Existing open PRs (previews already created) | Keep firing old hardcoded commands until the PR rebases onto main (previews apply only new migrations on new commits) or the PR closes. Ops note in PR; stale #510 preview flagged to user. |
| Local `npm run db:reset` | Same as preview — quiet. |
| Preview user creates a restaurant during QA | Marker decision already made at migration time → still quiet. |
| Prod DR rebuild (replay migrations on empty DB, then restore data) | Marker won't seed → crons quiet until manual re-seed (documented in migration header + CLAUDE.md). Better than the inverse failure (previews spamming prod silently). |
| Vault/branching platform changes | No dependency — guard uses only a plain table. |
| Future cron migration forgets the helper | CLAUDE.md pattern + this migration's header call it out; reviewer checklists (ocr rules) see CLAUDE.md. |
| `focus_due_sync_count()` on empty preview | Returns 0 → fan-out = 1 no-op call. |

## Security

- `deploy_env`: RLS on, no policies, REVOKE from client roles.
- `cron_invoke_edge`: REVOKE from PUBLIC/anon/authenticated (workers are
  gate-less by design; the helper must not become a client-reachable trigger).
- No secrets stored or read; no service-role key in migrations.
- `is_production()` exposed to service_role only (harmless bit, least privilege).

## Out of scope / follow-ups (to flag on PR)

1. `sling-bulk-sync`, `trial-expiry-emails`, `process-weekly-brief-queue`
   error in **prod** on the unset GUC (trial-expiry emails + weekly briefs are
   likely dead; `process-weekly-brief-queue` errors every minute). Fix needs a
   vault-stored service key + rewrap — separate PR.
2. Stale preview branches (PR #510 open since May) keep firing until
   closed/rebased — recommend closing or rebasing.
3. Consider a Supabase feature request: official "am I a preview branch?"
   marker.

## Test plan

- pgTAP suite above (`npm run test:db`).
- `npm run typecheck && npm run lint && npm run build` (no TS changes expected).
- After PR opens: the PR's own preview branch applies this migration —
  verify via branch action logs + prod edge logs that the new preview does
  NOT invoke prod workers on the next 5-minute ticks.
