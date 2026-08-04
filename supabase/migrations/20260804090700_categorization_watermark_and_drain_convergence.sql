-- Two defects that together defeat the bounded-sweep negative cache added in
-- 20260804090300. Both were found reviewing that migration, not in production.
--
-- 1. The watermark invalidated itself.
--    apply_rules_to_*_internal bump categorization_rules.apply_count and
--    last_applied_at on every successful match. categorization_rules carries a
--    BEFORE UPDATE trigger running update_accounting_updated_at(), whose entire
--    body is `NEW.updated_at = NOW()`. The sweeps compute their watermark as
--    max(GREATEST(created_at, COALESCE(updated_at, created_at))) over the
--    restaurant's rules -- so applying a rule advanced the watermark, which
--    made every row stamped by that same sweep compare as stale on the next
--    tick. Any restaurant matching at least one row per sweep re-scanned its
--    entire backlog every 5 minutes: exactly the behaviour the cache removes.
--
--    Fixed with a dedicated trigger function for this table that holds
--    updated_at steady when a row differs only in those bookkeeping columns.
--    update_accounting_updated_at() itself is left alone -- it is wired to 14
--    triggers across 7 migrations and means "row touched" everywhere else.
--
-- 2. drain_categorization_backlog could retire with work left.
--    It exited its per-restaurant loop on applied_count = 0 and unscheduled its
--    own cron job after a tick applied nothing. Before the batch was bounded,
--    zero applications did prove there was nothing left to match. Now it only
--    proves the newest 5,000 claimed rows matched nothing, so a restaurant
--    whose recent sales match no rule would strand its older matching rows
--    permanently. Convergence now keys off an empty CLAIM (total_count), which
--    is the only signal that actually means "no candidates remain".
--
-- Design: docs/superpowers/specs/2026-08-03-pos-sync-categorization-rescan-design.md §3.3

-- ── 1. Bookkeeping updates must not advance the rule-definition watermark ────

CREATE OR REPLACE FUNCTION public.touch_categorization_rules_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- updated_at on this table is read as a rule-DEFINITION watermark by
  -- apply_rules_to_pos_sales_internal and apply_rules_to_bank_transactions_internal.
  -- apply_count/last_applied_at record how often a rule fired, which says nothing
  -- about whether the rule itself changed, so they must not move it.
  --
  -- Compared as jsonb rather than column-by-column so that adding a column to
  -- categorization_rules later cannot silently start being ignored here: a new
  -- column is a definition change by default, and only the three names below
  -- are exempt.
  IF (to_jsonb(NEW) - 'apply_count' - 'last_applied_at' - 'updated_at')
     IS NOT DISTINCT FROM
     (to_jsonb(OLD) - 'apply_count' - 'last_applied_at' - 'updated_at')
  THEN
    NEW.updated_at := OLD.updated_at;
  ELSE
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.touch_categorization_rules_updated_at() IS
  'BEFORE UPDATE trigger for categorization_rules. Maintains updated_at as a '
  'rule-definition watermark: bookkeeping-only updates (apply_count, '
  'last_applied_at) leave it untouched so the categorization sweeps do not '
  'invalidate their own negative cache every time a rule fires.';

DROP TRIGGER IF EXISTS update_categorization_rules_updated_at ON public.categorization_rules;
CREATE TRIGGER update_categorization_rules_updated_at
  BEFORE UPDATE ON public.categorization_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_categorization_rules_updated_at();

-- ── 2. Drain convergence keys off an empty claim, not zero applications ──────
--
-- Full body restated from 20260703090000 (CREATE OR REPLACE rewrites the whole
-- function). Changed: both inner loops read total_count as well as
-- applied_count, exit on an empty claim, and the self-retire test uses the
-- claim total. The bank rebuild now keys off rows this restaurant actually
-- applied instead of the `i > 1 OR n > 0` proxy, which claimed-but-unmatched
-- batches would otherwise trip. Everything else is unchanged.

CREATE OR REPLACE FUNCTION public.drain_categorization_backlog()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
DECLARE
  r             RECORD;
  n_applied     integer;
  n_claimed     integer;
  i             integer;
  v_r_applied   integer;
  v_total       integer     := 0;
  v_claimed     integer     := 0;
  v_errors      integer     := 0;
  v_budget_hit  boolean     := false;
  v_started     timestamptz := clock_timestamp();
  v_budget      interval    := interval '40 seconds';
BEGIN
  -- ── POS backlog (a few batches per restaurant per tick) ──────────────────
  FOR r IN
    SELECT DISTINCT cr.restaurant_id
    FROM categorization_rules cr
    WHERE cr.is_active
      AND cr.auto_apply
      AND cr.applies_to IN ('pos_sales', 'both')
  LOOP
    IF v_budget_hit OR clock_timestamp() - v_started > v_budget THEN
      v_budget_hit := true;
      EXIT;
    END IF;
    BEGIN
      i := 0;
      LOOP
        -- total_count is candidates CLAIMED, not matched. Exiting on
        -- applied_count would stop at the first bounded batch that happened to
        -- match nothing and leave older candidates unevaluated forever.
        SELECT applied_count, total_count INTO n_applied, n_claimed
        FROM apply_rules_to_pos_sales_internal(r.restaurant_id, 5000);
        v_total   := v_total   + COALESCE(n_applied, 0);
        v_claimed := v_claimed + COALESCE(n_claimed, 0);
        i := i + 1;
        EXIT WHEN COALESCE(n_claimed, 0) = 0 OR i >= 2;
        IF clock_timestamp() - v_started > v_budget THEN
          v_budget_hit := true;
          EXIT;
        END IF;
      END LOOP;
    EXCEPTION
      -- WHEN OTHERS does NOT catch query_canceled (57014); name it explicitly
      -- so a timed-out batch skips this restaurant instead of aborting the tick.
      -- Treat it as time exhaustion so the pass is not considered complete.
      WHEN query_canceled THEN
        v_errors := v_errors + 1;
        v_budget_hit := true;
        RAISE WARNING 'categorization drain (pos) canceled for restaurant %: %',
          r.restaurant_id, SQLERRM;
      WHEN OTHERS THEN
        v_errors := v_errors + 1;
        RAISE WARNING 'categorization drain (pos) failed for restaurant %: %',
          r.restaurant_id, SQLERRM;
    END;
  END LOOP;

  -- ── Bank backlog (a few batches per restaurant per tick) ─────────────────
  FOR r IN
    SELECT DISTINCT cr.restaurant_id
    FROM categorization_rules cr
    WHERE cr.is_active
      AND cr.auto_apply
      AND cr.applies_to IN ('bank_transactions', 'both')
  LOOP
    IF v_budget_hit OR clock_timestamp() - v_started > v_budget THEN
      v_budget_hit := true;
      EXIT;
    END IF;
    BEGIN
      i := 0;
      v_r_applied := 0;
      LOOP
        -- p_skip_rebuild=true: one rebuild per restaurant per tick (below),
        -- not one per batch — rebuilds dominate the cost otherwise.
        SELECT applied_count, total_count INTO n_applied, n_claimed
        FROM apply_rules_to_bank_transactions_internal(r.restaurant_id, 1000, true);
        v_total     := v_total     + COALESCE(n_applied, 0);
        v_claimed   := v_claimed   + COALESCE(n_claimed, 0);
        v_r_applied := v_r_applied + COALESCE(n_applied, 0);
        i := i + 1;
        EXIT WHEN COALESCE(n_claimed, 0) = 0 OR i >= 5;
        IF clock_timestamp() - v_started > v_budget THEN
          v_budget_hit := true;
          EXIT;
        END IF;
      END LOOP;
      -- Rebuild once per tick, only when this restaurant applied rows. Claiming
      -- candidates that matched nothing changes no balance, so it must not
      -- trigger a rebuild.
      IF v_r_applied > 0 THEN
        PERFORM rebuild_account_balances(r.restaurant_id);
      END IF;
    EXCEPTION
      WHEN query_canceled THEN
        v_errors := v_errors + 1;
        v_budget_hit := true;
        RAISE WARNING 'categorization drain (bank) canceled for restaurant %: %',
          r.restaurant_id, SQLERRM;
      WHEN OTHERS THEN
        v_errors := v_errors + 1;
        RAISE WARNING 'categorization drain (bank) failed for restaurant %: %',
          r.restaurant_id, SQLERRM;
    END;
  END LOOP;

  -- ── Self-retire ONLY after a complete, error-free, empty pass ─────────────
  -- "Empty" means no candidate was even CLAIMED: with a bounded batch, zero
  -- rows applied only means the rows this tick looked at matched nothing.
  -- v_claimed=0 alone is still not enough -- the budget may have expired before
  -- reaching a backlogged restaurant, or every attempt may have errored.
  -- Retiring then would strand the backlog forever; keep ticking instead.
  IF v_claimed = 0 AND v_errors = 0 AND NOT v_budget_hit THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'categorization-backlog-drain') THEN
      PERFORM cron.unschedule('categorization-backlog-drain');
      RAISE LOG 'categorization drain: backlog converged — job unscheduled';
    END IF;
  ELSE
    RAISE LOG 'categorization drain: applied % rows of % claimed this tick (errors=%, budget_hit=%)',
      v_total, v_claimed, v_errors, v_budget_hit;
  END IF;

  RETURN v_total;
END;
$$;

COMMENT ON FUNCTION public.drain_categorization_backlog() IS
  'Bounded (~40s) tick that drains the pre-existing uncategorized POS/bank '
  'backlog for restaurants with active auto_apply rules. Scheduled every 5 '
  'minutes by the categorization-backlog-drain pg_cron job; unschedules that '
  'job itself only after a COMPLETE, error-free tick CLAIMS 0 candidates '
  '(budget-expired, errored, or matched-nothing-but-still-claiming ticks keep '
  'the job alive). Returns rows applied this tick. Replaces the in-migration '
  'synchronous backfill that timed out production deploys.';

-- Re-assert the 20260703090000 hardening: CREATE OR REPLACE keeps the existing
-- ACL, but restating it keeps this file self-contained if it is ever replayed
-- against a database where the function was created fresh.
REVOKE ALL ON FUNCTION public.drain_categorization_backlog() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.drain_categorization_backlog() TO service_role;
