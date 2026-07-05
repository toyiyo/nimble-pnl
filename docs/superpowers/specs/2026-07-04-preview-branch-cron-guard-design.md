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
| `process-weekly-brief-queue` | every minute | hardcoded prod URL + anon-key auth fallback (live fn def is `20260217031454`, which replaced the unset-GUC version) | Runs, but dispatches only when pgmq `weekly_brief_jobs` has messages — empty on previews (no restaurants/sales), so no observed prod traffic. Cron unscheduled off-prod by §F; the SECURITY DEFINER fn's default PUBLIC EXECUTE closed by §H. |
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
  3. No migration executes an INSERT against `restaurants` at apply time — the
     four `INSERT INTO public.restaurants` occurrences in migration history are
     all inside `create_restaurant_*()` RPC function bodies, which only run
     when a user invokes them.
  Therefore, at the instant this migration runs: **prod has restaurants rows
  older than 90 days; no preview branch or local stack can.** A preview starts
  empty (`list_branches` confirms `with_data: false`), so any row created
  there has `created_at` ≥ the branch's own creation time — and per-PR
  previews live days-to-weeks (observed max: 43 days). Prod verified
  2026-07-04 via prod SQL: 30 of 35 restaurants are >90 days old, oldest
  2025-09-15 (~10 months of margin).

  The **≥90-day age qualification** (added after the Phase 7 Codex finding)
  covers the one ordering bare `EXISTS(restaurants)` got wrong: a preview
  branch created before this migration existed, that accumulated a QA-created
  restaurant, and only later received this migration via rebase — bare EXISTS
  would have latched it to "production"; the age bar cannot be met there.

The migration snapshots that fact into a durable marker. The runtime guard
reads the **marker**, never live data — nothing a preview user does after
migration-apply time (manual QA, E2E) can flip the environment to
"production". Wrong-latch remedy, should it ever be needed:
`DELETE FROM public.deploy_env WHERE key = 'environment'`.

## Design

One new migration `supabase/migrations/20260705120000_cron_env_guard.sql`.
It opens with `CREATE EXTENSION IF NOT EXISTS pg_cron; CREATE EXTENSION IF NOT
EXISTS pg_net;` (belt-and-braces — every plausible apply order already has
them, but every other cron-touching migration in this repo follows the same
defensive pattern).

**Atomicity note:** `cron.schedule`/`cron.unschedule` are plain writes to the
`cron.job` table in pg_cron 1.6.x (Supabase's version) and are transactional;
`supabase db push` applies each migration file in one transaction, so a
mid-file failure rolls back both the unschedules and the marker seed — no
partial state where old jobs are gone and new ones missing (the #581 failure
class). The plan includes an explicit local verification step for this
(injected-error rollback test) rather than trusting the assumption.

### A. Marker table

```sql
CREATE TABLE IF NOT EXISTS public.deploy_env (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Defends is_production()'s exact string match against a manual
  -- UPDATE ... SET value='prod' typo.
  CONSTRAINT deploy_env_environment_value_check
    CHECK (key <> 'environment' OR value = 'production')
);
ALTER TABLE public.deploy_env ENABLE ROW LEVEL SECURITY;
-- Internal state: zero client policies (same pattern as focus_datafeed_state).
REVOKE ALL ON public.deploy_env FROM PUBLIC, anon, authenticated;
```

### B. Self-seeding (the one-time environment decision)

```sql
INSERT INTO public.deploy_env (key, value)
SELECT 'environment', 'production'
WHERE EXISTS (
  SELECT 1 FROM public.restaurants
  WHERE created_at < now() - interval '90 days'
)
ON CONFLICT (key) DO NOTHING;
```

Runs in the same transaction as the cron rewrap — prod flips atomically with
zero gap; previews/local never seed the row (their restaurants rows, if any,
are always younger than the branch itself; the 90-day bar is >2× the longest
observed preview lifetime, while prod passes with ~10 months of margin).

### C. Runtime guard

```sql
CREATE OR REPLACE FUNCTION public.is_production()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.deploy_env
    WHERE key = 'environment' AND value = 'production'
  )
$$;
REVOKE ALL ON FUNCTION public.is_production() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_production() TO service_role;
```

**SECURITY DEFINER is required, not stylistic** (Phase 7 ocr-rules finding):
`service_role` is granted EXECUTE but has zero table privileges on the
RLS-locked `deploy_env`, so an invoker-rights version errors
(`permission denied for table deploy_env`) instead of returning the
documented fail-safe `false` — same pattern and fix as
`focus_due_sync_count()` reading the RLS-locked `focus_datafeed_state`.
Safe: fixed, parameterless, read-only body. **Fail-safe direction (code
comment in migration):** if this function cannot read the marker for any
privilege/RLS reason it returns `false` — i.e. errs toward "non-production",
which no-ops crons rather than firing at prod. A future permission change
must not flip that direction.

### D. Central dispatch helpers — the single source of the prod URL

Split URL-building from dispatch so URL correctness is testable without ever
invoking `net.http_post` (design-review fix — tests must not depend on pg_net
internals like `net.http_request_queue`, whose schema is version-dependent):

```sql
CREATE OR REPLACE FUNCTION public.cron_edge_url(p_function text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_function !~ '^[a-z0-9-]+$' THEN
    RAISE EXCEPTION 'cron_edge_url: invalid edge function name %', p_function;
  END IF;
  RETURN 'https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/' || p_function;
END;
$$;

CREATE OR REPLACE FUNCTION public.cron_invoke_edge(
  p_function   text,
  p_body       jsonb   DEFAULT '{}'::jsonb,
  p_timeout_ms integer DEFAULT 5000
) RETURNS bigint            -- net.http_post request id; NULL when skipped
LANGUAGE plpgsql VOLATILE
SET search_path = pg_catalog, public
AS $$ ... $$;
```

`cron_invoke_edge` behavior:
- FIRST validate + build: `v_url := public.cron_edge_url(p_function)` — a
  typo'd function name must raise in EVERY environment (so pgTAP/CI/preview
  catch it before prod ever runs it), not only in prod.
- Then if `NOT public.is_production()`: `RAISE LOG 'cron_invoke_edge: skipped %
  (non-production environment)'` and return NULL. The job "succeeds" quietly —
  no failed-run noise, and the log line answers "why doesn't my cron fire
  locally". (`RAISE LOG` is safe in cron context: it writes to the server log;
  pg_cron run status is unaffected.)
- Else `net.http_post(url := v_url,
  headers := '{"Content-Type": "application/json"}'::jsonb, body := p_body,
  timeout_milliseconds := p_timeout_ms)`.
- `net.http_post` is fire-and-forget: a timeout or 5xx from the edge function
  does NOT fail the cron job; check pg_net's response log (`net._http_response`)
  for delivery status, not `cron.job_run_details` (on-call note).
- `REVOKE ALL ... FROM PUBLIC, anon, authenticated` on both functions —
  REQUIRED: the workers are deliberately gate-less (`verify_jwt=false`, no
  Bearer check), so client roles must not be able to use this function as a
  prod-worker trigger. Only the `postgres` owner (pg_cron) keeps EXECUTE.
- `search_path` pinned to `pg_catalog, public` on all three new functions per
  repo convention. (`net.http_post` is called schema-qualified — `net` is
  pg_net's fixed schema name — so it resolves independently of search_path.)

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
- Authoritative current definitions, for the next reader: `focus-backfill-sync`
  from `20260703120000_focus_backfill_reliability.sql`; `focus-bulk-sync`
  (schedule + fan-out) from `20260704200320_focus_sync_frequency.sql`
  (`20260705003631_focus_legacy_cron_no_claim_bump.sql` touches only the
  separate `focus-unified-sales-sync` job); `toast-bulk-sync` /
  `shift4-bulk-sync` from `20260127100000_shift4_lighthouse_sync_enhancements.sql`;
  `square-daily-sync` from `20251011012633_f9828423….sql`. Verified against a
  fresh local `db reset` (which mirrors what previews get).
- Unschedule-by-name converges prod regardless of whether its live jobs were
  hand-patched (e.g. the #581 mitigation precedent) or still carry the broken
  GUC form.
- toast/shift4 rewrap **restores their designed scheduled behavior** in prod
  (both currently error on the unset GUC). Both workers are built for
  scheduled invocation (bounded batches, round-robin), so this is a fix, not
  a behavior risk.
- The focus fan-out subquery runs on previews too, but returns ≥1 row of a
  no-op helper call — fine.

### E2. Close the client-callable RPC bypass (added by Phase 7 Codex pass 2)

`trigger_square_periodic_sync()` (from `20251011012229…`) hardcoded the prod
URL inside a SECURITY DEFINER RPC that still carried PostgreSQL's default
PUBLIC EXECUTE grant — any client role via PostgREST, and any preview/local
DB, could fire prod's Square sync around the cron guard. It has zero
application call sites (manual ops helper). Rewrapped:

```sql
CREATE OR REPLACE FUNCTION public.trigger_square_periodic_sync() ... AS $$
BEGIN
  PERFORM public.cron_invoke_edge('square-periodic-sync', '{"manual": true}'::jsonb);
END; $$;
REVOKE ALL ... FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ... TO service_role;
```

Environment guard + single URL source now apply to it; clients are locked
out; prod manual use (SQL editor / service role) keeps working.

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

### G. pgTAP tests — `supabase/tests/53_cron_env_guard.sql`

(53 is the next free sequence number — 26 is taken by
`26_get_pos_tips_by_date.sql`; latest is `52_focus_legacy_cron_no_claim_bump.sql`.)

Local `db reset` applies the migration to an empty DB, so the local state IS
the preview-branch state. **No test touches pg_net internals**
(`net.http_request_queue` schema is version-dependent, and a rollback-based
enqueue test would risk the exact prod-POST this design exists to prevent) —
URL correctness is tested via the pure `cron_edge_url()` instead, and the
non-prod path is proven by the NULL return (the guard short-circuits before
any HTTP work). Tests (inside `BEGIN…ROLLBACK`):

1. `deploy_env` exists, RLS enabled, zero policies; CHECK constraint rejects
   `('environment', 'prod')`.
2. Fresh non-prod state: marker row absent → `is_production()` = false.
3. Insert marker in-txn → `is_production()` = true (delete → false again).
3b. Seed-predicate semantics (Codex-finding coverage): a young restaurant
   row must NOT seed the marker (QA-on-preview ordering); a 100-day-old row
   must; state restored afterwards (all in-txn, rolled back).
4. `cron_invoke_edge('focus-bulk-sync')` while non-prod: returns NULL,
   `lives_ok` (no error, no failed-run noise).
5. `cron_edge_url('focus-backfill-sync')` returns exactly
   `https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/focus-backfill-sync`.
6. Invalid function names (`'a/b'`, `'x?y=1'`, `''`, mixed case) raise on
   `cron_edge_url` AND on `cron_invoke_edge` even while non-prod (validation
   precedes the environment guard, so a typo'd job name is caught in
   CI/local/preview — never first discovered in prod).
7. Cron wiring: the five jobs exist in `cron.job` with commands matching
   `%cron_invoke_edge%` and NOT matching `%ncdujvdgqtaunuyigflp%`; schedules
   unchanged (`*/5 * * * *`, even/odd-hours, `0 2 * * *`); the
   `focus-bulk-sync` command still contains the `generate_series` /
   `focus_due_sync_count` fan-out.
8. Non-prod unschedule: `sling-bulk-sync`, `trial-expiry-emails`,
   `process-weekly-brief-queue` absent from `cron.job` (locally the migration
   ran with no marker).
9. Privileges: `has_function_privilege('authenticated'|'anon', ..., 'EXECUTE')`
   = false for `cron_invoke_edge` and `cron_edge_url`; no client SELECT
   privilege on `deploy_env`.
10. §E2 closure: `trigger_square_periodic_sync()` — anon/authenticated cannot
   EXECUTE; body routes through `cron_invoke_edge` and no longer inlines the
   prod URL; `lives_ok` no-op while non-prod.
11. §H closure: `process_weekly_brief_queue()` — anon/authenticated cannot
   EXECUTE (client pump surface removed; internals untouched).

(53 assertions total.)

### H. CLAUDE.md pattern documentation

New subsection under Integrations/architecture docs:

> **pg_cron + edge functions:** never inline `net.http_post` with a project
> URL in a cron command. Schedule
> `$$SELECT public.cron_invoke_edge('<function-name>', '<body>'::jsonb)$$`
> instead — it holds the single hardcoded prod URL and no-ops on preview
> branches / local stacks (`public.is_production()` reads the `deploy_env`
> marker seeded at migration time from data presence). Pure-SQL cron bodies
> need no guard. If a future migration must `CREATE OR REPLACE` either
> function, re-issue the `REVOKE ALL ... FROM PUBLIC, anon, authenticated`
> line in the same migration — REPLACE preserves existing ACLs and does not
> reset them. If prod is ever rebuilt by replaying migrations onto an empty
> database, re-seed the marker manually
> (`INSERT INTO public.deploy_env (key, value) VALUES ('environment','production')`).

## Failure-mode analysis

| Scenario | Outcome |
|---|---|
| Prod deploy (GH Action `supabase db push`) | Marker seeds + jobs rewrap in one txn → at most one missed tick per job during the exact deploy minute, self-healing next tick (all five jobs are ≤6h-periodic, idempotent, fire-and-forget). |
| Migration fails mid-file on prod | Whole file rolls back (pg_cron 1.6 `cron.job` writes are transactional; one txn per migration file) → prior jobs intact. Verified locally via injected-error test (plan step). |
| New preview branch after merge | Migration runs on empty DB → no marker → helper no-ops from first tick. |
| Existing open PRs (previews already created) | Keep firing old hardcoded commands until the PR rebases onto main (previews apply only new migrations on new commits) or the PR closes. Ops note in PR; stale #510 preview flagged to user. |
| Local `npm run db:reset` | Same as preview — quiet. |
| Preview user creates a restaurant during QA (after this migration applied there) | Marker decision already made at migration time → still quiet. |
| Pre-existing preview accumulated a QA restaurant BEFORE receiving this migration (rebase ordering — Codex Phase 7 finding) | QA rows are younger than the branch itself (previews start empty; max observed lifetime 43 days) → the ≥90-day seed predicate stays false → still quiet. Deliberate `created_at` forgery is the only remaining path; remedy: `DELETE FROM public.deploy_env WHERE key='environment'`. |
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

## Design review (Phase 2.5, 2026-07-04)

`supabase-design-reviewer` ran against this doc (frontend reviewer skipped —
no UI surface). All findings folded in:

- **critical:** test file renamed `26_` → `53_` (26 taken; 52 is latest).
- **critical:** migration atomicity must be *verified*, not assumed → explicit
  injected-error rollback test added to the plan; atomicity note added above.
- **critical:** dropped the rollback-based `net.http_request_queue` enqueue
  test (pg_net internals are version-dependent; worst case the test itself
  POSTs at prod). Replaced with pure `cron_edge_url()` URL assertions.
- **major:** fail-safe direction comment on `is_production()`; `SET
  search_path = pg_catalog, public` pinned on all three functions;
  REVOKE-after-REPLACE warning added to the CLAUDE.md pattern; "zero gap"
  claim softened to "≤1 missed tick, self-healing".
- **minor:** restaurants-INSERT evidence reworded (4 hits, all in RPC bodies);
  authoritative-migration footnote added; fire-and-forget on-call note added;
  CHECK constraint on `deploy_env`; defensive `CREATE EXTENSION IF NOT
  EXISTS`; RAISE-LOG-in-cron safety noted.
- **decided during fold-in:** name validation runs BEFORE the environment
  guard in `cron_invoke_edge`, so typo'd job names fail in CI/local/preview
  instead of surfacing first in prod.

## Multi-model review (Phase 7, 2026-07-04)

Six reviewers ran against the implementation (security, performance,
maintainability, sound-logic: zero findings). Two findings, both
live-reproduced before fixing:

- **ocr-rules (major, fixed in-workflow):** `is_production()` was SECURITY
  INVOKER while only `service_role` gets EXECUTE — and `service_role` has no
  table privileges on RLS-locked `deploy_env`, so it errored
  (`permission denied`) instead of returning the documented fail-safe `false`.
  Fixed with `SECURITY DEFINER` (matches the `focus_due_sync_count()`
  precedent).
- **Codex (major, fixed post-workflow):** bare `EXISTS(restaurants)` seeding
  wrongly latched "production" on a pre-existing preview that accumulated a
  QA restaurant before receiving this migration (reproduced via incremental
  `supabase migration up` on a dirtied local DB). Resolution kept the approved
  mechanism and sharpened the predicate to `created_at < now() - interval
  '90 days'` — verified against prod (30/35 rows qualify, oldest 2025-09-15)
  and impossible on previews (rows can't predate the branch; max observed
  preview lifetime 43 days). pgTAP section 3b now pins both directions of the
  predicate.
- **Codex pass 2 (major, fixed):** after the predicate fix, a re-run surfaced
  `trigger_square_periodic_sync()` — a legacy SECURITY DEFINER RPC hardcoding
  the prod URL with default PUBLIC EXECUTE (client-callable prod-worker
  trigger + guard bypass; zero app call sites). Rewrapped through
  `cron_invoke_edge` + REVOKEd (design §E2, migration §G, pgTAP section 10).
- **CodeRabbit 7c (2 majors, fixed):** plan-doc drift — Task 2 still showed
  the pre-fix predicate and SECURITY INVOKER guard. Synced; iteration 2
  returned zero findings.
- **Independent re-verification agent:** RESOLVED verdict on the predicate
  fix across 5 attack vectors (created_at forgery paths, prod-side failure,
  E2E/pgTAP fixture collisions, test tautology).

## PR-review triage (Phase 9d, PR #583)

- **Codex GitHub bot (P2, fixed):** the live `process_weekly_brief_queue()`
  (def `20260217031454` — which replaced the unset-GUC version this doc
  originally described) hardcodes the prod URL + anon-key auth fallback,
  SECURITY DEFINER, default PUBLIC EXECUTE, no REVOKE anywhere — client roles
  could pump prod worker dispatches. Fixed by §H (REVOKE-only; internals left
  to the weekly-brief follow-up task). Jobs table above corrected accordingly.
- **CodeRabbit (minor, fixed):** §C snippet/prose still showed the pre-fix
  SECURITY INVOKER rationale; §G catalogue lacked the §E2/§H closure tests.
  Both synced.

## Test plan

- pgTAP suite above (`npm run test:db`).
- `npm run typecheck && npm run lint && npm run build` (no TS changes expected).
- After PR opens: the PR's own preview branch applies this migration —
  verify via branch action logs + prod edge logs that the new preview does
  NOT invoke prod workers on the next 5-minute ticks.
