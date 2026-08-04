-- Standing categorization sweep.
--
-- drain_categorization_backlog() was written as a one-shot backfill: it deleted
-- its own pg_cron job on a converged pass (20260804090700 §self-retire, and the
-- original schedule comment at 20260703090000:1045 "The job deletes itself ...
-- once converged"). It ran four times and retired on 2026-07-04.
--
-- That retirement stranded every categorization path that is not wired into a
-- sync function. unified_sales has two mechanisms and no owner: the
-- auto_categorize_pos_sale BEFORE INSERT trigger (one shot per row, so a rule
-- created tomorrow never sees today's rows) and the batch sweep, which only
-- toast/focus/focus_transactions/revel call inline. square, clover, shift4,
-- lighthouse, manual_upload and manual have the trigger only.
-- bank_transactions had exactly one driver -- stripe-sync-transactions, and
-- only when that sync found new rows.
--
-- The fix is to stop retiring. The sweep selects candidates by restaurant_id
-- and watermark with NO pos_system predicate (20260804090300:130-139), and this
-- drain selects restaurants by RULE, not by connection table -- so one standing
-- job covers every POS that exists today and every POS added later, with no
-- per-integration wiring. Do not add a pos_system filter to either; that is the
-- property the 51_standing_categorization_sweep.sql conformance test pins.
--
-- Retirement is no longer buying anything: since the rules_evaluated_at
-- negative cache (20260804090300) a converged tick reads no candidates at all.

CREATE OR REPLACE FUNCTION public.drain_categorization_backlog()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
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
  -- ORDER BY random(): no ordering was harmless while this job retired, but a
  -- permanent job with a fixed planner order starves whoever sorts last every
  -- single tick once the 40s budget is exhausted mid-pass. Random order gives
  -- every restaurant equal expected coverage. The DISTINCT is wrapped because
  -- ORDER BY random() on a SELECT DISTINCT is a syntax error.
  FOR r IN
    SELECT d.restaurant_id
    FROM (
      SELECT DISTINCT cr.restaurant_id
      FROM categorization_rules cr
      WHERE cr.is_active
        AND cr.auto_apply
        AND cr.applies_to IN ('pos_sales', 'both')
    ) d
    ORDER BY random()
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
    SELECT d.restaurant_id
    FROM (
      SELECT DISTINCT cr.restaurant_id
      FROM categorization_rules cr
      WHERE cr.is_active
        AND cr.auto_apply
        AND cr.applies_to IN ('bank_transactions', 'both')
    ) d
    ORDER BY random()
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

  -- ── No self-retirement ────────────────────────────────────────────────────
  -- This tick never unschedules its own job, whatever the outcome. A converged
  -- backlog is not a terminal state: the next rule a user creates lowers the
  -- watermark and makes their whole history a candidate again. The previous
  -- version retired here and left 3,351 bank rows and 9,333 POS rows stranded
  -- for a month with no automated driver.
  RAISE LOG 'categorization drain: applied % rows of % claimed this tick (errors=%, budget_hit=%)',
    v_total, v_claimed, v_errors, v_budget_hit;

  RETURN v_total;
END;
$$;

COMMENT ON FUNCTION public.drain_categorization_backlog() IS
  'Standing bounded (~40s) sweep that applies categorization rules to the '
  'uncategorized POS and bank backlog for every restaurant with an active '
  'auto_apply rule. Runs permanently every 5 minutes as the '
  'categorization-backlog-drain pg_cron job and NEVER unschedules itself -- a '
  'converged backlog is not terminal, because the next rule a user creates '
  'lowers the watermark and re-opens their history. POS-agnostic by '
  'construction: restaurants are selected by rule and candidates by watermark, '
  'with no pos_system predicate anywhere, so a POS integration added later is '
  'covered with no wiring. Returns rows applied this tick.';

-- Re-assert the 20260703090000 hardening. CREATE OR REPLACE preserves the
-- existing ACL, but restating it keeps this file correct if it is ever replayed
-- against a database where the function was created fresh.
REVOKE ALL ON FUNCTION public.drain_categorization_backlog() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.drain_categorization_backlog() TO service_role;

-- Schedule the standing job. Unschedule-then-schedule converges from either
-- state: production, where the job is absent because it retired itself on
-- 2026-07-04, and any environment where it still exists on some other schedule.
CREATE EXTENSION IF NOT EXISTS pg_cron;

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
