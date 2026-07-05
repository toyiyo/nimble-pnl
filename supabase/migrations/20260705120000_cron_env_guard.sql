-- ═════════════════════════════════════════════════════════════════════════════
-- Preview-branch cron guard
--
-- Design: docs/superpowers/specs/2026-07-04-preview-branch-cron-guard-design.md
--
-- Problem: Supabase preview branches (per-PR) and local `supabase db reset`
-- stacks apply every migration, including every `cron.schedule(...)` call.
-- Several cron commands `net.http_post` a hardcoded PRODUCTION project URL
-- because `ALTER DATABASE ... SET app.settings.*` is permission-denied on
-- Supabase, so there is no in-database way to derive "my own" project URL.
-- Result observed in prod: every open PR's preview DB fires its own pg_cron
-- at prod's edge-function workers (~11x focus-bulk-sync/focus-backfill-sync
-- invocations per 5-minute tick instead of 1).
--
-- Mechanism (see design doc for full investigation): a durable marker table
-- `public.deploy_env` is seeded, ONCE, AT MIGRATION-APPLY TIME, iff
-- `public.restaurants` has rows OLDER THAN 90 DAYS. Only prod can satisfy
-- that predicate:
--   • prod (verified 2026-07-04 via prod SQL): 30 of 35 restaurants are
--     >90 days old; the oldest dates to 2025-09-15 (~10 months) — huge margin;
--   • previews/local start EMPTY (no seed.sql in this repo; no migration
--     INSERTs into restaurants outside RPC bodies; Supabase branching docs:
--     preview branches copy no production data), and any row created later
--     (manual QA, E2E) has created_at ≥ the branch's own creation time, so it
--     can never be older than the branch itself — and per-PR previews live
--     days-to-weeks (observed max 43 days), never 90.
-- The age qualification exists for one specific ordering (Codex review
-- finding): a preview branch created BEFORE this migration existed, that
-- accumulated a QA-created restaurant, and only later received this migration
-- via rebase — a bare EXISTS(restaurants) would have latched that preview to
-- "production". The runtime guard `public.is_production()` reads the MARKER,
-- never live data, so nothing a preview user does after migration-apply time
-- can flip an environment to "production".
-- Wrong-latch remedy (belt-and-braces; requires deliberate created_at forgery
-- to ever occur): DELETE FROM public.deploy_env WHERE key = 'environment';
--
-- The five worker-invoking cron jobs that build a hardcoded/broken prod URL
-- are rewrapped to go through `public.cron_invoke_edge(fn, body, timeout)` —
-- the single source of the prod URL, REVOKEd from client roles, no-ops
-- off-prod. Three jobs that read an unset `app.settings.*` GUC (and so can
-- NEVER work off-prod) are unscheduled in non-prod only; prod's copies are
-- untouched (pre-existing latent bugs, tracked as a follow-up).
--
-- DR-rebuild note: if prod is ever rebuilt by replaying migrations onto an
-- empty database (then restoring data separately), this migration will NOT
-- see restaurants rows and will NOT seed the marker — crons stay quiet until
-- a human re-seeds it manually:
--   INSERT INTO public.deploy_env (key, value) VALUES ('environment', 'production');
--
-- REVOKE-after-REPLACE warning: if a future migration `CREATE OR REPLACE`s
-- `is_production()`, `cron_edge_url()`, or `cron_invoke_edge()`, it MUST
-- re-issue the `REVOKE ALL ... FROM PUBLIC, anon, authenticated` line in the
-- SAME migration — `CREATE OR REPLACE FUNCTION` preserves the function body
-- change but does NOT reset previously granted/revoked ACLs, so skipping the
-- REVOKE would silently leave stale privileges rather than restore anything
-- unsafe — but never rely on that; always re-state the REVOKE explicitly.
--
-- Idempotent throughout: every reschedule is guarded by an unschedule-if-
-- exists check first, and every DDL/DML statement is safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
GRANT USAGE ON SCHEMA cron TO postgres;

-- ─────────────────────────────────────────────────────────────────────────────
-- §A. Marker table
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- §B. Self-seeding — the one-time environment decision, made ONLY here.
-- Runs in the SAME transaction as the cron rewrap below (one migration file
-- = one transaction under `supabase db push`), so prod flips atomically with
-- zero gap. The ≥90-day age qualification makes the predicate false on ANY
-- preview/local DB — including one that already accumulated QA-created
-- restaurants before receiving this migration (rows there can never be older
-- than the branch itself; previews live days-to-weeks). Prod passes with
-- ~10 months of margin (verified 2026-07-04: oldest restaurant 2025-09-15,
-- 30 rows >90d old).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.deploy_env (key, value)
SELECT 'environment', 'production'
WHERE EXISTS (
  SELECT 1 FROM public.restaurants
  WHERE created_at < now() - interval '90 days'
)
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- §C. Runtime guard
--
-- Fail-safe direction: if this function cannot read the marker for ANY
-- privilege/RLS reason, it returns false — i.e. errs toward "non-production",
-- which no-ops crons rather than firing at prod. A future permission change
-- must not flip that direction.
--
-- SECURITY DEFINER (required, not stylistic): deploy_env has RLS enabled with
-- zero policies and zero table-level GRANTs to service_role (by design — see
-- §A). service_role is the only role granted EXECUTE on this function below,
-- so without SECURITY DEFINER it runs as service_role's own (nonexistent)
-- privileges and errors `permission denied for table deploy_env` instead of
-- returning the documented fail-safe `false` — the exact same pattern (and
-- fix) as `focus_due_sync_count()` reading the analogous RLS-locked
-- `focus_datafeed_state` in 20260704200320_focus_sync_frequency.sql. Safe
-- here: the function body is a fixed, parameterless, read-only EXISTS check
-- with no caller-controlled input.
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- §D. Central dispatch helpers — the single source of the prod URL.
--
-- URL-building is split from dispatch so URL correctness is testable without
-- ever invoking net.http_post (pgTAP must not depend on pg_net internals like
-- net.http_request_queue, whose schema is version-dependent, and must never
-- risk the exact prod-POST this migration exists to prevent).
-- ─────────────────────────────────────────────────────────────────────────────
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
REVOKE ALL ON FUNCTION public.cron_edge_url(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cron_invoke_edge(
  p_function   text,
  p_body       jsonb   DEFAULT '{}'::jsonb,
  p_timeout_ms integer DEFAULT 5000
) RETURNS bigint            -- net.http_post request id; NULL when skipped
LANGUAGE plpgsql VOLATILE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_url        text;
  v_request_id bigint;
BEGIN
  -- Validate + build FIRST: a typo'd function name must raise in EVERY
  -- environment (CI/local/preview catch it before prod ever runs it), not
  -- only in prod — so this precedes the environment guard below.
  v_url := public.cron_edge_url(p_function);

  IF NOT public.is_production() THEN
    RAISE LOG 'cron_invoke_edge: skipped % (non-production environment)', p_function;
    RETURN NULL;
  END IF;

  -- Fire-and-forget: a timeout or 5xx from the edge function does NOT fail
  -- this cron job. Check pg_net's response log (net._http_response) for
  -- delivery status, not cron.job_run_details.
  SELECT net.http_post(
    url                  := v_url,
    headers              := '{"Content-Type": "application/json"}'::jsonb,
    body                 := p_body,
    timeout_milliseconds := p_timeout_ms
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;
-- REQUIRED: the five workers this dispatches to are deliberately gate-less
-- (verify_jwt=false, no inbound Authorization check), so client roles must
-- never be able to use this function as a prod-worker trigger. Only the
-- postgres owner (pg_cron) keeps EXECUTE.
REVOKE ALL ON FUNCTION public.cron_invoke_edge(text, jsonb, integer) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- §E. Rewrap the five worker-invoking jobs (idempotent unschedule + schedule).
-- All five verified verify_jwt=false with no inbound Authorization gate, so
-- the no-auth helper preserves calling semantics. Unschedule-by-name
-- converges prod regardless of whether its live jobs were hand-patched or
-- still carry the broken current_setting('app.settings.*') GUC form.
-- ─────────────────────────────────────────────────────────────────────────────

-- focus-backfill-sync: every 5 minutes (unchanged).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'focus-backfill-sync') THEN
    PERFORM cron.unschedule('focus-backfill-sync');
  END IF;
END $$;

SELECT cron.schedule(
  'focus-backfill-sync',
  '*/5 * * * *',
  $$SELECT public.cron_invoke_edge('focus-backfill-sync')$$
);

-- focus-bulk-sync: every 5 minutes, K = ceil(due/5) capped at 20 parallel
-- workers (unchanged fan-out sizing from 20260704200320_focus_sync_frequency.sql).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'focus-bulk-sync') THEN
    PERFORM cron.unschedule('focus-bulk-sync');
  END IF;
END $$;

SELECT cron.schedule(
  'focus-bulk-sync',
  '*/5 * * * *',
  $$SELECT public.cron_invoke_edge('focus-bulk-sync') FROM generate_series(1, LEAST(20, GREATEST(1, CEIL(public.focus_due_sync_count() / 5.0)))::int)$$
);

-- toast-bulk-sync: even hours (unchanged). This RESTORES its designed
-- scheduled behavior in prod — it currently errors every run on the unset
-- app.settings.supabase_url GUC.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'toast-bulk-sync') THEN
    PERFORM cron.unschedule('toast-bulk-sync');
  END IF;
END $$;

SELECT cron.schedule(
  'toast-bulk-sync',
  '0 0,2,4,6,8,10,12,14,16,18,20,22 * * *',
  $$SELECT public.cron_invoke_edge('toast-bulk-sync')$$
);

-- shift4-bulk-sync: odd hours (unchanged). Same GUC-restoring fix as toast.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'shift4-bulk-sync') THEN
    PERFORM cron.unschedule('shift4-bulk-sync');
  END IF;
END $$;

SELECT cron.schedule(
  'shift4-bulk-sync',
  '0 1,3,5,7,9,11,13,15,17,19,21,23 * * *',
  $$SELECT public.cron_invoke_edge('shift4-bulk-sync')$$
);

-- square-daily-sync: 02:00 daily (unchanged); dispatches to
-- square-periodic-sync with the scheduled-run body flag.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'square-daily-sync') THEN
    PERFORM cron.unschedule('square-daily-sync');
  END IF;
END $$;

SELECT cron.schedule(
  'square-daily-sync',
  '0 2 * * *',
  $$SELECT public.cron_invoke_edge('square-periodic-sync', '{"scheduled": true}'::jsonb)$$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- §F. Non-prod-only: unschedule jobs that can never work off-prod.
--
-- These read app.settings.* GUCs that are unset everywhere; off-prod they can
-- never be fixed and only generate failed-run noise every tick. Prod's copies
-- stay untouched (pre-existing latent bugs, flagged as follow-ups — fixing
-- them needs a vault-stored service key, separate PR).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT public.is_production() THEN
    PERFORM cron.unschedule(jobname) FROM cron.job
     WHERE jobname IN ('sling-bulk-sync', 'trial-expiry-emails',
                       'process-weekly-brief-queue');
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §G. Close the client-callable RPC bypass (Codex pass-2 finding).
--
-- trigger_square_periodic_sync() (20251011012229) hardcoded the prod URL in a
-- SECURITY DEFINER RPC that still carried the default PUBLIC EXECUTE grant:
-- any client role via PostgREST — and any preview/local DB — could fire
-- prod's Square sync directly, bypassing the environment guard above. No
-- application code calls it (manual ops helper only; grep: src/ has zero call
-- sites), so it is rewrapped through cron_invoke_edge (environment-guarded,
-- single URL source) and locked to postgres/service_role.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trigger_square_periodic_sync()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Env guard + prod URL live in cron_invoke_edge; NULL return (non-prod
  -- skip) is discarded by PERFORM, so this stays a clean no-op off-prod.
  PERFORM public.cron_invoke_edge('square-periodic-sync', '{"manual": true}'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.trigger_square_periodic_sync() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_square_periodic_sync() TO service_role;
