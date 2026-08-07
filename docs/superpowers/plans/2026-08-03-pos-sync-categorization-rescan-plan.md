# POS Sync Categorization Rescan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the POS/bank categorization sweeps from re-evaluating every uncategorized row against every rule on every cron tick, and make a per-restaurant sync failure visible instead of silent.

**Architecture:** Add a `rules_evaluated_at` negative-result marker to `unified_sales` and `bank_transactions`. Each sweep computes a per-restaurant rule watermark, selects and stamps a bounded batch *before* the matcher runs (so `LIMIT` actually bounds work), then matches only that batch. A `BEFORE UPDATE` trigger resets the marker when a row's match inputs change; a rule edit moves the watermark and re-opens the whole restaurant with zero writes. Separately, the four `sync_all_*` cron wrappers gain an explicit `query_canceled` handler arm and record failures on the existing `<pos>_connections` columns, and Revel gets its missing sweep call.

**Tech Stack:** PostgreSQL 17.6 (Supabase), plpgsql, pgTAP, Supabase CLI migrations.

## Global Constraints

- **Design doc is authoritative:** `docs/superpowers/specs/2026-08-03-pos-sync-categorization-rescan-design.md`. Section references below (§3.1 … §5) point into it.
- **`CREATE OR REPLACE FUNCTION` is a full-body rewrite.** Always copy the body from the *latest* definition that sorts before the new migration — never from an older file and never from memory. Copy sources are pinned per task below and were verified against production `pg_get_functiondef`.
- **`CREATE INDEX CONCURRENTLY` cannot run inside a transaction.** The Supabase CLI wraps each migration file in one, so every CIC statement lives alone in its own migration file (existing convention: `supabase/migrations/20260727130000_idx_unified_sales_restaurant_item_name.sql`).
- **Migration filename prefixes must be unique** — Supabase keys `schema_migrations` on the 14-digit prefix alone.
- **Every new `public` function must carry an explicit `REVOKE`/`GRANT`.** Supabase's `pg_default_acl` grants `EXECUTE` on new `public` functions to `anon` and `authenticated`; a `SECURITY DEFINER` function without a `REVOKE` is a cross-tenant write reachable with the anon key.
- **The watermark predicate must never be narrower than the matcher's rule predicate** (§3.2). `find_matching_rules_for_pos_sale` filters on `cr.is_active = true AND (cr.applies_to = 'pos_sales' OR cr.applies_to = 'both')` and nothing else — in particular **not** on `auto_apply`.
- **Existing function attributes are preserved verbatim**: `SECURITY DEFINER`, `SET search_path`, parameter defaults, return types, `p_batch_limit` validation, split-rule branch, `apply_count` bookkeeping.
- **Fixture INSERTs must cover every `NOT NULL` column that has no default.** The column lists below were checked against production, but a local migration may add one. Task 1 Step 2 runs the check once for all five fixture tables; if it reports a column not present in a fixture INSERT, add an explicit value for it rather than guessing at a default.
- Work in the worktree `/Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/pos-sync-rescan` on branch `fix/pos-sync-categorization-rescan`. Never commit to `main`. Stage explicit paths — never `git add -A`, `git add .`, or `git commit -a`.
- Run DB tests with `npm run test:db` (requires `npm run db:start` once, then `npm run db:reset` after adding migrations).

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260804090000_rules_evaluated_at_columns.sql` | Both `ADD COLUMN`s, both reset trigger functions + triggers, PostgREST schema reload |
| `supabase/migrations/20260804090100_idx_unified_sales_rule_candidates_v2.sql` | One `CREATE INDEX CONCURRENTLY`, nothing else |
| `supabase/migrations/20260804090200_idx_bank_transactions_rule_candidates_v2.sql` | One `CREATE INDEX CONCURRENTLY`, nothing else |
| `supabase/migrations/20260804090300_bounded_categorization_sweep.sql` | `CREATE OR REPLACE` of both internal sweep functions |
| `supabase/migrations/20260804090400_pos_sync_failure_visibility.sql` | `record_pos_sync_error()` + its `REVOKE`/`GRANT`, the four `sync_all_*` wrappers, the Revel sweep call |
| `supabase/migrations/20260804090500_drop_superseded_rule_candidate_indexes.sql` | `DROP INDEX CONCURRENTLY` ×1 (unified_sales) |
| `supabase/migrations/20260804090600_drop_superseded_bank_rule_candidate_index.sql` | `DROP INDEX CONCURRENTLY` ×1 (bank_transactions) |
| `supabase/tests/pos_rules_rescan_cache.test.sql` | pgTAP for §3.1–§3.6 and §3.8 (spec tests 1–12, 16) |
| `supabase/tests/pos_sync_failure_visibility.test.sql` | pgTAP for §3.7 (spec tests 13–15) |

`DROP INDEX CONCURRENTLY` has the same no-transaction restriction as `CREATE INDEX CONCURRENTLY`, which is why the two drops get one file each rather than sharing `…090500`.

---

### Task 1: `rules_evaluated_at` columns and reset triggers

Implements §3.1 and §3.5. Spec tests 6 and the `bank_transactions` half of test 11.

**Files:**
- Create: `supabase/migrations/20260804090000_rules_evaluated_at_columns.sql`
- Create: `supabase/tests/pos_rules_rescan_cache.test.sql`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `public.unified_sales.rules_evaluated_at timestamptz NOT NULL DEFAULT '-infinity'`
  - `public.bank_transactions.rules_evaluated_at timestamptz NOT NULL DEFAULT '-infinity'`
  - `public.reset_unified_sales_rules_evaluated_at() RETURNS trigger`
  - `public.reset_bank_transactions_rules_evaluated_at() RETURNS trigger`
  - triggers `trigger_reset_unified_sales_rules_evaluated_at`, `trigger_reset_bank_transactions_rules_evaluated_at`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/pos_rules_rescan_cache.test.sql`:

```sql
BEGIN;
SELECT plan(4);

SET LOCAL role TO postgres;

-- ---------------------------------------------------------------- fixtures
INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-0000000009a1', 'Rescan Test Restaurant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO chart_of_accounts
  (id, restaurant_id, account_name, account_code, account_type, account_subtype, normal_balance)
VALUES
  ('00000000-0000-0000-0000-0000000009c1', '00000000-0000-0000-0000-0000000009a1',
   'Food Sales', '4000', 'revenue', 'sales', 'credit'),
  ('00000000-0000-0000-0000-0000000009c2', '00000000-0000-0000-0000-0000000009a1',
   'Cash', '1000', 'asset', 'cash', 'debit')
ON CONFLICT (id) DO UPDATE SET account_name = EXCLUDED.account_name;

INSERT INTO connected_banks (id, restaurant_id, stripe_financial_account_id, institution_name)
VALUES
  ('00000000-0000-0000-0000-0000000009b1', '00000000-0000-0000-0000-0000000009a1',
   'fa_rescan_test', 'Rescan Test Bank')
ON CONFLICT (id) DO NOTHING;

INSERT INTO unified_sales
  (id, restaurant_id, pos_system, external_order_id, item_name, quantity, sale_date,
   total_price, pos_category)
VALUES
  ('00000000-0000-0000-0000-0000000009d1', '00000000-0000-0000-0000-0000000009a1',
   'toast', 'ord-rescan-1', 'Widget Burger', 1, CURRENT_DATE, 10.00, 'Entrees')
ON CONFLICT (id) DO NOTHING;

INSERT INTO bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date,
   description, amount)
VALUES
  ('00000000-0000-0000-0000-0000000009e1', '00000000-0000-0000-0000-0000000009a1',
   '00000000-0000-0000-0000-0000000009b1', 'txn-rescan-1', now(),
   'SYSCO FOOD SERVICE', -250.00)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------- TEST 1-2
-- New columns exist and default to '-infinity' for freshly inserted rows.
SELECT is(
  (SELECT rules_evaluated_at FROM unified_sales
    WHERE id = '00000000-0000-0000-0000-0000000009d1'),
  '-infinity'::timestamptz,
  'unified_sales.rules_evaluated_at defaults to -infinity'
);

SELECT is(
  (SELECT rules_evaluated_at FROM bank_transactions
    WHERE id = '00000000-0000-0000-0000-0000000009e1'),
  '-infinity'::timestamptz,
  'bank_transactions.rules_evaluated_at defaults to -infinity'
);

-- ---------------------------------------------------------------- TEST 3
-- Changing a match input resets the stamp; changing an unrelated column does not.
UPDATE unified_sales SET rules_evaluated_at = now()
 WHERE id = '00000000-0000-0000-0000-0000000009d1';
UPDATE unified_sales SET quantity = 2
 WHERE id = '00000000-0000-0000-0000-0000000009d1';
UPDATE unified_sales SET item_name = 'Widget Burger Deluxe'
 WHERE id = '00000000-0000-0000-0000-0000000009d1';

SELECT is(
  (SELECT rules_evaluated_at FROM unified_sales
    WHERE id = '00000000-0000-0000-0000-0000000009d1'),
  '-infinity'::timestamptz,
  'changing item_name resets rules_evaluated_at (and changing quantity did not)'
);

-- ---------------------------------------------------------------- TEST 4
UPDATE bank_transactions SET rules_evaluated_at = now()
 WHERE id = '00000000-0000-0000-0000-0000000009e1';
UPDATE bank_transactions SET is_reconciled = true
 WHERE id = '00000000-0000-0000-0000-0000000009e1';
UPDATE bank_transactions SET amount = -300.00
 WHERE id = '00000000-0000-0000-0000-0000000009e1';

SELECT is(
  (SELECT rules_evaluated_at FROM bank_transactions
    WHERE id = '00000000-0000-0000-0000-0000000009e1'),
  '-infinity'::timestamptz,
  'changing amount resets rules_evaluated_at (and changing is_reconciled did not)'
);

SELECT * FROM finish();
ROLLBACK;
```

The two "and changing X did not" clauses are load-bearing: if the trigger reset on *every* update, the intermediate `quantity` / `is_reconciled` update would already have reset the stamp and the assertion would still pass — but the preceding `SET rules_evaluated_at = now()` would then have to survive it, which it does only if the trigger is correctly selective. Step 5 adds the explicit negative assertion.

- [ ] **Step 2: Confirm the fixture INSERTs cover every mandatory column**

```bash
psql "postgresql://postgres:postgres@localhost:54322/postgres" -c "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('restaurants','chart_of_accounts','connected_banks','unified_sales','bank_transactions','categorization_rules','toast_connections') AND is_nullable = 'NO' AND column_default IS NULL ORDER BY table_name, ordinal_position;"
```

Every column this prints must appear in the corresponding fixture `INSERT` above (or in Task 6's). If one does not, add an explicit value for it — do not assume a default exists. Expected on a clean local DB: `restaurants.id/name`, `chart_of_accounts.restaurant_id/account_name/account_code/account_type/normal_balance`, `connected_banks.restaurant_id/stripe_financial_account_id/institution_name`, `unified_sales.restaurant_id/pos_system/external_order_id/item_name/sale_date`, `bank_transactions.restaurant_id/connected_bank_id/stripe_transaction_id/transaction_date/description/amount`, all of which are already supplied.

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm run test:db
```

Expected: `pos_rules_rescan_cache.test.sql` fails with `ERROR: column "rules_evaluated_at" of relation "unified_sales" does not exist`.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260804090000_rules_evaluated_at_columns.sql`:

```sql
-- Negative-result cache for the rule-matching sweeps.
--
-- apply_rules_to_pos_sales_internal / apply_rules_to_bank_transactions_internal
-- re-evaluated every uncategorized row against every active rule on every cron
-- tick (288x/day for Toast). Rows that match nothing stayed candidates forever.
-- rules_evaluated_at records "this row was already evaluated against the rule
-- set as of <timestamp>"; the sweep skips rows whose stamp is at or above the
-- restaurant's current rule watermark.
--
-- '-infinity' is a non-volatile constant, so on PG 11+ this ADD COLUMN uses the
-- fast-default path: metadata-only, no rewrite of the 190k-row unified_sales
-- heap. Existing rows therefore become candidates exactly once, then drain.
--
-- Design: docs/superpowers/specs/2026-08-03-pos-sync-categorization-rescan-design.md §3.1, §3.5

ALTER TABLE public.unified_sales
  ADD COLUMN IF NOT EXISTS rules_evaluated_at timestamptz NOT NULL DEFAULT '-infinity';

ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS rules_evaluated_at timestamptz NOT NULL DEFAULT '-infinity';

COMMENT ON COLUMN public.unified_sales.rules_evaluated_at IS
  'Rule watermark this row was last evaluated against by '
  'apply_rules_to_pos_sales_internal. -infinity means "never evaluated". '
  'Reset to -infinity by trigger when item_name/total_price/pos_category change.';

COMMENT ON COLUMN public.bank_transactions.rules_evaluated_at IS
  'Rule watermark this row was last evaluated against by '
  'apply_rules_to_bank_transactions_internal. -infinity means "never evaluated". '
  'Reset to -infinity by trigger when description/amount change.';

-- Reset the cache when the row's own match inputs change.
--
-- A trigger rather than patching each writer: POS sync RPCs, edge-function
-- PostgREST upserts, and manual UI edits all reach these tables by different
-- paths, and an ON CONFLICT DO UPDATE in one of them is not visible to the
-- others. The trigger deliberately does NOT honour
-- app.skip_unified_sales_triggers -- suppressing it would silently poison the
-- cache for exactly the rows a sync just rewrote.
CREATE OR REPLACE FUNCTION public.reset_unified_sales_rules_evaluated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.item_name    IS DISTINCT FROM OLD.item_name
  OR NEW.total_price  IS DISTINCT FROM OLD.total_price
  OR NEW.pos_category IS DISTINCT FROM OLD.pos_category THEN
    NEW.rules_evaluated_at := '-infinity';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_bank_transactions_rules_evaluated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.description IS DISTINCT FROM OLD.description
  OR NEW.amount      IS DISTINCT FROM OLD.amount
  OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id THEN
    NEW.rules_evaluated_at := '-infinity';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_reset_unified_sales_rules_evaluated_at
  ON public.unified_sales;
CREATE TRIGGER trigger_reset_unified_sales_rules_evaluated_at
  BEFORE UPDATE ON public.unified_sales
  FOR EACH ROW
  EXECUTE FUNCTION public.reset_unified_sales_rules_evaluated_at();

DROP TRIGGER IF EXISTS trigger_reset_bank_transactions_rules_evaluated_at
  ON public.bank_transactions;
CREATE TRIGGER trigger_reset_bank_transactions_rules_evaluated_at
  BEFORE UPDATE ON public.bank_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.reset_bank_transactions_rules_evaluated_at();

NOTIFY pgrst, 'reload schema';
```

`supplier_id` is in the bank reset list because `find_matching_rules_for_bank_transaction` reads it (supplier-only rules filter on it) — verified against production `pg_get_functiondef`. `unified_sales` has no equivalent third input beyond the three listed.

- [ ] **Step 5: Apply the migration and run the test to verify it passes**

```bash
npm run db:reset && npm run test:db
```

Expected: all 4 assertions in `pos_rules_rescan_cache.test.sql` pass.

- [ ] **Step 6: Add the explicit negative assertions**

In `supabase/tests/pos_rules_rescan_cache.test.sql`, change `SELECT plan(4);` to `SELECT plan(6);` and insert these two assertions immediately before `SELECT * FROM finish();`:

```sql
-- ---------------------------------------------------------------- TEST 5-6
-- Selectivity: an update touching no match input must leave the stamp alone.
UPDATE unified_sales SET rules_evaluated_at = '2026-01-01T00:00:00Z'
 WHERE id = '00000000-0000-0000-0000-0000000009d1';
UPDATE unified_sales SET external_order_id = 'ord-rescan-1-renamed'
 WHERE id = '00000000-0000-0000-0000-0000000009d1';

SELECT is(
  (SELECT rules_evaluated_at FROM unified_sales
    WHERE id = '00000000-0000-0000-0000-0000000009d1'),
  '2026-01-01T00:00:00Z'::timestamptz,
  'updating a non-match-input column leaves unified_sales.rules_evaluated_at intact'
);

UPDATE bank_transactions SET rules_evaluated_at = '2026-01-01T00:00:00Z'
 WHERE id = '00000000-0000-0000-0000-0000000009e1';
UPDATE bank_transactions SET is_transfer = true
 WHERE id = '00000000-0000-0000-0000-0000000009e1';

SELECT is(
  (SELECT rules_evaluated_at FROM bank_transactions
    WHERE id = '00000000-0000-0000-0000-0000000009e1'),
  '2026-01-01T00:00:00Z'::timestamptz,
  'updating a non-match-input column leaves bank_transactions.rules_evaluated_at intact'
);
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npm run test:db
```

Expected: 6/6 pass.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260804090000_rules_evaluated_at_columns.sql supabase/tests/pos_rules_rescan_cache.test.sql
git commit -m "feat(db): add rules_evaluated_at negative cache column and reset triggers"
```

---

### Task 2: Candidate index on `unified_sales`

Implements the `unified_sales` half of §3.6.

**Files:**
- Create: `supabase/migrations/20260804090100_idx_unified_sales_rule_candidates_v2.sql`
- Modify: `supabase/tests/pos_rules_rescan_cache.test.sql`

**Interfaces:**
- Consumes: `unified_sales.rules_evaluated_at` (Task 1).
- Produces: index `idx_unified_sales_rule_candidates_v2`.

- [ ] **Step 1: Write the failing test**

In `supabase/tests/pos_rules_rescan_cache.test.sql`, change `SELECT plan(6);` to `SELECT plan(7);` and add before `SELECT * FROM finish();`:

```sql
-- ---------------------------------------------------------------- TEST 7
SELECT has_index(
  'public', 'unified_sales', 'idx_unified_sales_rule_candidates_v2',
  'partial candidate index on unified_sales exists'
);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:db
```

Expected: `not ok 7 - partial candidate index on unified_sales exists`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260804090100_idx_unified_sales_rule_candidates_v2.sql`:

```sql
-- Candidate index for apply_rules_to_pos_sales_internal's batch selection.
--
-- Supersedes idx_unified_sales_rule_candidates (restaurant_id, sale_date DESC)
-- with the same partial predicate. rules_evaluated_at is inserted as the second
-- key so the new `rules_evaluated_at < v_rules_changed_at` predicate is an index
-- range condition rather than a heap filter: once a restaurant's rows have all
-- been stamped, the scan finds nothing without touching them.
--
-- Column order is deliberate. (restaurant_id, rules_evaluated_at) makes the
-- steady state -- zero unevaluated rows -- an empty range scan, which is the
-- case that runs 288 times a day. The trailing sale_date DESC still orders
-- within a single rules_evaluated_at value, which is the shape of the drain
-- (every unevaluated row sits at '-infinity'), so the ORDER BY ... LIMIT is
-- satisfied from the index there too.
--
-- CONCURRENTLY cannot run inside a transaction, so this lives in its own
-- migration file containing only this statement.
-- Design: docs/superpowers/specs/2026-08-03-pos-sync-categorization-rescan-design.md §3.6
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_unified_sales_rule_candidates_v2
  ON public.unified_sales (restaurant_id, rules_evaluated_at, sale_date DESC)
  WHERE is_split = false AND (is_categorized = false OR category_id IS NULL);
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm run db:reset && npm run test:db
```

Expected: 7/7 pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260804090100_idx_unified_sales_rule_candidates_v2.sql supabase/tests/pos_rules_rescan_cache.test.sql
git commit -m "perf(db): add rules_evaluated_at candidate index on unified_sales"
```

---

### Task 3: Candidate index on `bank_transactions`

Implements the `bank_transactions` half of §3.6.

**Files:**
- Create: `supabase/migrations/20260804090200_idx_bank_transactions_rule_candidates_v2.sql`
- Modify: `supabase/tests/pos_rules_rescan_cache.test.sql`

**Interfaces:**
- Consumes: `bank_transactions.rules_evaluated_at` (Task 1).
- Produces: index `idx_bank_transactions_rule_candidates_v2`.

- [ ] **Step 1: Write the failing test**

In `supabase/tests/pos_rules_rescan_cache.test.sql`, change `SELECT plan(7);` to `SELECT plan(8);` and add before `SELECT * FROM finish();`:

```sql
-- ---------------------------------------------------------------- TEST 8
SELECT has_index(
  'public', 'bank_transactions', 'idx_bank_transactions_rule_candidates_v2',
  'partial candidate index on bank_transactions exists'
);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:db
```

Expected: `not ok 8 - partial candidate index on bank_transactions exists`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260804090200_idx_bank_transactions_rule_candidates_v2.sql`:

```sql
-- Candidate index for apply_rules_to_bank_transactions_internal's batch
-- selection. Mirrors idx_unified_sales_rule_candidates_v2; supersedes
-- idx_bank_transactions_rule_candidates, which carried the same partial
-- predicate without the rules_evaluated_at key.
--
-- CONCURRENTLY cannot run inside a transaction, so this lives in its own
-- migration file containing only this statement.
-- Design: docs/superpowers/specs/2026-08-03-pos-sync-categorization-rescan-design.md §3.6
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_transactions_rule_candidates_v2
  ON public.bank_transactions (restaurant_id, rules_evaluated_at, transaction_date DESC)
  WHERE is_split = false AND excluded_reason IS NULL
    AND (is_categorized = false OR category_id IS NULL);
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm run db:reset && npm run test:db
```

Expected: 8/8 pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260804090200_idx_bank_transactions_rule_candidates_v2.sql supabase/tests/pos_rules_rescan_cache.test.sql
git commit -m "perf(db): add rules_evaluated_at candidate index on bank_transactions"
```

---

### Task 4: Bound the POS sweep

Rewrites `apply_rules_to_pos_sales_internal` per §3.2, §3.3, and §3.4. Spec tests 1, 2, 3, 4, 5, 7, 8, 9, 10, 12, 16 plus the boundedness check.

**Copy source:** `supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql:300-402`. The complete new body is written out below — do not diff against the old file, replace wholesale with what is here.

**Files:**
- Create: `supabase/migrations/20260804090300_bounded_categorization_sweep.sql`
- Modify: `supabase/tests/pos_rules_rescan_cache.test.sql`

**Interfaces:**
- Consumes: `unified_sales.rules_evaluated_at` (Task 1), `idx_unified_sales_rule_candidates_v2` (Task 2).
- Produces: `public.apply_rules_to_pos_sales_internal(p_restaurant_id uuid, p_batch_limit integer DEFAULT 100) RETURNS TABLE (applied_count integer, total_count integer)` — signature unchanged, so `apply_rules_to_pos_sales`, the Toast/Focus wrappers, and Task 7's Revel call all keep working untouched.

- [ ] **Step 1: Write the failing tests**

In `supabase/tests/pos_rules_rescan_cache.test.sql`, change `SELECT plan(8);` to `SELECT plan(19);` and add before `SELECT * FROM finish();`:

```sql
-- ================================================================ SWEEP
-- Rule that matches nothing in the fixture set.
INSERT INTO categorization_rules
  (id, restaurant_id, rule_name, applies_to, category_id, item_name_pattern,
   item_name_match_type, is_active, auto_apply, priority)
VALUES
  ('00000000-0000-0000-0000-0000000009f1', '00000000-0000-0000-0000-0000000009a1',
   'Never matches', 'pos_sales', '00000000-0000-0000-0000-0000000009c1',
   'zzz-no-such-item', 'exact', true, true, 10)
ON CONFLICT (id) DO NOTHING;

-- Reset the fixture row to a clean uncategorized state.
UPDATE unified_sales
   SET item_name = 'Widget Burger', category_id = NULL, is_categorized = false,
       is_split = false
 WHERE id = '00000000-0000-0000-0000-0000000009d1';

-- ---------------------------------------------------------------- TEST 9
SELECT lives_ok(
  $$SELECT * FROM apply_rules_to_pos_sales_internal(
      '00000000-0000-0000-0000-0000000009a1', 100)$$,
  'sweep runs against a restaurant with one non-matching rule'
);

-- ---------------------------------------------------------------- TEST 10
SELECT isnt(
  (SELECT rules_evaluated_at FROM unified_sales
    WHERE id = '00000000-0000-0000-0000-0000000009d1'),
  '-infinity'::timestamptz,
  'a row that matched no rule is stamped as evaluated'
);

-- ---------------------------------------------------------------- TEST 11
-- Core assertion: the second sweep sees no candidates at all.
SELECT is(
  (SELECT total_count FROM apply_rules_to_pos_sales_internal(
     '00000000-0000-0000-0000-0000000009a1', 100)),
  0,
  'second sweep re-evaluates nothing'
);

-- ---------------------------------------------------------------- TEST 12
-- Editing a rule moves the watermark and re-opens the row.
UPDATE categorization_rules SET priority = 20
 WHERE id = '00000000-0000-0000-0000-0000000009f1';

SELECT is(
  (SELECT count(*)::int FROM unified_sales s
    WHERE s.restaurant_id = '00000000-0000-0000-0000-0000000009a1'
      AND s.rules_evaluated_at < (
        SELECT max(GREATEST(cr.created_at, COALESCE(cr.updated_at, cr.created_at)))
        FROM categorization_rules cr
        WHERE cr.restaurant_id = '00000000-0000-0000-0000-0000000009a1'
          AND cr.is_active = true
          AND (cr.applies_to = 'pos_sales' OR cr.applies_to = 'both'))),
  1,
  'editing a rule re-opens previously stamped rows'
);

-- ---------------------------------------------------------------- TEST 13
-- Inserting a new rule also re-opens them, and the sweep applies it.
INSERT INTO categorization_rules
  (id, restaurant_id, rule_name, applies_to, category_id, item_name_pattern,
   item_name_match_type, is_active, auto_apply, priority)
VALUES
  ('00000000-0000-0000-0000-0000000009f2', '00000000-0000-0000-0000-0000000009a1',
   'Burgers to food sales', 'pos_sales', '00000000-0000-0000-0000-0000000009c1',
   'Widget Burger', 'exact', true, true, 30)
ON CONFLICT (id) DO NOTHING;

SELECT is(
  (SELECT applied_count FROM apply_rules_to_pos_sales_internal(
     '00000000-0000-0000-0000-0000000009a1', 100)),
  1,
  'a newly inserted rule re-opens stamped rows and gets applied'
);

-- ---------------------------------------------------------------- TEST 14
SELECT is(
  (SELECT category_id FROM unified_sales
    WHERE id = '00000000-0000-0000-0000-0000000009d1'),
  '00000000-0000-0000-0000-0000000009c1'::uuid,
  'the matched row carries the rule category'
);

-- ---------------------------------------------------------------- TEST 15
-- Deactivating a rule lowers the watermark; the negative cache stays valid.
UPDATE unified_sales
   SET category_id = NULL, is_categorized = false
 WHERE id = '00000000-0000-0000-0000-0000000009d1';
UPDATE unified_sales
   SET rules_evaluated_at = now()
 WHERE id = '00000000-0000-0000-0000-0000000009d1';
UPDATE categorization_rules SET is_active = false
 WHERE id = '00000000-0000-0000-0000-0000000009f2';

SELECT is(
  (SELECT total_count FROM apply_rules_to_pos_sales_internal(
     '00000000-0000-0000-0000-0000000009a1', 100)),
  0,
  'deactivating a rule does not re-open stamped rows'
);

-- ---------------------------------------------------------------- TEST 16-17
-- Restaurant with no applicable rule at all: return (0,0), write nothing.
UPDATE categorization_rules SET is_active = false
 WHERE restaurant_id = '00000000-0000-0000-0000-0000000009a1';
UPDATE unified_sales SET rules_evaluated_at = '-infinity'
 WHERE id = '00000000-0000-0000-0000-0000000009d1';

SELECT is(
  (SELECT applied_count::text || '/' || total_count::text
     FROM apply_rules_to_pos_sales_internal(
       '00000000-0000-0000-0000-0000000009a1', 100)),
  '0/0',
  'restaurant with zero active rules returns (0,0)'
);

SELECT is(
  (SELECT rules_evaluated_at FROM unified_sales
    WHERE id = '00000000-0000-0000-0000-0000000009d1'),
  '-infinity'::timestamptz,
  'restaurant with zero active rules writes nothing'
);

-- ---------------------------------------------------------------- TEST 18
-- Watermark must not be narrower than the matcher's own rule predicate:
-- the matcher ignores auto_apply, so the watermark must too.
UPDATE categorization_rules SET is_active = true, auto_apply = false
 WHERE id = '00000000-0000-0000-0000-0000000009f2';

SELECT is(
  (SELECT applied_count FROM apply_rules_to_pos_sales_internal(
     '00000000-0000-0000-0000-0000000009a1', 100)),
  1,
  'an active auto_apply=false rule still moves the watermark and gets applied'
);

-- ---------------------------------------------------------------- TEST 19
-- Boundedness: with p_batch_limit = 1, exactly one row leaves '-infinity'.
UPDATE unified_sales
   SET category_id = NULL, is_categorized = false, rules_evaluated_at = '-infinity'
 WHERE restaurant_id = '00000000-0000-0000-0000-0000000009a1';

INSERT INTO unified_sales
  (restaurant_id, pos_system, external_order_id, item_name, quantity, sale_date,
   total_price, pos_category)
SELECT '00000000-0000-0000-0000-0000000009a1', 'toast',
       'ord-bulk-' || g, 'Bulk Item ' || g, 1, CURRENT_DATE, 5.00, 'Entrees'
FROM generate_series(1, 25) g;

-- Run the sweep as a plain statement (this file is a SQL script, not a plpgsql
-- body, so the result is simply discarded), then assert on the side effect.
SELECT applied_count FROM apply_rules_to_pos_sales_internal(
  '00000000-0000-0000-0000-0000000009a1', 1);

SELECT is(
  (SELECT count(*)::int FROM unified_sales u
    WHERE u.restaurant_id = '00000000-0000-0000-0000-0000000009a1'
      AND u.rules_evaluated_at > '-infinity'),
  1,
  'p_batch_limit = 1 stamps exactly one of 26 candidates'
);
```

This is the behavioural proxy for "the `LIMIT` now bounds the work", and it replaces an `EXPLAIN`-plan assertion, which pgTAP cannot express robustly. Under the old shape the matcher ran for all 26 candidates; under the new shape the batch CTE applies the `LIMIT` first, so exactly one row can be stamped.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:db
```

Expected: test 10 fails (`a row that matched no rule is stamped as evaluated` — the old function never stamps).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260804090300_bounded_categorization_sweep.sql` with this complete function:

```sql
-- Bound the rule-matching sweep so LIMIT actually limits work.
--
-- The old driver was a single query: unified_sales CROSS JOIN LATERAL
-- find_matching_rules_for_pos_sale(...) WHERE matched.rule_id IS NOT NULL
-- ORDER BY sale_date DESC LIMIT p_batch_limit. Because the LIMIT sits above a
-- filter on the function's own output, the planner must evaluate the matcher
-- for every candidate row before it can apply the LIMIT. On production that was
-- 51,366 rows x one matcher call each, 4.78M buffer hits, ~6s, zero matches --
-- 288 times a day, forever, because rows that match nothing never change state.
--
-- Now: statement 1 picks and stamps a bounded batch (no matcher involved, so
-- LIMIT binds); statement 2 runs the matcher against exactly those ids.
--
-- Design: docs/superpowers/specs/2026-08-03-pos-sync-categorization-rescan-design.md §3.2-§3.4
CREATE OR REPLACE FUNCTION apply_rules_to_pos_sales_internal(
  p_restaurant_id UUID,
  p_batch_limit   INTEGER DEFAULT 100
)
RETURNS TABLE (
  applied_count INTEGER,
  total_count   INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_sale                RECORD;
  v_applied_count       INTEGER := 0;
  v_total_count         INTEGER := 0;
  v_split_result        RECORD;
  v_splits_with_amounts JSONB;
  v_split               JSONB;
  v_splits_array        JSONB[] := ARRAY[]::JSONB[];
  v_rules_changed_at    TIMESTAMPTZ;
  v_batch_ids           UUID[];
  v_applied_dates       DATE[] := ARRAY[]::DATE[];
  v_prev_skip           TEXT;
BEGIN
  -- Guard: reject NULL or non-positive batch limits (LIMIT NULL removes cap; negative aborts loops).
  IF p_batch_limit IS NULL OR p_batch_limit < 1 THEN
    RAISE EXCEPTION 'p_batch_limit must be a positive integer, got %', p_batch_limit;
  END IF;

  -- No permission check: this function is for background/service-role callers.
  -- The public wrapper apply_rules_to_pos_sales enforces owner/manager membership.

  -- Rule watermark. This predicate MUST mirror find_matching_rules_for_pos_sale's
  -- own rule-selection predicate exactly -- is_active and applies_to, and
  -- nothing else. In particular NOT auto_apply: the matcher ignores it, so a
  -- narrower watermark here would let a rule the matcher applies change without
  -- invalidating the cache, producing a silent permanent miss.
  SELECT max(GREATEST(cr.created_at, COALESCE(cr.updated_at, cr.created_at)))
    INTO v_rules_changed_at
  FROM categorization_rules cr
  WHERE cr.restaurant_id = p_restaurant_id
    AND cr.is_active = true
    AND (cr.applies_to = 'pos_sales' OR cr.applies_to = 'both');

  -- No rule can match: equivalent to running to completion with zero matches,
  -- minus all the work. Deliberately writes nothing.
  IF v_rules_changed_at IS NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  -- Suppress trigger_unified_sales_aggregation for the duration of the sweep and
  -- re-aggregate once at the end. aggregate_unified_sales_to_daily sums
  -- COALESCE(total_price, unit_price*quantity, 0) and never reads category_id,
  -- so categorising a row cannot change a daily total -- the suppression is
  -- end-state-equivalent, not a behaviour change. Save and restore rather than
  -- forcing 'false': the Revel sync calls this from inside its own suppression
  -- window and must keep it.
  v_prev_skip := COALESCE(current_setting('app.skip_unified_sales_triggers', true), 'false');
  PERFORM set_config('app.skip_unified_sales_triggers', 'true', true);

  -- Statement 1: select and stamp the batch BEFORE any matching happens.
  -- MATERIALIZED is required -- PG12+ inlines single-reference CTEs, which would
  -- dissolve the LIMIT back into the outer query and reintroduce the bug.
  --
  -- This UPDATE fires reset_unified_sales_rules_evaluated_at, but that trigger
  -- only resets when item_name/total_price/pos_category change, and this
  -- statement touches none of them -- so the stamp it just wrote survives.
  WITH batch AS MATERIALIZED (
    SELECT s.id
    FROM unified_sales s
    WHERE s.restaurant_id = p_restaurant_id
      AND (s.is_categorized = false OR s.category_id IS NULL)
      AND s.is_split = false
      AND s.rules_evaluated_at < v_rules_changed_at
    ORDER BY s.sale_date DESC
    LIMIT p_batch_limit
  ), stamped AS (
    UPDATE unified_sales u
       SET rules_evaluated_at = v_rules_changed_at
      FROM batch b
     WHERE u.id = b.id
    RETURNING u.id
  )
  SELECT COALESCE(array_agg(id), '{}'::uuid[]) INTO v_batch_ids FROM stamped;

  -- Statement 2: matcher runs against exactly the stamped ids -- at most
  -- p_batch_limit calls, regardless of how many candidates exist.
  FOR v_sale IN
    SELECT s.id, s.sale_date, s.total_price, matched.rule_id, matched.rule_name,
           matched.category_id AS rule_category_id,
           matched.is_split_rule, matched.split_categories
    FROM unified_sales s
    CROSS JOIN LATERAL find_matching_rules_for_pos_sale(
      p_restaurant_id,
      jsonb_build_object('item_name', s.item_name, 'total_price', s.total_price,
                         'pos_category', s.pos_category)
    ) matched
    WHERE s.id = ANY(v_batch_ids)
      AND matched.rule_id IS NOT NULL
  LOOP
    v_total_count := v_total_count + 1;
    BEGIN
      IF v_sale.is_split_rule AND v_sale.split_categories IS NOT NULL THEN
        v_splits_array := ARRAY[]::JSONB[];
        FOR v_split IN SELECT * FROM jsonb_array_elements(v_sale.split_categories)
        LOOP
          v_splits_array := v_splits_array || jsonb_build_object(
            'category_id', v_split->>'category_id',
            'amount', CASE
              WHEN v_split->>'percentage' IS NOT NULL
              THEN ROUND((v_sale.total_price * (v_split->>'percentage')::NUMERIC / 100.0), 2)
              ELSE (v_split->>'amount')::NUMERIC
            END,
            'description', COALESCE(v_split->>'description', '')
          );
        END LOOP;
        v_splits_with_amounts := to_jsonb(v_splits_array);
        SELECT * INTO v_split_result FROM split_pos_sale(v_sale.id, v_splits_with_amounts);
        IF NOT v_split_result.success THEN
          RAISE NOTICE 'Failed to split sale %: %', v_sale.id, v_split_result.message;
          CONTINUE;
        END IF;
      ELSE
        UPDATE unified_sales
        SET category_id = v_sale.rule_category_id, is_categorized = true, updated_at = now()
        WHERE id = v_sale.id;
      END IF;
      v_applied_count := v_applied_count + 1;
      -- Split children inherit the parent's sale_date, so recording the
      -- parent's date covers both the child INSERTs and the parent's UPDATE.
      v_applied_dates := v_applied_dates || v_sale.sale_date::date;
      UPDATE categorization_rules
      SET apply_count = apply_count + 1, last_applied_at = now()
      WHERE id = v_sale.rule_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Error categorizing sale %: %', v_sale.id, SQLERRM;
    END;
  END LOOP;

  PERFORM set_config('app.skip_unified_sales_triggers', v_prev_skip, true);

  -- Re-aggregate the touched dates once each. Skipped when the caller had
  -- suppression on already -- that caller owns the re-aggregation.
  IF v_applied_count > 0 AND v_prev_skip IS DISTINCT FROM 'true' THEN
    PERFORM aggregate_unified_sales_to_daily(p_restaurant_id, d.sale_date)
    FROM (SELECT DISTINCT unnest(v_applied_dates) AS sale_date) d;
  END IF;

  RETURN QUERY SELECT v_applied_count, v_total_count;
END;
$$;

COMMENT ON FUNCTION apply_rules_to_pos_sales_internal(uuid, integer) IS
  'Background/service-role rule sweep for unified_sales. Evaluates at most '
  'p_batch_limit rows per call against the restaurant''s rule set, stamping '
  'rules_evaluated_at so unmatched rows are not re-evaluated until a rule '
  'changes. Callers needing a permission check must use apply_rules_to_pos_sales.';

REVOKE EXECUTE ON FUNCTION apply_rules_to_pos_sales_internal(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION apply_rules_to_pos_sales_internal(uuid, integer)
  TO service_role;
```

The `REVOKE`/`GRANT` is repeated because `CREATE OR REPLACE` on an existing function preserves its ACL — but if anyone ever `DROP`s and recreates it, the default ACL comes back. Restating it costs nothing and removes the footgun.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run db:reset && npm run test:db
```

Expected: 19/19 pass in `pos_rules_rescan_cache.test.sql`, and `19_apply_rules_permissions.sql` still passes 6/6 (the public wrapper's permission checks are untouched).

- [ ] **Step 5: Verify the batch-limit guard and the split branch still hold**

Change `SELECT plan(19);` to `SELECT plan(22);` and add before `SELECT * FROM finish();`:

```sql
-- ---------------------------------------------------------------- TEST 20-21
SELECT throws_ok(
  $$SELECT * FROM apply_rules_to_pos_sales_internal(
      '00000000-0000-0000-0000-0000000009a1', 0)$$,
  'p_batch_limit must be a positive integer, got 0',
  'p_batch_limit = 0 still raises'
);

SELECT throws_ok(
  $$SELECT * FROM apply_rules_to_pos_sales_internal(
      '00000000-0000-0000-0000-0000000009a1', NULL)$$,
  'p_batch_limit must be a positive integer, got <NULL>',
  'p_batch_limit = NULL still raises'
);

-- ---------------------------------------------------------------- TEST 22
-- Split-rule branch: the parent becomes is_split = true with two children.
UPDATE categorization_rules SET is_active = false
 WHERE restaurant_id = '00000000-0000-0000-0000-0000000009a1';

INSERT INTO categorization_rules
  (id, restaurant_id, rule_name, applies_to, category_id, item_name_pattern,
   item_name_match_type, is_active, auto_apply, priority, is_split_rule,
   split_categories)
VALUES
  ('00000000-0000-0000-0000-0000000009f3', '00000000-0000-0000-0000-0000000009a1',
   'Split burgers', 'pos_sales', '00000000-0000-0000-0000-0000000009c1',
   'Split Me', 'exact', true, true, 40, true,
   jsonb_build_array(
     jsonb_build_object('category_id', '00000000-0000-0000-0000-0000000009c1',
                        'percentage', 60, 'description', 'food'),
     jsonb_build_object('category_id', '00000000-0000-0000-0000-0000000009c2',
                        'percentage', 40, 'description', 'other')))
ON CONFLICT (id) DO NOTHING;

INSERT INTO unified_sales
  (id, restaurant_id, pos_system, external_order_id, item_name, quantity,
   sale_date, total_price, pos_category)
VALUES
  ('00000000-0000-0000-0000-0000000009d9', '00000000-0000-0000-0000-0000000009a1',
   'toast', 'ord-split-1', 'Split Me', 1, CURRENT_DATE, 100.00, 'Entrees')
ON CONFLICT (id) DO NOTHING;

SELECT applied_count FROM apply_rules_to_pos_sales_internal(
  '00000000-0000-0000-0000-0000000009a1', 100);

-- Asserting on the parent's is_split flag rather than on a child-row foreign
-- key: is_split is the column the sweep's own candidate predicate reads, so it
-- is the one whose behaviour this change could plausibly break.
SELECT is(
  (SELECT is_split FROM unified_sales
    WHERE id = '00000000-0000-0000-0000-0000000009d9'),
  true,
  'split-rule branch still routes through split_pos_sale'
);
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npm run test:db
```

Expected: 22/22 pass.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260804090300_bounded_categorization_sweep.sql supabase/tests/pos_rules_rescan_cache.test.sql
git commit -m "perf(db): bound apply_rules_to_pos_sales_internal with a rule watermark"
```

---

### Task 5: Bound the bank sweep

Applies the same three changes to `apply_rules_to_bank_transactions_internal`. Spec test 11 (bank equivalents) and the bank half of test 16.

**Copy source:** `supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql:483-758`. This body is 275 lines of journal-entry machinery that this change does not touch; transcribing it by hand into this plan is exactly the silent-reversion risk the Global Constraints warn about. Extract it mechanically, then apply the four edits below.

**Files:**
- Modify: `supabase/migrations/20260804090300_bounded_categorization_sweep.sql` (append)
- Modify: `supabase/tests/pos_rules_rescan_cache.test.sql`

**Interfaces:**
- Consumes: `bank_transactions.rules_evaluated_at` (Task 1), `idx_bank_transactions_rule_candidates_v2` (Task 3).
- Produces: `public.apply_rules_to_bank_transactions_internal(p_restaurant_id uuid, p_batch_limit integer DEFAULT 100, p_skip_rebuild boolean DEFAULT false) RETURNS TABLE (applied_count integer, total_count integer)` — signature unchanged.

- [ ] **Step 1: Write the failing tests**

In `supabase/tests/pos_rules_rescan_cache.test.sql`, change `SELECT plan(22);` to `SELECT plan(25);` and add before `SELECT * FROM finish();`:

```sql
-- ================================================================ BANK SWEEP
INSERT INTO categorization_rules
  (id, restaurant_id, rule_name, applies_to, category_id, description_pattern,
   description_match_type, is_active, auto_apply, priority)
VALUES
  ('00000000-0000-0000-0000-0000000009fb', '00000000-0000-0000-0000-0000000009a1',
   'Never matches bank', 'bank_transactions', '00000000-0000-0000-0000-0000000009c1',
   'zzz-no-such-description', 'exact', true, true, 10)
ON CONFLICT (id) DO NOTHING;

UPDATE bank_transactions
   SET description = 'SYSCO FOOD SERVICE', amount = -250.00,
       category_id = NULL, is_categorized = false, is_split = false,
       excluded_reason = NULL
 WHERE id = '00000000-0000-0000-0000-0000000009e1';

-- ---------------------------------------------------------------- TEST 23
SELECT lives_ok(
  $$SELECT * FROM apply_rules_to_bank_transactions_internal(
      '00000000-0000-0000-0000-0000000009a1', 100)$$,
  'bank sweep runs against a restaurant with one non-matching rule'
);

-- ---------------------------------------------------------------- TEST 24
SELECT isnt(
  (SELECT rules_evaluated_at FROM bank_transactions
    WHERE id = '00000000-0000-0000-0000-0000000009e1'),
  '-infinity'::timestamptz,
  'a bank row that matched no rule is stamped as evaluated'
);

-- ---------------------------------------------------------------- TEST 25
SELECT is(
  (SELECT total_count FROM apply_rules_to_bank_transactions_internal(
     '00000000-0000-0000-0000-0000000009a1', 100)),
  0,
  'second bank sweep re-evaluates nothing'
);
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:db
```

Expected: test 23 fails — the old bank function never stamps.

- [ ] **Step 3: Confirm the extraction range, then extract the current body**

Confirm the function starts at line 483 and find its closing `$$;`:

```bash
sed -n '483p' supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql
awk 'NR>483 && /^\$\$;$/ {print NR; exit}' supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql
```

Expected: line 483 is `CREATE OR REPLACE FUNCTION apply_rules_to_bank_transactions_internal(` and the second command prints `758`. If either differs, use the values these commands actually report — do not extract a range that starts or ends anywhere else.

```bash
printf '\n' >> supabase/migrations/20260804090300_bounded_categorization_sweep.sql
sed -n '483,758p' supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql >> supabase/migrations/20260804090300_bounded_categorization_sweep.sql
```

- [ ] **Step 4: Edit 1 — add the header comment**

Immediately above the appended `CREATE OR REPLACE FUNCTION apply_rules_to_bank_transactions_internal(`, insert:

```sql

-- Same treatment for the bank half. Identical pathology (CROSS JOIN LATERAL
-- find_matching_rules_for_bank_transaction with the LIMIT above a filter on the
-- function's output), identical fix.
--
-- One difference from the POS side: bank_transactions carries no
-- aggregation-on-UPDATE trigger (verified via pg_get_triggerdef on production --
-- only auto_categorize_bank_transaction BEFORE INSERT,
-- trigger_auto_apply_bank_split_rules AFTER INSERT, and the updated_at trigger),
-- so there is nothing to suppress and no end-of-sweep re-aggregation to add.
--
-- Design: docs/superpowers/specs/2026-08-03-pos-sync-categorization-rescan-design.md §3.2-§3.4
```

- [ ] **Step 5: Edit 2 — add the two locals**

In the appended function's `DECLARE` block, find:

```sql
  v_entry_description   TEXT;
```

and replace it with:

```sql
  v_entry_description   TEXT;
  v_rules_changed_at    TIMESTAMPTZ;
  v_batch_ids           UUID[];
```

- [ ] **Step 6: Edit 3 — add the watermark block**

Find this block in the appended function:

```sql
  IF v_cash_account_id IS NULL THEN
    RAISE EXCEPTION 'Cash account (1000) not found for restaurant %', p_restaurant_id;
  END IF;
```

and replace it with:

```sql
  IF v_cash_account_id IS NULL THEN
    RAISE EXCEPTION 'Cash account (1000) not found for restaurant %', p_restaurant_id;
  END IF;

  -- Rule watermark. MUST mirror find_matching_rules_for_bank_transaction's own
  -- rule-selection predicate exactly -- is_active and applies_to, and nothing
  -- else (it does not filter on auto_apply). A narrower predicate here would
  -- suppress real matches permanently.
  --
  -- Placed after the cash-account check on purpose: a restaurant with no rules
  -- and no chart-of-accounts 1000 row must keep raising, as it does today.
  SELECT max(GREATEST(cr.created_at, COALESCE(cr.updated_at, cr.created_at)))
    INTO v_rules_changed_at
  FROM categorization_rules cr
  WHERE cr.restaurant_id = p_restaurant_id
    AND cr.is_active = true
    AND (cr.applies_to = 'bank_transactions' OR cr.applies_to = 'both');

  IF v_rules_changed_at IS NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  -- Select and stamp the batch before the matcher runs, so LIMIT binds.
  -- MATERIALIZED is required: PG12+ would otherwise inline the CTE and dissolve
  -- the LIMIT back into the outer query.
  WITH batch AS MATERIALIZED (
    SELECT bt.id
    FROM bank_transactions bt
    WHERE bt.restaurant_id = p_restaurant_id
      AND (bt.is_categorized = false OR bt.category_id IS NULL)
      AND bt.is_split = false
      AND bt.excluded_reason IS NULL
      AND bt.rules_evaluated_at < v_rules_changed_at
    ORDER BY bt.transaction_date DESC
    LIMIT p_batch_limit
  ), stamped AS (
    UPDATE bank_transactions b
       SET rules_evaluated_at = v_rules_changed_at
      FROM batch x
     WHERE b.id = x.id
    RETURNING b.id
  )
  SELECT COALESCE(array_agg(id), '{}'::uuid[]) INTO v_batch_ids FROM stamped;
```

- [ ] **Step 7: Edit 4 — narrow the cursor to the stamped batch**

Find this fragment in the appended function's `FOR v_transaction IN` cursor:

```sql
    WHERE bt.restaurant_id = p_restaurant_id
      AND (bt.is_categorized = false OR bt.category_id IS NULL)
      AND bt.is_split = false
      AND bt.excluded_reason IS NULL
      AND matched.rule_id IS NOT NULL
    ORDER BY bt.transaction_date DESC
    LIMIT p_batch_limit
```

and replace it with:

```sql
    WHERE bt.id = ANY(v_batch_ids)
      AND matched.rule_id IS NOT NULL
```

- [ ] **Step 8: Restate the grants**

At the end of `supabase/migrations/20260804090300_bounded_categorization_sweep.sql`, append:

```sql

REVOKE EXECUTE ON FUNCTION apply_rules_to_bank_transactions_internal(uuid, integer, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION apply_rules_to_bank_transactions_internal(uuid, integer, boolean)
  TO service_role;
```

- [ ] **Step 9: Run the tests to verify they pass**

```bash
npm run db:reset && npm run test:db
```

Expected: 25/25 pass in `pos_rules_rescan_cache.test.sql`; `19_apply_rules_permissions.sql` still passes 6/6.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/20260804090300_bounded_categorization_sweep.sql supabase/tests/pos_rules_rescan_cache.test.sql
git commit -m "perf(db): bound apply_rules_to_bank_transactions_internal with a rule watermark"
```

---

### Task 6: Failure visibility in the `sync_all_*` cron wrappers

Implements §3.7. Spec tests 13, 14, 15.

**Copy sources** (each verified against production `pg_get_functiondef`):

| Function | Copy source |
|---|---|
| `sync_all_toast_to_unified_sales` | `supabase/migrations/20260216120000_toast_incremental_sync.sql:28` — **not** `20260127000000…sql:511` |
| `sync_all_shift4_to_unified_sales` | `supabase/migrations/20260127100000_shift4_lighthouse_sync_enhancements.sql:49` |
| `sync_all_focus_to_unified_sales` | `supabase/migrations/20260705003631_focus_legacy_cron_no_claim_bump.sql:30` |
| `sync_all_focus_transactions_to_unified_sales` | `supabase/migrations/20260703120000_focus_backfill_reliability.sql:80` |

All four full bodies are written out below with the changes already applied — use these, not the source files.

**Files:**
- Create: `supabase/migrations/20260804090400_pos_sync_failure_visibility.sql`
- Create: `supabase/tests/pos_sync_failure_visibility.test.sql`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `public.record_pos_sync_error(p_pos text, p_restaurant_id uuid, p_message text) RETURNS void`, `SECURITY DEFINER`, executable by `service_role` only.

- [ ] **Step 1: Write the failing test**

`toast_connections` holds encrypted OAuth credentials, so it is the fixture table most likely to carry a mandatory column this plan does not list. Re-run the Task 1 Step 2 query filtered to it before writing the file:

```bash
psql "postgresql://postgres:postgres@localhost:54322/postgres" -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'toast_connections' AND is_nullable = 'NO' AND column_default IS NULL ORDER BY ordinal_position;"
```

Add an explicit value in the `INSERT` for every column it prints. `restaurant_id` is the only one this test depends on semantically; the rest are placeholders satisfying `NOT NULL` (use `'test'` for text, `0` for numerics, `now()` for timestamps).

Create `supabase/tests/pos_sync_failure_visibility.test.sql`:

```sql
BEGIN;
SELECT plan(6);

SET LOCAL role TO postgres;

INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-0000000008a1', 'Sync Visibility Restaurant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO toast_connections (restaurant_id, is_active, connection_status)
VALUES ('00000000-0000-0000-0000-0000000008a1', true, 'connected')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------- TEST 1-2
-- record_pos_sync_error writes the error fields on the right connection table.
SELECT lives_ok(
  $$SELECT public.record_pos_sync_error(
      'toast', '00000000-0000-0000-0000-0000000008a1', 'boom')$$,
  'record_pos_sync_error runs'
);

SELECT is(
  (SELECT connection_status || '|' || left(last_error, 4)
     FROM toast_connections
    WHERE restaurant_id = '00000000-0000-0000-0000-0000000008a1'),
  'error|boom',
  'record_pos_sync_error sets connection_status and last_error'
);

-- ---------------------------------------------------------------- TEST 3
-- It survives being called from inside a query_canceled handler -- the exact
-- situation the Feb 2026 outage hid. statement_timeout is armed once per
-- client statement, so setting it here arms it for the DO block below.
UPDATE toast_connections
   SET connection_status = 'connected', last_error = NULL, last_error_at = NULL
 WHERE restaurant_id = '00000000-0000-0000-0000-0000000008a1';

SET LOCAL statement_timeout = '100ms';

DO $$
BEGIN
  BEGIN
    PERFORM pg_sleep(2);
  EXCEPTION WHEN query_canceled THEN
    PERFORM public.record_pos_sync_error(
      'toast', '00000000-0000-0000-0000-0000000008a1', 'forced timeout');
  END;
END $$;

SET LOCAL statement_timeout = 0;

SELECT is(
  (SELECT connection_status || '|' || last_error
     FROM toast_connections
    WHERE restaurant_id = '00000000-0000-0000-0000-0000000008a1'),
  'error|forced timeout',
  'record_pos_sync_error works from inside a query_canceled handler'
);

-- ---------------------------------------------------------------- TEST 4-5
-- It is NOT reachable from the PostgREST roles. Without the REVOKE, Supabase's
-- default ACL on schema public would make this SECURITY DEFINER function a
-- cross-tenant write available with the anon key.
SELECT ok(
  NOT has_function_privilege('anon',
    'public.record_pos_sync_error(text, uuid, text)', 'EXECUTE'),
  'anon cannot execute record_pos_sync_error'
);

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.record_pos_sync_error(text, uuid, text)', 'EXECUTE'),
  'authenticated cannot execute record_pos_sync_error'
);

-- ---------------------------------------------------------------- TEST 6
SELECT ok(
  has_function_privilege('service_role',
    'public.record_pos_sync_error(text, uuid, text)', 'EXECUTE'),
  'service_role can execute record_pos_sync_error'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:db
```

Expected: `pos_sync_failure_visibility.test.sql` fails with `function public.record_pos_sync_error(unknown, unknown, unknown) does not exist`.

- [ ] **Step 3: Write the helper and its grants**

Create `supabase/migrations/20260804090400_pos_sync_failure_visibility.sql`:

```sql
-- Make a per-restaurant POS sync failure visible instead of silent.
--
-- Every sync_all_* cron wrapper caught errors with `EXCEPTION WHEN OTHERS THEN
-- RAISE WARNING` and nothing else. Two consequences, both observed in
-- production: (1) WHEN OTHERS does not catch query_canceled (57014), so a
-- statement_timeout in one restaurant aborted the entire cron run -- 733
-- aborted runs over four days in Feb 2026 with no user-visible signal;
-- (2) even for caught errors, a RAISE WARNING into the Postgres log is not a
-- surface anyone watches.
--
-- Fix: name query_canceled explicitly, and record both arms on the existing
-- connection_status / last_error / last_error_at columns that already back the
-- integrations UI.
--
-- Design: docs/superpowers/specs/2026-08-03-pos-sync-categorization-rescan-design.md §3.7

CREATE OR REPLACE FUNCTION public.record_pos_sync_error(
  p_pos           TEXT,
  p_restaurant_id UUID,
  p_message       TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Deliberately no `SET LOCAL statement_timeout` guard here. Postgres arms
  -- statement_timeout once, at the start of each client-issued statement;
  -- changing it inside a function does not re-arm a timer for that function's
  -- own statements, so the guard would be a no-op that also leaked a shortened
  -- timeout to the rest of the caller's transaction.
  --
  -- p_pos is supplied only as a literal by the four sync_all_* wrappers, never
  -- from user input; format(%I) is belt-and-braces.
  EXECUTE format(
    'UPDATE public.%I SET connection_status = ''error'',
                          last_error = left($1, 500),
                          last_error_at = now()
      WHERE restaurant_id = $2',
    p_pos || '_connections')
  USING p_message, p_restaurant_id;
EXCEPTION WHEN OTHERS THEN
  -- Error bookkeeping must never mask the original failure or stop the loop.
  NULL;
END;
$$;

COMMENT ON FUNCTION public.record_pos_sync_error(text, uuid, text) IS
  'Records a POS sync failure on <p_pos>_connections. Service-role only -- it '
  'writes another tenant''s row by construction, so it must never be reachable '
  'from PostgREST.';

-- MANDATORY. Supabase's default ACL on schema public grants EXECUTE on new
-- functions to anon and authenticated. Without this REVOKE, this SECURITY
-- DEFINER function is callable with the public anon key, letting any caller set
-- connection_status = 'error' and an attacker-controlled last_error on ANY
-- restaurant's connection row -- a cross-tenant write that bypasses RLS.
REVOKE EXECUTE ON FUNCTION public.record_pos_sync_error(text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.record_pos_sync_error(text, uuid, text)
  TO service_role;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm run db:reset && npm run test:db
```

Expected: 6/6 pass in `pos_sync_failure_visibility.test.sql`.

- [ ] **Step 5: Rewrite the four wrappers**

Append to `supabase/migrations/20260804090400_pos_sync_failure_visibility.sql`:

```sql

-- ---------------------------------------------------------------------------
-- Toast. Body copied from 20260216120000_toast_incremental_sync.sql:28 (the
-- latest definition; 20260127000000 carries an older one).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_all_toast_to_unified_sales()
RETURNS TABLE(restaurant_id UUID, orders_synced INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_connection RECORD;
  v_synced INTEGER;
  v_start_date DATE;
BEGIN
  FOR v_connection IN
    SELECT tc.restaurant_id, tc.last_sync_time
    FROM public.toast_connections tc
    WHERE tc.is_active = true
  LOOP
    BEGIN
      -- Compute start date from last_sync_time with 25-hour buffer
      -- Fall back to 90 days if NULL (new connection, initial sync not done)
      v_start_date := COALESCE(
        (v_connection.last_sync_time - INTERVAL '25 hours')::DATE,
        (CURRENT_DATE - INTERVAL '90 days')::DATE
      );

      -- Use date-range overload (only processes orders in window)
      -- CURRENT_DATE is evaluated in server timezone (UTC on Supabase).
      -- Since UTC is ahead of all US timezones, CURRENT_DATE always
      -- covers the restaurant's local "today."
      SELECT sync_toast_to_unified_sales(
        v_connection.restaurant_id,
        v_start_date,
        CURRENT_DATE
      ) INTO v_synced;

      -- Clear a stale failure, but only when there is one to clear -- this loop
      -- runs every 5 minutes and should not churn updated_at for nothing.
      UPDATE public.toast_connections
         SET connection_status = 'connected', last_error = NULL, last_error_at = NULL
       WHERE toast_connections.restaurant_id = v_connection.restaurant_id
         AND (connection_status IS DISTINCT FROM 'connected' OR last_error IS NOT NULL);

      restaurant_id := v_connection.restaurant_id;
      orders_synced := v_synced;
      RETURN NEXT;
    EXCEPTION
      -- WHEN OTHERS does NOT catch query_canceled (57014); name it explicitly
      -- so a timed-out restaurant is skipped instead of aborting the whole run.
      WHEN query_canceled THEN
        RAISE WARNING 'sync_all_toast_to_unified_sales: timed out for restaurant %: %',
          v_connection.restaurant_id, SQLERRM;
        PERFORM public.record_pos_sync_error('toast', v_connection.restaurant_id, SQLERRM);
      WHEN OTHERS THEN
        RAISE WARNING 'Failed to sync restaurant %: %', v_connection.restaurant_id, SQLERRM;
        PERFORM public.record_pos_sync_error('toast', v_connection.restaurant_id, SQLERRM);
    END;
  END LOOP;

  RETURN;
END;
$$;

-- ---------------------------------------------------------------------------
-- Shift4. Body copied from
-- 20260127100000_shift4_lighthouse_sync_enhancements.sql:49.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_all_shift4_to_unified_sales()
RETURNS TABLE(restaurant_id UUID, rows_synced INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_connection RECORD;
  v_synced INTEGER;
BEGIN
  -- Loop through all active Shift4 connections
  FOR v_connection IN
    SELECT sc.restaurant_id
    FROM public.shift4_connections sc
    WHERE sc.is_active = true
  LOOP
    BEGIN
      -- Call the existing sync function for this restaurant
      SELECT public.sync_shift4_to_unified_sales(v_connection.restaurant_id) INTO v_synced;

      UPDATE public.shift4_connections
         SET connection_status = 'connected', last_error = NULL, last_error_at = NULL
       WHERE shift4_connections.restaurant_id = v_connection.restaurant_id
         AND (connection_status IS DISTINCT FROM 'connected' OR last_error IS NOT NULL);

      restaurant_id := v_connection.restaurant_id;
      rows_synced := v_synced;
      RETURN NEXT;
    EXCEPTION
      WHEN query_canceled THEN
        RAISE WARNING 'sync_all_shift4_to_unified_sales: timed out for restaurant %: %',
          v_connection.restaurant_id, SQLERRM;
        PERFORM public.record_pos_sync_error('shift4', v_connection.restaurant_id, SQLERRM);
      WHEN OTHERS THEN
        -- Log error but continue with other restaurants
        RAISE WARNING 'Failed to sync Shift4 restaurant %: %',
          v_connection.restaurant_id, SQLERRM;
        PERFORM public.record_pos_sync_error('shift4', v_connection.restaurant_id, SQLERRM);
    END;
  END LOOP;

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_all_shift4_to_unified_sales() TO service_role;

-- ---------------------------------------------------------------------------
-- Focus (legacy sales rollup). Body copied from
-- 20260705003631_focus_legacy_cron_no_claim_bump.sql:30.
--
-- Note: this wrapper and sync_all_focus_transactions_to_unified_sales below
-- both write focus_connections for the same restaurant, so the status is
-- last-writer-wins between them. Accepted -- either failing is worth surfacing,
-- and the two run on different schedules.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_all_focus_to_unified_sales()
RETURNS TABLE(restaurant_id uuid, rows_synced integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT fc.restaurant_id
    FROM public.focus_connections fc
    WHERE fc.is_active = true
    ORDER BY fc.last_sync_time ASC NULLS FIRST
    LIMIT 5        -- S5: bound cron work per invocation
  LOOP
    BEGIN
      restaurant_id := r.restaurant_id;
      -- Use yesterday UTC as the end date instead of CURRENT_DATE.
      -- CURRENT_DATE (UTC) may be ahead of a restaurant's local date when that
      -- restaurant is in a negative UTC offset (e.g. America/Los_Angeles at 01:00
      -- UTC is still the previous day locally), which would push partial-day data
      -- into unified_sales before the business day has closed.  Capping to
      -- (NOW() AT TIME ZONE 'UTC')::date - 1 keeps the window to completed days.
      rows_synced   := public._sync_focus_to_unified_sales_impl(
                         r.restaurant_id,
                         ((NOW() AT TIME ZONE 'UTC')::date - interval '2 days')::date,
                         ((NOW() AT TIME ZONE 'UTC')::date - interval '1 day')::date
                       );
      -- NO last_sync_time bump here: that column is the claim scheduler's
      -- due-marker (20260704200320). Bumping it from an aggregation-only job
      -- starves claim_focus_sync_batch — connections never become due.
      UPDATE public.focus_connections
         SET connection_status = 'connected', last_error = NULL, last_error_at = NULL
       WHERE focus_connections.restaurant_id = r.restaurant_id
         AND (connection_status IS DISTINCT FROM 'connected' OR last_error IS NOT NULL);
      RETURN NEXT;
    EXCEPTION
      WHEN query_canceled THEN
        RAISE WARNING 'sync_all_focus_to_unified_sales: timed out for restaurant %: %',
          r.restaurant_id, SQLERRM;
        PERFORM public.record_pos_sync_error('focus', r.restaurant_id, SQLERRM);
      WHEN OTHERS THEN
        RAISE WARNING 'sync_all_focus_to_unified_sales: failed for restaurant %: %',
          r.restaurant_id, SQLERRM;
        PERFORM public.record_pos_sync_error('focus', r.restaurant_id, SQLERRM);
    END;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Focus (transactions rollup). Body copied from
-- 20260703120000_focus_backfill_reliability.sql:80.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_all_focus_transactions_to_unified_sales()
RETURNS TABLE(restaurant_id uuid, rows_synced integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_full_range boolean;
BEGIN
  FOR r IN
    SELECT fc.restaurant_id, fc.initial_sync_done
    FROM public.focus_connections fc
    WHERE fc.is_active = true
    ORDER BY fc.last_sync_time ASC NULLS FIRST
    LIMIT 5
  LOOP
    BEGIN
      restaurant_id := r.restaurant_id;

      -- Full-range when the backfill is still running, OR when HISTORICAL rows
      -- (older than the 3-day incremental window) were written recently.
      -- The second condition closes the completion race (Codex P1, PR #567):
      -- the worker's FINAL batch writes ~5 historical days and flips
      -- initial_sync_done=true between two cron ticks — without this, those
      -- days would fall to the 3-day branch and never reach unified_sales.
      -- It also picks up custom-range re-imports of old dates for free.
      v_full_range := (NOT r.initial_sync_done) OR EXISTS (
        SELECT 1
        FROM public.focus_orders fo
        WHERE fo.restaurant_id = r.restaurant_id
          AND fo.updated_at   > now() - interval '15 minutes'
          AND fo.business_date < (CURRENT_DATE - 3)
      );

      IF v_full_range THEN
        -- Aggregate ALL dates stored in focus_orders (NULL bounds ⇒ full range).
        rows_synced := public._sync_focus_transactions_to_unified_sales_impl(
                         r.restaurant_id, NULL, NULL
                       );
      ELSE
        -- Incremental: 3-day lookback window (timezone-safe, matches prior behaviour).
        rows_synced := public._sync_focus_transactions_to_unified_sales_impl(
                         r.restaurant_id,
                         (CURRENT_DATE - interval '3 days')::date,
                         CURRENT_DATE
                       );
      END IF;

      UPDATE public.focus_connections
         SET connection_status = 'connected', last_error = NULL, last_error_at = NULL
       WHERE focus_connections.restaurant_id = r.restaurant_id
         AND (connection_status IS DISTINCT FROM 'connected' OR last_error IS NOT NULL);

      RETURN NEXT;
    EXCEPTION
      WHEN query_canceled THEN
        RAISE WARNING
          'sync_all_focus_transactions_to_unified_sales: timed out for restaurant %: %',
          r.restaurant_id, SQLERRM;
        PERFORM public.record_pos_sync_error('focus', r.restaurant_id, SQLERRM);
      WHEN OTHERS THEN
        RAISE WARNING
          'sync_all_focus_transactions_to_unified_sales: failed for restaurant %: %',
          r.restaurant_id, SQLERRM;
        PERFORM public.record_pos_sync_error('focus', r.restaurant_id, SQLERRM);
    END;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_all_focus_transactions_to_unified_sales()
  TO service_role;
```

The `UPDATE … WHERE <table>.restaurant_id = …` qualification is required: `restaurant_id` is also an OUT parameter of each wrapper, so an unqualified reference in the `UPDATE` would resolve to the variable and match every row.

- [ ] **Step 6: Assert every wrapper carries the `query_canceled` arm**

In `supabase/tests/pos_sync_failure_visibility.test.sql`, change `SELECT plan(6);` to `SELECT plan(7);` and add before `SELECT * FROM finish();`:

```sql
-- ---------------------------------------------------------------- TEST 7
-- Regression guard: a future CREATE OR REPLACE sourced from an older migration
-- would silently drop the query_canceled arm and restore the Feb 2026 failure
-- mode. WHEN OTHERS does not cover it, so its absence is invisible until an
-- outage.
SELECT is(
  (SELECT count(*)::int
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('sync_all_toast_to_unified_sales',
                        'sync_all_shift4_to_unified_sales',
                        'sync_all_focus_to_unified_sales',
                        'sync_all_focus_transactions_to_unified_sales')
      AND p.prosrc LIKE '%WHEN query_canceled THEN%'),
  4,
  'all four sync_all_* wrappers handle query_canceled explicitly'
);
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npm run db:reset && npm run test:db
```

Expected: 7/7 pass in `pos_sync_failure_visibility.test.sql`.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260804090400_pos_sync_failure_visibility.sql supabase/tests/pos_sync_failure_visibility.test.sql
git commit -m "fix(db): surface per-restaurant POS sync failures instead of swallowing them"
```

---

### Task 7: Revel's missing sweep call

Implements §3.8. Revel suppresses the `BEFORE INSERT` auto-categorization trigger for its bulk upsert but never runs the batch sweep afterwards, so Revel rows are never rule-categorized — 543 rows in Aug 2026, zero categorized.

**Copy source:** `supabase/migrations/20260721160000_revel_rpc_sold_at_self_heal.sql:177-395` (the latest definition, confirmed against production). Rather than restating 218 lines, extract and apply one insertion.

**Files:**
- Modify: `supabase/migrations/20260804090400_pos_sync_failure_visibility.sql` (append)

**Interfaces:**
- Consumes: `public.apply_rules_to_pos_sales_internal(uuid, integer)` (Task 4).
- Produces: no signature change to `sync_revel_to_unified_sales`.

- [ ] **Step 1: Confirm the extraction range, then extract the current body**

```bash
sed -n '177p' supabase/migrations/20260721160000_revel_rpc_sold_at_self_heal.sql
awk 'NR>177 && /^\$\$;$/ {print NR; exit}' supabase/migrations/20260721160000_revel_rpc_sold_at_self_heal.sql
```

Expected: line 177 is `CREATE OR REPLACE FUNCTION public.sync_revel_to_unified_sales(`. The second command prints the closing line — call it `END`. Use that value in the `sed` below; do not assume it.

```bash
printf '\n-- ---------------------------------------------------------------------------\n-- Revel: run the categorization sweep the other POS syncs already run.\n-- Body copied from 20260721160000_revel_rpc_sold_at_self_heal.sql:177.\n-- ---------------------------------------------------------------------------\n' >> supabase/migrations/20260804090400_pos_sync_failure_visibility.sql
sed -n '177,ENDp' supabase/migrations/20260721160000_revel_rpc_sold_at_self_heal.sql >> supabase/migrations/20260804090400_pos_sync_failure_visibility.sql
```

Substitute the printed line number for `END` before running (e.g. `sed -n '177,395p'` if it printed 395).

- [ ] **Step 2: Insert the sweep call**

In the appended `sync_revel_to_unified_sales` body, find:

```sql
  PERFORM set_config('app.skip_unified_sales_triggers', 'false', true);
  IF v_synced_count > 0 THEN
    PERFORM public.aggregate_unified_sales_to_daily(p_restaurant_id, d.sale_date)
```

and replace it with:

```sql
  PERFORM set_config('app.skip_unified_sales_triggers', 'false', true);

  -- Revel suppressed auto_categorize_pos_sale for the upsert above but, unlike
  -- Toast and Focus, never ran the batch sweep afterwards -- so Revel rows were
  -- inserted uncategorized and stayed that way. Same call, same batch size, same
  -- position in the sequence as the other POS syncs.
  PERFORM public.apply_rules_to_pos_sales_internal(p_restaurant_id, 10000);

  IF v_synced_count > 0 THEN
    PERFORM public.aggregate_unified_sales_to_daily(p_restaurant_id, d.sale_date)
```

The sweep runs *after* the flag is cleared, so its own suppress/restore window is self-contained and its end-of-sweep re-aggregation fires normally; the existing Revel batch re-aggregation below then covers the rows the upsert itself touched.

- [ ] **Step 3: Add a test**

In `supabase/tests/pos_sync_failure_visibility.test.sql`, change `SELECT plan(7);` to `SELECT plan(8);` and add before `SELECT * FROM finish();`:

```sql
-- ---------------------------------------------------------------- TEST 8
-- Revel must run the sweep. Without this call Revel rows are inserted with the
-- categorization trigger suppressed and never categorized by anything.
SELECT ok(
  (SELECT p.prosrc LIKE '%apply_rules_to_pos_sales_internal%'
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'sync_revel_to_unified_sales'),
  'sync_revel_to_unified_sales calls the categorization sweep'
);
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run db:reset && npm run test:db
```

Expected: 8/8 pass in `pos_sync_failure_visibility.test.sql`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260804090400_pos_sync_failure_visibility.sql supabase/tests/pos_sync_failure_visibility.test.sql
git commit -m "fix(db): run the categorization sweep after a Revel sync"
```

---

### Task 8: Drop the superseded indexes and fix the cron-cadence docs

Implements the index cleanup implied by §3.6 and the doc corrections in §3.10.

**Files:**
- Create: `supabase/migrations/20260804090500_drop_superseded_rule_candidate_indexes.sql`
- Create: `supabase/migrations/20260804090600_drop_superseded_bank_rule_candidate_index.sql`
- Modify: `docs/INTEGRATIONS.md:272`
- Modify: `CLAUDE.md` (Toast → Scale Considerations)

**Interfaces:**
- Consumes: `idx_unified_sales_rule_candidates_v2` (Task 2), `idx_bank_transactions_rule_candidates_v2` (Task 3).
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write the failing test**

In `supabase/tests/pos_rules_rescan_cache.test.sql`, change `SELECT plan(25);` to `SELECT plan(27);` and add before `SELECT * FROM finish();`:

```sql
-- ---------------------------------------------------------------- TEST 26-27
-- The v1 indexes are strict prefixes of the v2 ones with identical partial
-- predicates, so keeping both costs write amplification for nothing.
SELECT hasnt_index(
  'public', 'unified_sales', 'idx_unified_sales_rule_candidates',
  'superseded unified_sales candidate index is gone'
);

SELECT hasnt_index(
  'public', 'bank_transactions', 'idx_bank_transactions_rule_candidates',
  'superseded bank_transactions candidate index is gone'
);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:db
```

Expected: both assertions fail — the v1 indexes still exist.

- [ ] **Step 3: Write the drop migrations**

Create `supabase/migrations/20260804090500_drop_superseded_rule_candidate_indexes.sql`:

```sql
-- idx_unified_sales_rule_candidates (restaurant_id, sale_date DESC) with the
-- partial predicate `is_split = false AND (is_categorized = false OR
-- category_id IS NULL)` is a strict prefix of
-- idx_unified_sales_rule_candidates_v2, which carries the same predicate plus
-- rules_evaluated_at. Nothing can use the v1 index that cannot use v2; keeping
-- both only costs write amplification on a hot table.
--
-- DROP INDEX CONCURRENTLY has the same no-transaction restriction as CREATE,
-- so this file contains only this statement.
-- Design: docs/superpowers/specs/2026-08-03-pos-sync-categorization-rescan-design.md §3.6
DROP INDEX CONCURRENTLY IF EXISTS public.idx_unified_sales_rule_candidates;
```

Create `supabase/migrations/20260804090600_drop_superseded_bank_rule_candidate_index.sql`:

```sql
-- Superseded by idx_bank_transactions_rule_candidates_v2 -- same partial
-- predicate, same leading column, plus rules_evaluated_at.
--
-- DROP INDEX CONCURRENTLY has the same no-transaction restriction as CREATE,
-- so this file contains only this statement.
-- Design: docs/superpowers/specs/2026-08-03-pos-sync-categorization-rescan-design.md §3.6
DROP INDEX CONCURRENTLY IF EXISTS public.idx_bank_transactions_rule_candidates;
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run db:reset && npm run test:db
```

Expected: 27/27 pass in `pos_rules_rescan_cache.test.sql`.

- [ ] **Step 5: Correct the cron-cadence documentation**

Both files claim the Toast cron runs every 6 hours. Production pg_cron says otherwise: jobid 7 (`toast-bulk-sync`) runs `0 0,2,4,...,22 * * *` — every **2** hours — and jobid 4 (`toast-unified-sales-sync`, `*/5 * * * *`) is undocumented in either file despite being the job this whole change is about.

Locate the three affected lines:

```bash
grep -n "every 6 hours" docs/INTEGRATIONS.md CLAUDE.md
```

In `docs/INTEGRATIONS.md`, on the `toast-bulk-sync` line, replace the phrase `every 6 hours` with `every 2 hours (pg_cron jobid 7, \`0 0,2,4,...,22 * * *\`)`, leaving the rest of the line — list marker, bolding, em dash — exactly as it is.

Then, directly below that line's block, add:

```markdown
> **Also on a schedule:** `sync_all_toast_to_unified_sales()` — a plpgsql function, not an edge function — runs every 5 minutes as pg_cron jobid 4 (`toast-unified-sales-sync`). It loops every active `toast_connections` row, rolls `toast_orders` into `unified_sales`, and drives rule categorization via `apply_rules_to_pos_sales_internal`. A per-restaurant failure sets `toast_connections.connection_status = 'error'` with `last_error` / `last_error_at`.
```

In `CLAUDE.md`, under Toast POS Integration → Sync Pattern, replace:

```markdown
- **unified_sales sync**: For large imports, defer to cron job (runs every 6 hours) to avoid timeouts
```

with:

```markdown
- **unified_sales sync**: For large imports, defer to cron job (`sync_all_toast_to_unified_sales()`, pg_cron jobid 4, every 5 minutes) to avoid timeouts
```

and under Toast POS Integration → Scale Considerations, replace:

```markdown
- Cron runs every 6 hours - all restaurants eventually get synced
```

with:

```markdown
- `toast-bulk-sync` cron runs every 2 hours (pg_cron jobid 7) - all restaurants eventually get synced
- A separate SQL rollup, `sync_all_toast_to_unified_sales()`, runs every 5 minutes (pg_cron jobid 4) and also drives rule categorization
```

- [ ] **Step 6: Verify no stale cadence claim survives**

```bash
grep -rn "every 6 hours" docs/INTEGRATIONS.md CLAUDE.md
```

Expected: no output.

```bash
grep -rn "jobid 4\|jobid 7" docs/INTEGRATIONS.md CLAUDE.md
```

Expected: at least one hit in each file.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260804090500_drop_superseded_rule_candidate_indexes.sql supabase/migrations/20260804090600_drop_superseded_bank_rule_candidate_index.sql supabase/tests/pos_rules_rescan_cache.test.sql docs/INTEGRATIONS.md CLAUDE.md
git commit -m "chore(db): drop superseded candidate indexes and correct cron cadence docs"
```

---

## Final verification

- [ ] **Full suite**

```bash
npm run db:reset && npm run test:db
```

Expected: every pgTAP file passes, including the pre-existing `19_apply_rules_permissions.sql`.

- [ ] **Type check and lint** (no TypeScript changed, but the branch must stay green)

```bash
npm run typecheck && npm run lint
```

- [ ] **Post-deploy production checks** (read-only, after merge — not part of the branch)

```sql
-- jobid 4 mean runtime should fall from ~8.5s toward the sub-second range
SELECT jobid, avg(EXTRACT(EPOCH FROM (end_time - start_time))) AS mean_seconds, count(*)
FROM cron.job_run_details
WHERE jobid = 4 AND start_time > now() - interval '2 hours'
GROUP BY jobid;

-- the '-infinity' backlog should drain over roughly six runs
SELECT restaurant_id, count(*) FILTER (WHERE rules_evaluated_at = '-infinity') AS unevaluated
FROM unified_sales
GROUP BY restaurant_id
ORDER BY unevaluated DESC;

-- Revel rows should start getting categorized
SELECT count(*) FILTER (WHERE is_categorized) AS categorized, count(*) AS total
FROM unified_sales
WHERE pos_system = 'revel' AND sale_date >= CURRENT_DATE - 7;
```
