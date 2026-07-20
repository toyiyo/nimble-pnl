-- ═════════════════════════════════════════════════════════════════════════════
-- Revel near-real-time sync: due-based claim scheduler (ports the Focus pattern,
-- 20260704200320_focus_sync_frequency.sql).
--
-- Each restaurant hits its OWN Revel domain (<subdomain>.revelup.com), so there's
-- no shared API to overwhelm — a 30-minute per-restaurant cadence is safe.
--
-- §1 scheduling columns   sync_interval_minutes / next_attempt_at / consecutive_failures
-- §2 _revel_connection_is_due   single-expression STABLE sql (inlinable)
-- §3 revel_due_sync_count       sizes the cron fan-out
-- §4 claim_revel_sync_batch     atomic UPDATE…SKIP LOCKED…RETURNING claim
-- §5 privileges                 service-role only
-- §6 cron                       every 5 min, K = ceil(due/5) workers (cap 20)
-- ═════════════════════════════════════════════════════════════════════════════

-- ── §1 scheduling columns ────────────────────────────────────────────────────
ALTER TABLE public.revel_connections
  ADD COLUMN IF NOT EXISTS sync_interval_minutes integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0;

-- Walk the least-recently-synced active connections efficiently.
CREATE INDEX IF NOT EXISTS revel_connections_active_sync_idx
  ON public.revel_connections (last_sync_time ASC NULLS FIRST)
  WHERE is_active;

-- ── §2 due predicate ─────────────────────────────────────────────────────────
-- Keep LANGUAGE sql / STABLE / single-expression so the planner inlines it into
-- the claim query. A connection still backfilling (initial_sync_done = false) is
-- always due (subject to next_attempt_at backoff) so the cron drives it to
-- completion quickly; a caught-up connection is due once per sync_interval_minutes.
CREATE OR REPLACE FUNCTION public._revel_connection_is_due(rc public.revel_connections)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT rc.is_active
    AND rc.api_key_encrypted IS NOT NULL
    AND (rc.next_attempt_at IS NULL OR rc.next_attempt_at <= now())
    AND (
      rc.initial_sync_done = false
      OR rc.last_sync_time IS NULL
      OR rc.last_sync_time <= now() - make_interval(mins => rc.sync_interval_minutes)
    )
$$;

-- ── §3 due count (sizes cron fan-out) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.revel_due_sync_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT count(*)::integer
    FROM public.revel_connections rc
   WHERE public._revel_connection_is_due(rc)
$$;

-- ── §4 atomic claim ──────────────────────────────────────────────────────────
-- One statement (job-queue shape). last_sync_time doubles as the claim marker;
-- FOR UPDATE SKIP LOCKED guarantees two workers never grab the same connection.
CREATE OR REPLACE FUNCTION public.claim_revel_sync_batch(p_limit integer DEFAULT 5)
RETURNS SETOF public.revel_connections
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE public.revel_connections
     SET last_sync_time = now()
   WHERE id IN (
     SELECT rc.id
       FROM public.revel_connections rc
      WHERE public._revel_connection_is_due(rc)
      ORDER BY rc.last_sync_time ASC NULLS FIRST
      LIMIT GREATEST(COALESCE(p_limit, 0), 0)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING *;
$$;

-- ── §5 privileges ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._revel_connection_is_due(public.revel_connections) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revel_due_sync_count() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_revel_sync_batch(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revel_due_sync_count() TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_revel_sync_batch(integer) TO service_role;

-- ── §6 cron: replace the old 6-hour round-robin with a 5-min due-based fan-out ─
-- Hardcoded URL + no auth header (gateless): revel-bulk-sync is verify_jwt=false,
-- and ALTER DATABASE SET app.settings.* is permission-denied on Supabase.
-- net.http_post is fire-and-forget — a lost dispatch just leaves those
-- connections due for the next tick.
CREATE EXTENSION IF NOT EXISTS pg_cron;
GRANT USAGE ON SCHEMA cron TO postgres;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'revel-bulk-sync') THEN
    PERFORM cron.unschedule('revel-bulk-sync');
  END IF;
END $$;

SELECT cron.schedule(
  'revel-bulk-sync',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/revel-bulk-sync',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 5000
  )
  FROM generate_series(1, LEAST(20, GREATEST(1, CEIL(public.revel_due_sync_count() / 5.0)))::int);
  $cron$
);
