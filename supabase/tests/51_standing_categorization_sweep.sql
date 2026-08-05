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
--
-- NOTE: tests run out of numeric order below -- 1, 2, 3, 5, 6, 7, then 4 last.
-- Test 4 must run after the backlog-exhausting ticks used by 5/6/7 so it
-- asserts the job survives post-convergence; see the comment at test 4.

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

-- apply_rules_to_bank_transactions_internal posts a journal entry for each
-- categorized row and requires a Cash account (account_code 1000) to exist for
-- the restaurant, or it raises and the whole batch is skipped
-- (20260703090000:519-528). Without this row test 6 fails silently: the
-- function logs a WARNING and leaves the bank row uncategorized.
INSERT INTO chart_of_accounts
  (id, restaurant_id, account_name, account_code, account_type, account_subtype, normal_balance)
VALUES
  ('dddddddd-0000-0000-0000-0000000000c2', 'dddddddd-0000-0000-0000-0000000000a1',
   'Cash', '1000', 'asset', 'cash', 'debit')
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
