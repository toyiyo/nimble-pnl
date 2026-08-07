# Standing Categorization Sweep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `drain_categorization_backlog()` a permanent `*/5` pg_cron job instead of one that deletes itself, so `bank_transactions` and every `pos_system` — present and future — get rule categorization without per-integration wiring.

**Architecture:** One migration (`CREATE OR REPLACE` the drain with the self-retire block removed, plus an idempotent `cron.schedule`), one new pgTAP conformance file, and an inversion of the three tests in `50_categorization_backlog_drain.sql` that pin the old self-retire semantics. No schema change, no edge-function change, no UI change.

**Tech Stack:** PostgreSQL 15 (Supabase), pl/pgSQL, pg_cron, pgTAP.

**Design doc:** [docs/superpowers/specs/2026-08-04-categorization-standing-sweep-design.md](../specs/2026-08-04-categorization-standing-sweep-design.md)

## Global Constraints

- Worktree: `/Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/categorization-standing-sweep`. Every git command uses `git -C <that path>`.
- Branch: `fix/categorization-standing-sweep`. Never commit to `main`.
- Never `git add -A`, `git add .`, or `git commit -a`. Stage explicit paths only. `progress.md` is gitignored and must never be staged.
- Migration filenames are strictly ordered; this migration must sort after `20260804090700_categorization_watermark_and_drain_convergence.sql`.
- pgTAP files are auto-discovered by `supabase/tests/run_tests.sh:75` (`for test_file in "$SCRIPT_DIR"/*.sql`). No registration step exists.
- Every pgTAP file is `BEGIN; SELECT plan(N); … SELECT * FROM finish(); ROLLBACK;`.
- All committed artifacts use fictional placeholders. No real restaurant, person, or account identifiers.
- Run `npm run test:db` from the repo root; it `cd`s into `supabase/tests` and runs `./run_tests.sh`.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260804091000_standing_categorization_sweep.sql` | Create | Replace the drain without self-retirement; schedule the standing job |
| `supabase/tests/51_standing_categorization_sweep.sql` | Create | Conformance: the properties that make future POS coverage automatic |
| `supabase/tests/50_categorization_backlog_drain.sql` | Modify | Invert the three assertions that pin self-retirement |

---

### Task 1: Migration — the drain stops retiring itself, and gets a standing job

**Files:**
- Create: `supabase/migrations/20260804091000_standing_categorization_sweep.sql`

**Interfaces:**
- Consumes: `apply_rules_to_pos_sales_internal(uuid, integer)` and `apply_rules_to_bank_transactions_internal(uuid, integer, boolean)`, both returning `(applied_count integer, total_count integer)`; `rebuild_account_balances(uuid)`.
- Produces: `public.drain_categorization_backlog() RETURNS integer` (signature unchanged) and a pg_cron job named `categorization-backlog-drain` on `*/5 * * * *`.

Three edits to the body as it stands at
[20260804090700_categorization_watermark_and_drain_convergence.sql:81-257](../../../supabase/migrations/20260804090700_categorization_watermark_and_drain_convergence.sql:81):

1. Both restaurant loops gain a deterministic wrapper + `ORDER BY random()`. Note the wrapper is **required**: `ORDER BY random()` directly on a `SELECT DISTINCT` is a syntax error ("for SELECT DISTINCT, ORDER BY expressions must appear in select list"), so the DISTINCT goes in a subquery.
2. The self-retire `IF … cron.unschedule … ELSE … END IF` block at
   [:195-253](../../../supabase/migrations/20260804090700_categorization_watermark_and_drain_convergence.sql:195)
   — comment header included — becomes an unconditional `RAISE LOG`. The `NOT EXISTS (… leftover …)` subquery goes with it; it had no other consumer.
3. New `COMMENT ON FUNCTION` stating the standing contract.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260804091000_standing_categorization_sweep.sql`:

```sql
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
```

- [ ] **Step 2: Apply it and confirm the job exists**

Run:

```bash
npm run db:reset
```

Expected: completes without error. Then confirm the standing job landed:

```bash
PGPASSWORD=postgres psql -h localhost -p 54322 -U postgres -d postgres -c "SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'categorization-backlog-drain';"
```

Expected: exactly one row, `*/5 * * * *`, `SELECT public.drain_categorization_backlog()`.

If `psql` is not on PATH, use the container the test runner falls back to:

```bash
docker exec -i "$(docker ps --format '{{.Names}}' | grep -E 'supabase_db_|supabase-db' | head -1)" psql -U postgres -d postgres -c "SELECT jobname, schedule FROM cron.job WHERE jobname = 'categorization-backlog-drain';"
```

- [ ] **Step 3: Commit**

```bash
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/categorization-standing-sweep add supabase/migrations/20260804091000_standing_categorization_sweep.sql
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/categorization-standing-sweep commit -m "fix(categorization): make the backlog drain a standing */5 sweep

It deleted its own cron job on a converged pass and retired on 2026-07-04,
stranding 3,351 bank rows and 9,333 POS rows with no automated driver. A
converged backlog is not terminal: the next rule a user creates re-opens
their whole history.

Also orders both restaurant loops randomly — a fixed planner order starves
whoever sorts last on every budget-exhausted tick once the job is permanent.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Invert the tests that pin self-retirement

**Files:**
- Modify: `supabase/tests/50_categorization_backlog_drain.sql`

Three assertions there encode the behaviour Task 1 removed. They are inverted, not deleted — an old test flipped to pin the new behaviour is the cheapest regression guard available. Test count stays at 10.

- [ ] **Step 1: Run the existing suite and watch these three fail**

Run:

```bash
npm run test:db
```

Expected: `50_categorization_backlog_drain.sql` fails on tests 6 and 10 (both assert the job was unscheduled; it now survives). Test 9 still passes. This confirms the old tests genuinely pinned the old behaviour.

- [ ] **Step 2: Rewrite the file header**

Replace lines 1-25 (from `-- Tests for the deferred categorization backlog drain` through the `-- (re)scheduled inside this rolled-back transaction ...` NOTE) with:

```sql
-- Tests for the standing categorization backlog sweep
-- Migrations: 20260703090000 (§7, original), 20260804090700 (convergence guard),
--             20260804091000 (standing sweep — retirement removed)
--
-- The original §7 drained the whole backlog synchronously inside the migration
-- and timed out production deploys (SQLSTATE 57014). It became a bounded
-- 5-minute pg_cron tick that unscheduled itself once converged — which stranded
-- every categorization path not wired into a sync function. It is now a
-- PERMANENT 5-minute tick that never retires.
--
-- Test plan (10 tests):
--  1  drain_categorization_backlog() exists
--  2  the drain job can be (re)scheduled on */5 * * * *
--  3  anon cannot execute the SECURITY DEFINER drain (PUBLIC revoked)
--  4  authenticated cannot execute it either
--  5  a tick on an empty database applies 0 rows (no error)
--  6  that converged tick leaves its own cron job scheduled
--  7  categorization_rules_watermark returns the newest active-rule timestamp
--  8  categorization_rules_watermark is NULL when no active rule covers the scope
--  9  a tick with a backlog waiting leaves the job scheduled
-- 10  a tick that exhausts the backlog still leaves the job scheduled
--
-- Tests 6 and 10 are the inverted forms of assertions that pinned the old
-- self-retirement. They are the regression guard for the 2026-07-04 strand:
-- if retirement ever returns, both fail.
```

- [ ] **Step 3: Invert test 6**

Replace lines 76-80:

```sql
-- Test 6: that complete, error-free, 0-row tick retired the cron job.
SELECT ok(
  NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'categorization-backlog-drain'),
  'a converged (complete + clean + 0-row) tick unschedules the drain job'
);
```

with:

```sql
-- Test 6: a converged tick does NOT retire the job. Convergence is not a
-- terminal state — the next rule a user creates lowers the watermark and makes
-- their whole history a candidate again, and this job is the only driver that
-- would notice.
SELECT ok(
  EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'categorization-backlog-drain'),
  'a converged (complete + clean + 0-row) tick leaves the drain job scheduled'
);
```

- [ ] **Step 4: Rewrite the retirement-guard comment block**

Replace lines 82-89 (the `-- Retirement guard (20260804090700)` block) with:

```sql
-- ---------------------------------------------------------------------------
-- Claim accounting (20260804090700). The sweeps claim FOR UPDATE SKIP LOCKED,
-- so a tick can claim 0 rows while a backlog is still there — which is why
-- total_count (claimed), not applied_count (matched), drives the drain loop.
-- Tests 9/10 pin that the job survives both states: work waiting, and work
-- exhausted.
-- ---------------------------------------------------------------------------
```

- [ ] **Step 5: Delete the now-dead re-arm block**

Delete lines 148-159 entirely — the comment `-- Re-arm the job that test 6 retired, ...` and the `DO $$ ... END $$;` that follows it. Test 6 no longer retires anything, so there is nothing to re-arm.

- [ ] **Step 6: Keep the statement-snapshot comment verbatim, and invert test 10**

Leave lines 161-165 (the `-- Each tick runs as its OWN statement ...` warning) exactly as they are. That hazard caused a real pgTAP failure and still applies to any assertion that reads `cron.job` after calling the drain.

Test 9 (lines 167-173) is unchanged — still true, still meaningful.

Replace lines 175-183:

```sql
-- Test 10: the previous tick stamped every candidate, so nothing claimable is
-- left and the next tick converges. Guards against a leftover check so wide
-- that unmatched rows keep the job scheduled forever.
SELECT public.drain_categorization_backlog();

SELECT ok(
  NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'categorization-backlog-drain'),
  'once every candidate is evaluated the drain still retires itself'
);
```

with:

```sql
-- Test 10: the previous tick stamped every candidate, so this one converges —
-- and the job still survives. Together with test 9 this pins job survival
-- across both outcomes, which is what makes the sweep permanent.
SELECT public.drain_categorization_backlog();

SELECT ok(
  EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'categorization-backlog-drain'),
  'a tick that exhausts the backlog still leaves the job scheduled'
);
```

- [ ] **Step 7: Run the suite and verify 50 passes**

Run:

```bash
npm run test:db
```

Expected: `50_categorization_backlog_drain.sql` reports 10/10 passing.

- [ ] **Step 8: Commit**

```bash
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/categorization-standing-sweep add supabase/tests/50_categorization_backlog_drain.sql
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/categorization-standing-sweep commit -m "test(categorization): invert the assertions that pinned self-retirement

Tests 6 and 10 asserted the drain unschedules its own cron job. They now
assert the opposite, so they become the regression guard for the 2026-07-04
strand rather than a pin on the bug that caused it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Conformance test — the properties that make future POS coverage free

**Files:**
- Create: `supabase/tests/51_standing_categorization_sweep.sql`

**Interfaces:**
- Consumes: `public.drain_categorization_backlog()`, `public.apply_rules_to_pos_sales_internal(uuid, integer)`, the `categorization-backlog-drain` cron job created in Task 1.
- Produces: nothing. Terminal test file.

Fixture namespace is `dddddddd-0000-0000-0000-…`, grep-verified unused anywhere under `supabase/` (`bbbbbbbb-0000` belongs to `50_categorization_backlog_drain.sql:91-110`, `cccccccc-0000` to `schedule_plan_templates.test.sql` and `receipt_file_hash.test.sql`).

Two things this file does differently from 50, both deliberate:

- It asserts the **real, migration-created** job rather than re-scheduling one inside the transaction. 50 could not do that, because the live pg_cron in the test database might legitimately have retired the job before the file ran ([50:20-25](../../../supabase/tests/50_categorization_backlog_drain.sql:20)). With retirement gone, the job's existence is deterministic — and asserting the real one is what actually proves the migration scheduled it.
- Rows are inserted **before** their matching rules exist, so the `BEFORE INSERT` triggers (`auto_categorize_pos_sale` at [20251111000000:554-558](../../../supabase/migrations/20251111000000_enhanced_categorization_rules.sql:554), `auto_categorize_bank_transaction` at [20251111000000:611-614](../../../supabase/migrations/20251111000000_enhanced_categorization_rules.sql:611)) find nothing to apply. That needs no GUC suppression and reproduces the production bug exactly: a row that existed before its rule did. Note `auto_apply_bank_categorization_rules` honours no skip GUC, so ordering is the only way to leave a bank row uncategorized.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/51_standing_categorization_sweep.sql`:

```sql
-- Conformance tests for the standing categorization sweep
-- Migration: 20260804091000_standing_categorization_sweep.sql
--
-- These are the codified pattern for future POS integrations. Categorization
-- reaches a new POS with zero wiring only while three properties hold, and each
-- test below pins one of them:
--
--   * the sweep job runs permanently and never retires  (tests 1, 4)
--   * the drain cannot reacquire the ability to retire   (test 2)
--   * the sweep carries no pos_system predicate          (tests 3, 5)
--
-- If a future change breaks one of these, the failure message says which
-- property was lost and why it mattered.
--
-- Test plan (7 tests):
--  1  the migration scheduled a standing */5 categorization-backlog-drain job
--  2  drain_categorization_backlog contains no cron.unschedule
--  3  apply_rules_to_pos_sales_internal contains no pos_system predicate
--  4  a converged tick leaves the standing job scheduled
--  5  a row whose pos_system no sync function knows about is still categorized
--  6  a bank_transactions candidate is categorized by the same mechanism
--  7  one tick covers both tables

BEGIN;
SELECT plan(7);

-- Test 1: the job the migration created is really there, on the real schedule.
-- Unlike 50_categorization_backlog_drain.sql this does NOT re-schedule the job
-- first: with retirement gone, the migration-time job's existence is
-- deterministic, and asserting the real one is what proves the migration
-- scheduled it at all.
SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'categorization-backlog-drain'),
  '*/5 * * * *',
  'the migration leaves a standing categorization-backlog-drain job on */5'
);

-- ---------------------------------------------------------------------------
-- Tests 2/3 match against the function source with SQL comments stripped.
-- Without stripping they would punish exactly the behaviour this codebase
-- rewards: 20260804091000 carries a comment saying "do not add a pos_system
-- filter", and an unstripped match would fail on the warning that explains the
-- test. Strip block comments first (dot-matches-newline), then line comments.
-- ---------------------------------------------------------------------------

-- Test 2: the drain can never reacquire the ability to retire. Structural, not
-- behavioural — test 4 proves it does not retire on a converged tick, this
-- proves the code to do so is simply absent on every path.
SELECT ok(
  regexp_replace(
    regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'),
    '--[^\n]*', '', 'g'
  ) NOT ILIKE '%cron.unschedule%',
  'drain_categorization_backlog contains no cron.unschedule'
)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'drain_categorization_backlog';

-- Test 3: THE property that makes a future POS free. The sweep selects
-- candidates by restaurant_id and watermark only. Adding "AND s.pos_system =
-- ..." as an optimization would silently orphan every other POS, exactly as
-- relying on per-POS sync wiring already did.
SELECT ok(
  regexp_replace(
    regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'),
    '--[^\n]*', '', 'g'
  ) NOT ILIKE '%pos_system%',
  'apply_rules_to_pos_sales_internal carries no pos_system predicate'
)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'apply_rules_to_pos_sales_internal';

-- ---------------------------------------------------------------------------
-- Fixtures. Rows are inserted BEFORE their rules exist, so the BEFORE INSERT
-- triggers find nothing to apply and both rows land as genuine candidates
-- (rules_evaluated_at defaults to '-infinity'). This reproduces the production
-- bug directly: a row that predates the rule that would match it.
-- auto_apply_bank_categorization_rules honours no skip GUC, so insert ordering
-- is the only way to leave a bank row uncategorized.
-- ---------------------------------------------------------------------------

INSERT INTO restaurants (id, name) VALUES
  ('dddddddd-0000-0000-0000-0000000000a1', 'Standing Sweep Restaurant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO chart_of_accounts
  (id, restaurant_id, account_name, account_code, account_type, account_subtype, normal_balance)
VALUES
  ('dddddddd-0000-0000-0000-0000000000c1', 'dddddddd-0000-0000-0000-0000000000a1',
   'Food Sales', '4000', 'revenue', 'sales', 'credit')
ON CONFLICT (id) DO NOTHING;

INSERT INTO connected_banks
  (id, restaurant_id, stripe_financial_account_id, institution_name)
VALUES
  ('dddddddd-0000-0000-0000-0000000000b1', 'dddddddd-0000-0000-0000-0000000000a1',
   'fca_standing_sweep_fixture', 'Placeholder Bank')
ON CONFLICT (id) DO NOTHING;

-- A pos_system value no sync function, connection table, or edge function
-- knows about. unified_sales.pos_system is a bare TEXT NOT NULL with no CHECK
-- and no enum (20250925125415:13), which is itself part of why a new POS needs
-- no migration — if this INSERT ever starts failing, that property is gone.
INSERT INTO unified_sales
  (id, restaurant_id, pos_system, external_order_id, item_name, quantity,
   sale_date, total_price)
VALUES
  ('dddddddd-0000-0000-0000-0000000000d1', 'dddddddd-0000-0000-0000-0000000000a1',
   'future_pos', 'ord-future-1', 'Future POS Item', 1, CURRENT_DATE, 12.00)
ON CONFLICT (id) DO NOTHING;

INSERT INTO bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id,
   transaction_date, description, amount)
VALUES
  ('dddddddd-0000-0000-0000-0000000000e1', 'dddddddd-0000-0000-0000-0000000000a1',
   'dddddddd-0000-0000-0000-0000000000b1', 'txn_standing_sweep_fixture',
   CURRENT_DATE, 'STANDING SWEEP VENDOR', -25.00)
ON CONFLICT (id) DO NOTHING;

-- Now the rules, after the rows. The restaurant has no POS connection row of
-- any kind — the drain selects restaurants by RULE, so it is swept anyway.
INSERT INTO categorization_rules
  (id, restaurant_id, rule_name, applies_to, category_id, item_name_pattern,
   item_name_match_type, is_active, auto_apply, priority, created_at, updated_at)
VALUES
  ('dddddddd-0000-0000-0000-0000000000f1', 'dddddddd-0000-0000-0000-0000000000a1',
   'Future POS rule', 'pos_sales', 'dddddddd-0000-0000-0000-0000000000c1',
   'Future POS Item', 'exact', true, true, 10,
   '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO categorization_rules
  (id, restaurant_id, rule_name, applies_to, category_id, description_pattern,
   description_match_type, is_active, auto_apply, priority, created_at, updated_at)
VALUES
  ('dddddddd-0000-0000-0000-0000000000f2', 'dddddddd-0000-0000-0000-0000000000a1',
   'Standing sweep bank rule', 'bank_transactions', 'dddddddd-0000-0000-0000-0000000000c1',
   'STANDING SWEEP VENDOR', 'exact', true, true, 10,
   '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- One tick, captured so tests 5, 6 and 7 all describe the SAME tick.
CREATE TEMP TABLE standing_sweep_tick AS
SELECT public.drain_categorization_backlog() AS applied;

-- Test 5: the whole point. Nothing anywhere knows what 'future_pos' is, and it
-- is categorized regardless — because the sweep selects by restaurant and
-- watermark, never by POS.
SELECT ok(
  (SELECT is_categorized AND category_id = 'dddddddd-0000-0000-0000-0000000000c1'
   FROM unified_sales WHERE id = 'dddddddd-0000-0000-0000-0000000000d1'),
  'a row whose pos_system no sync function knows about is still categorized'
);

-- Test 6: bank_transactions is covered by the same standing job. Before
-- 20260804091000 its only driver was stripe-sync-transactions, and only on a
-- sync that found new rows — so a backlog with no new activity never drained.
SELECT ok(
  (SELECT is_categorized AND category_id = 'dddddddd-0000-0000-0000-0000000000c1'
   FROM bank_transactions WHERE id = 'dddddddd-0000-0000-0000-0000000000e1'),
  'a bank_transactions candidate is categorized by a drain tick'
);

-- Test 7: both of the above came from ONE tick of ONE job. This is the
-- "one standing job covers everything" claim, stated as an assertion.
SELECT cmp_ok(
  (SELECT applied FROM standing_sweep_tick),
  '>=',
  2,
  'a single tick applies both the POS row and the bank row'
);

-- Test 4: the backlog is now exhausted for this restaurant, and the job still
-- survives. Run as its OWN statement, never folded into the assertion: an outer
-- scan of cron.job reads the snapshot taken when the statement began, so a
-- cron.unschedule() performed by a volatile function in the same command is
-- invisible to it — the combined form would silently test nothing.
SELECT public.drain_categorization_backlog();

SELECT ok(
  EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'categorization-backlog-drain'),
  'a converged tick leaves the standing job scheduled'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run it against the migration from Task 1**

Run:

```bash
npm run test:db
```

Expected: `51_standing_categorization_sweep.sql` reports 7/7 passing.

If test 5 or 6 fails with the row still uncategorized, the likely cause is the watermark: `categorization_rules_watermark` returns `max(GREATEST(created_at, updated_at))` over active rules, and the sweep only claims rows whose `rules_evaluated_at` is strictly less than it. The fixture rules are stamped `2026-01-01`, which is greater than the `-infinity` default, so this should hold; if a touch trigger has rewritten `updated_at`, read the actual watermark with:

```bash
PGPASSWORD=postgres psql -h localhost -p 54322 -U postgres -d postgres -c "SELECT public.categorization_rules_watermark('dddddddd-0000-0000-0000-0000000000a1','pos_sales');"
```

- [ ] **Step 3: Prove the conformance tests actually bite**

A conformance test that cannot fail is decoration. Temporarily add `AND s.pos_system IS NOT NULL` to the batch CTE in `apply_rules_to_pos_sales_internal` (in a scratch `psql` session, not in a file), re-run `npm run test:db`, and confirm test 3 fails. Then `npm run db:reset` to discard the scratch change.

Expected: test 3 fails with `apply_rules_to_pos_sales_internal carries no pos_system predicate`; after the reset, 7/7 pass again.

- [ ] **Step 4: Commit**

```bash
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/categorization-standing-sweep add supabase/tests/51_standing_categorization_sweep.sql
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/categorization-standing-sweep commit -m "test(categorization): codify the standing-sweep contract for future POS

Pins the three properties that let a new POS inherit categorization with no
wiring: the job runs permanently, the drain cannot reacquire the ability to
retire, and the sweep carries no pos_system predicate. Test 5 proves it
behaviourally with a pos_system value nothing in the codebase knows about.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Full verification

**Files:** none modified.

- [ ] **Step 1: Full database suite**

Run:

```bash
npm run test:db
```

Expected: every file passes, including 50 (10/10) and 51 (7/7).

- [ ] **Step 2: Typecheck and lint**

Run:

```bash
npm run typecheck && npm run lint
```

Expected: both clean. No TypeScript changed, so this is a no-regression check — `drain_categorization_backlog`'s signature is unchanged, so `src/integrations/supabase/types.ts` needs no regeneration.

- [ ] **Step 3: Unit suite**

Run:

```bash
npm run test
```

Expected: passes. Nothing in `src/` changed.

**E2E:** none, and this is a deliberate exception to the Phase 8 coverage gate rather than an omission. The change is a pg_cron-scheduled SQL function; there is no route, dialog, form, or flow to drive, and Playwright cannot advance pg_cron. pgTAP is the only level at which this behaviour is observable.

---

## Post-deploy verification (not a build step — run within minutes of merge)

On 2026-07-05 a scheduler change passed five reviewers, Codex, CodeRabbit, 19 pgTAP tests and full CI, and the defect was caught only by production verification minutes after deploy. "Cron ticks succeeded" says nothing about whether work is being *selected*. Against production, read-only:

```sql
-- 1. the standing job exists
SELECT jobid, jobname, schedule, active FROM cron.job
WHERE jobname = 'categorization-backlog-drain';

-- 2. its ticks are succeeding
SELECT status, count(*), max(end_time)
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'categorization-backlog-drain')
GROUP BY status;

-- 3. work is actually being selected — these counts must FALL
SELECT 'bank' AS scope, count(*) FROM bank_transactions bt
WHERE (bt.is_categorized = false OR bt.category_id IS NULL)
  AND bt.is_split = false AND bt.excluded_reason IS NULL
  AND bt.rules_evaluated_at
      < public.categorization_rules_watermark(bt.restaurant_id, 'bank_transactions')
UNION ALL
SELECT s.pos_system, count(*) FROM unified_sales s
WHERE (s.is_categorized = false OR s.category_id IS NULL)
  AND s.is_split = false
  AND s.rules_evaluated_at
      < public.categorization_rules_watermark(s.restaurant_id, 'pos_sales')
GROUP BY s.pos_system;
```

Baseline to beat (production, 2026-08-04): bank 3,351; lighthouse 7,967; manual_upload 955; square 185; toast 153; clover 37; manual 36.

Also confirm ticks settle to sub-second once drained, and that no restaurant is starved — if one `pos_system` stops falling while others clear, the `ORDER BY random()` rotation is not keeping up and the budget needs raising.

```sql
-- 4. churn: the stamp on rules_evaluated_at can never be a HOT update, because
-- that column is a leading key of both candidate indexes. Not new — but the
-- standing job extends it permanently to bank_transactions and to the POS
-- systems that previously only saw the one-shot insert trigger.
SELECT relname, n_live_tup, n_dead_tup,
       round(100.0*n_dead_tup/GREATEST(n_live_tup,1),2) AS dead_pct,
       round(100.0*n_tup_hot_upd/GREATEST(n_tup_upd,1),1) AS hot_pct,
       last_autovacuum
FROM pg_stat_user_tables
WHERE relname IN ('unified_sales','bank_transactions','categorization_rules');
```

Baseline (production, 2026-08-04): `unified_sales` 190,727 live / 8,745 dead (4.59%) / 72.2% HOT; `bank_transactions` 7,532 live / 561 dead (7.45%) / 2.0% HOT; `categorization_rules` 956 live / 159 dead (16.63%) / 89.6% HOT. Expect dead-tuple counts to spike while the backlog drains and then settle. If `dead_pct` on either table climbs past ~20% and stays there once the backlog is clear, lower `autovacuum_vacuum_scale_factor` on that table rather than slowing the job.

## Self-Review

**Spec coverage.** Every design section maps to a task: §1 (drain replacement) and §2 (schedule) → Task 1; §3 (conformance test) → Task 3; §4 (invert tests) → Task 2; "What this does not change" → verified by Task 4 finding no `src/` or edge-function work. The review-response items are all carried: comment-stripped regex in Task 3 Step 1, `ORDER BY random()` with the DISTINCT-wrapper syntax fix in Task 1 Step 1, the overlap note in the migration's own comments.

**Placeholder scan.** No TBD, no "add error handling", no "similar to Task N". Every code step carries the literal file content.

**Type consistency.** `drain_categorization_backlog()` keeps `RETURNS integer` throughout; `apply_rules_to_pos_sales_internal(uuid, integer)` and `apply_rules_to_bank_transactions_internal(uuid, integer, boolean)` are called with the same arities the existing body uses. The job name string `categorization-backlog-drain` is identical in the migration, both test files, and the verification queries.
