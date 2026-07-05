-- ═════════════════════════════════════════════════════════════════════════════
-- Focus POS near-real-time sync: due-based claim scheduler
--
-- Design: docs/superpowers/specs/2026-07-04-focus-sync-frequency-design.md
--
-- §1 focus_connections: sync_interval_minutes / next_attempt_at / consecutive_failures
-- §2 focus_datafeed_state (delta-skip fingerprints; RLS, service-role only)
-- §3 _focus_connection_is_due  — the ONE source of truth for "due" (inlinable SQL)
-- §4 focus_due_sync_count      — cron fan-out sizing
-- §5 claim_focus_sync_batch    — atomic UPDATE…SKIP LOCKED…RETURNING claim
-- §6 privileges                — REVOKE PUBLIC/anon/authenticated on all three
-- §7 cron                      — focus-bulk-sync every 5 min, K parallel workers
-- ═════════════════════════════════════════════════════════════════════════════

-- ── §1 scheduling columns ────────────────────────────────────────────────────
ALTER TABLE public.focus_connections
  ADD COLUMN IF NOT EXISTS sync_interval_minutes integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0;

-- Legacy portal rows (SSRS scrape) keep their 6-hour rhythm.
UPDATE public.focus_connections
   SET sync_interval_minutes = 360
 WHERE api_key IS NULL;

-- ── §2 datafeed fingerprints ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.focus_datafeed_state (
  restaurant_id  uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  business_date  date NOT NULL,
  checks_bytes   integer NOT NULL,
  checks_sha256  text NOT NULL,
  fetched_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, business_date)
);
-- Service-role-only internal state: RLS on, zero client policies.
ALTER TABLE public.focus_datafeed_state ENABLE ROW LEVEL SECURITY;

-- ── §3 due predicate ─────────────────────────────────────────────────────────
-- MUST stay LANGUAGE sql, STABLE, single-expression, NOT STRICT: the planner
-- then inlines it into callers, so the claim query can walk
-- focus_connections_active_sync_idx (last_sync_time ASC NULLS FIRST WHERE
-- is_active) and stop at LIMIT instead of evaluating an opaque function per row.
CREATE OR REPLACE FUNCTION public._focus_connection_is_due(fc public.focus_connections)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT fc.is_active
    AND (fc.next_attempt_at IS NULL OR fc.next_attempt_at <= now())
    AND (fc.last_sync_time IS NULL
         OR fc.last_sync_time <= now() - make_interval(mins => fc.sync_interval_minutes))
    -- Lynk rows still backfilling are owned by the focus-backfill-sync cron:
    AND (fc.api_key IS NULL OR fc.initial_sync_done)
$$;

-- ── §4 due count (sizes the cron fan-out) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.focus_due_sync_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT count(*)::integer
    FROM public.focus_connections fc
   WHERE public._focus_connection_is_due(fc)
$$;

-- ── §5 atomic claim ──────────────────────────────────────────────────────────
-- ONE statement (canonical job-queue shape). Any SELECT-then-UPDATE variant
-- reopens the race SKIP LOCKED exists to close. last_sync_time doubles as the
-- claim marker; a crashed worker costs one skipped interval. updated_at is
-- maintained by the existing BEFORE UPDATE trigger.
CREATE OR REPLACE FUNCTION public.claim_focus_sync_batch(p_limit integer DEFAULT 5)
RETURNS SETOF public.focus_connections
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE public.focus_connections
     SET last_sync_time = now()
   WHERE id IN (
     SELECT fc.id
       FROM public.focus_connections fc
      WHERE public._focus_connection_is_due(fc)
      ORDER BY fc.last_sync_time ASC NULLS FIRST
      LIMIT GREATEST(COALESCE(p_limit, 0), 0)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING *;
$$;

-- ── §6 privileges ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._focus_connection_is_due(public.focus_connections) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.focus_due_sync_count() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_focus_sync_batch(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.focus_due_sync_count() TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_focus_sync_batch(integer) TO service_role;

-- ── §7 cron: 5-minute tick, K = ceil(due/5) capped at 20 parallel workers ────
-- Hardcoded URL: ALTER DATABASE SET app.settings.* is permission-denied on
-- Supabase (matches 20260703120000_focus_backfill_reliability.sql).
-- net.http_post is fire-and-forget: a lost dispatch just means those
-- connections stay due and are claimed on the next tick.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'focus-bulk-sync') THEN
    PERFORM cron.unschedule('focus-bulk-sync');
  END IF;
END $$;

SELECT cron.schedule(
  'focus-bulk-sync',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/focus-bulk-sync',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 5000
  )
  FROM generate_series(1, LEAST(20, GREATEST(1, CEIL(public.focus_due_sync_count() / 5.0)))::int);
  $cron$
);
