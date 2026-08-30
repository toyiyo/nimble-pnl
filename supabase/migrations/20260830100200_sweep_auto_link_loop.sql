-- Third loop for the standing categorization sweep: pending-outflow auto-link.
--
-- drain_categorization_backlog() already runs a POS rules loop and a bank
-- rules loop under a shared 40-second soft budget, each tracking its OWN
-- budget-hit flag so one loop's exhaustion or query_canceled cannot spend
-- the other loop's turn (20260804091000_standing_categorization_sweep.sql).
-- This migration adds a third loop, after the bank loop, that drives
-- auto_link_pending_outflows_internal (20260830100000) the same way.
--
-- The link loop selects restaurants directly from pending_outflows, not
-- from categorization_rules -- auto-link has no rule table. Eligibility
-- mirrors auto_link_pending_outflows_internal's own eligible_outflows CTE
-- (20260830100000_auto_link_pending_outflows.sql:95-98): open status,
-- unlinked, not suppressed.
--
-- The link loop checks the SAME v_budget (the shared 40s), not a private
-- sub-budget like the POS loop's v_budget_pos -- and its own
-- v_budget_hit_link flag, referencing neither v_budget_hit_pos nor
-- v_budget_hit_bank. A POS or bank cancellation this tick must not starve
-- the link loop, for the same reason the bank loop must not be starved by
-- POS (comment at 20260804091000:43-48).
--
-- This migration is a CREATE OR REPLACE of the function body from
-- 20260804091000_standing_categorization_sweep.sql, with the new loop
-- inserted between the bank loop and the final RAISE LOG. Every other line
-- of that function body is byte-identical.
--
-- See docs/superpowers/specs/2026-08-30-pending-outflow-auto-link-design.md §4.

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
  v_r_linked    integer;
  v_total       integer     := 0;
  v_claimed     integer     := 0;
  v_errors      integer     := 0;
  -- One flag per loop. A single shared flag let the POS loop -- which runs
  -- first -- zero out the bank loop for a whole tick, and not only on genuine
  -- time exhaustion: the POS query_canceled handler below sets its flag
  -- deliberately, so ONE timed-out POS batch used to cancel bank with 39s of
  -- budget left. Bank is the backlog this job exists to rescue; it must not be
  -- structurally outranked. Keep these separate.
  v_budget_hit_pos  boolean := false;
  v_budget_hit_bank boolean := false;
  -- Same reasoning for the link loop below: it must not be starved by a POS
  -- or bank cancellation, so it gets its own flag too.
  v_budget_hit_link boolean := false;
  v_started     timestamptz := clock_timestamp();
  -- Both loops measure from the SAME v_started. POS may take at most 25s, so
  -- bank is guaranteed the remaining 15s of the unchanged 40s total -- and more
  -- when POS finishes early. Do NOT give bank its own clock: 15s measured from
  -- bank's own start would make the worst case 25s + 120s statement_timeout +
  -- 15s + 120s = 280s against a 300s cadence, instead of the ~160s this design
  -- is bounded at.
  v_budget      interval    := interval '40 seconds';
  v_budget_pos  interval    := interval '25 seconds';
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
    IF v_budget_hit_pos OR clock_timestamp() - v_started > v_budget_pos THEN
      v_budget_hit_pos := true;
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
        IF clock_timestamp() - v_started > v_budget_pos THEN
          v_budget_hit_pos := true;
          EXIT;
        END IF;
      END LOOP;
    EXCEPTION
      -- WHEN OTHERS does NOT catch query_canceled (57014); name it explicitly
      -- so a timed-out batch skips this restaurant instead of aborting the tick.
      -- Treat it as time exhaustion so the pass is not considered complete.
      WHEN query_canceled THEN
        v_errors := v_errors + 1;
        v_budget_hit_pos := true;
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
    -- v_budget (the full 40s), not v_budget_pos, and NOT v_budget_hit_pos: a POS
    -- pass that exhausted its 25s or hit a statement timeout leaves bank its 15s.
    IF v_budget_hit_bank OR clock_timestamp() - v_started > v_budget THEN
      v_budget_hit_bank := true;
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
          v_budget_hit_bank := true;
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
        v_budget_hit_bank := true;
        RAISE WARNING 'categorization drain (bank) canceled for restaurant %: %',
          r.restaurant_id, SQLERRM;
      WHEN OTHERS THEN
        v_errors := v_errors + 1;
        RAISE WARNING 'categorization drain (bank) failed for restaurant %: %',
          r.restaurant_id, SQLERRM;
    END;
  END LOOP;

  -- ── Pending-outflow auto-link (a few batches per restaurant per tick) ────
  -- Restaurants come straight from pending_outflows -- auto-link has no rule
  -- table to select by, unlike the two loops above. The predicate mirrors
  -- auto_link_pending_outflows_internal's own eligible_outflows CTE: open
  -- status, unlinked, not suppressed by a prior unlink.
  FOR r IN
    SELECT DISTINCT po.restaurant_id
    FROM pending_outflows po
    WHERE po.status IN ('pending', 'stale_30', 'stale_60', 'stale_90')
      AND po.linked_bank_transaction_id IS NULL
      AND po.auto_link_suppressed_at IS NULL
    ORDER BY random()
  LOOP
    -- v_budget (the full 40s, the same ceiling the bank loop checks), and its
    -- own v_budget_hit_link flag -- not v_budget_hit_pos, not
    -- v_budget_hit_bank. A POS or bank cancellation this tick must not spend
    -- the link loop's turn, the same isolation the bank loop already has
    -- from POS.
    IF v_budget_hit_link OR clock_timestamp() - v_started > v_budget THEN
      v_budget_hit_link := true;
      EXIT;
    END IF;
    BEGIN
      i := 0;
      v_r_linked := 0;
      LOOP
        -- p_skip_rebuild=true: one rebuild per restaurant per tick (below),
        -- same shape as the bank loop.
        SELECT linked_count, candidate_count INTO n_applied, n_claimed
        FROM auto_link_pending_outflows_internal(r.restaurant_id, 100, true);
        v_total    := v_total    + COALESCE(n_applied, 0);
        v_claimed  := v_claimed  + COALESCE(n_claimed, 0);
        v_r_linked := v_r_linked + COALESCE(n_applied, 0);
        i := i + 1;
        EXIT WHEN COALESCE(n_claimed, 0) = 0 OR i >= 5;
        IF clock_timestamp() - v_started > v_budget THEN
          v_budget_hit_link := true;
          EXIT;
        END IF;
      END LOOP;
      -- Rebuild once per tick, only when this restaurant linked a row.
      IF v_r_linked > 0 THEN
        PERFORM rebuild_account_balances(r.restaurant_id);
      END IF;
    EXCEPTION
      WHEN query_canceled THEN
        v_errors := v_errors + 1;
        v_budget_hit_link := true;
        RAISE WARNING 'categorization drain (link) canceled for restaurant %: %',
          r.restaurant_id, SQLERRM;
      WHEN OTHERS THEN
        v_errors := v_errors + 1;
        RAISE WARNING 'categorization drain (link) failed for restaurant %: %',
          r.restaurant_id, SQLERRM;
    END;
  END LOOP;

  -- ── No self-retirement ────────────────────────────────────────────────────
  -- This tick never unschedules its own job, whatever the outcome. A converged
  -- backlog is not a terminal state: the next rule a user creates lowers the
  -- watermark and makes their whole history a candidate again. The previous
  -- version retired here and left 3,351 bank rows and 9,333 POS rows stranded
  -- for a month with no automated driver.
  RAISE LOG 'categorization drain: applied % rows of % claimed this tick (errors=%, budget_hit_pos=%, budget_hit_bank=%, budget_hit_link=%)',
    v_total, v_claimed, v_errors, v_budget_hit_pos, v_budget_hit_bank, v_budget_hit_link;

  RETURN v_total;
END;
$$;

COMMENT ON FUNCTION public.drain_categorization_backlog() IS
  'Standing bounded (~40s total soft budget, of which POS is checked against '
  'at most 25s between batches so bank keeps its 15s share when both loops '
  'stay within their checkpoints) sweep that applies categorization rules to '
  'the uncategorized POS and bank backlog for every restaurant with an active '
  'auto_apply rule, then auto-links open pending outflows to matching bank '
  'transactions for every restaurant with at least one eligible outflow. The '
  'link loop shares the bank loop''s 40s ceiling but tracks its own '
  'budget-hit flag, so neither a POS nor a bank cancellation starves it. That '
  '25s/15s split is a checked bound, not an absolute wall-clock one: a single '
  'in-flight POS batch can still run past its checkpoint for up to the 120s '
  'statement_timeout before query_canceled fires, in which case bank''s own '
  '40s guard (measured from the same start time) can already be exceeded -- '
  'see the design doc Risks section for the full worst-case accounting. Runs '
  'permanently every 5 minutes as the categorization-backlog-drain pg_cron '
  'job and NEVER unschedules itself -- a converged backlog is not terminal, '
  'because the next rule a user creates lowers the watermark and re-opens '
  'their history. POS-agnostic by construction: restaurants are selected by '
  'rule and candidates by watermark, with no pos_system predicate anywhere, '
  'so a POS integration added later is covered with no wiring. Returns rows '
  'applied and links made this tick.';

-- Re-assert the 20260703090000 hardening. CREATE OR REPLACE preserves the
-- existing ACL, but restating it keeps this file correct if it is ever replayed
-- against a database where the function was created fresh.
REVOKE ALL ON FUNCTION public.drain_categorization_backlog() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.drain_categorization_backlog() TO service_role;

-- No cron reschedule needed: the standing job (scheduled by
-- 20260804091000_standing_categorization_sweep.sql) calls
-- 'SELECT public.drain_categorization_backlog()' by name, so the next tick
-- picks up this CREATE OR REPLACE with no change to cron.job.
