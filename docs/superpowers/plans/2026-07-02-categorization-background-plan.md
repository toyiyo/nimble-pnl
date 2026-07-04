# Categorization Background Rules + Supplier-Assign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make categorization rules apply automatically in background POS syncs (Toast/Focus) and fix bank-rule supplier semantics (assign-not-filter), with a one-time in-migration backfill.

**Architecture:** One new migration creates auth-free `_internal` variants of the two batch rule engines (public wrappers keep their auth checks), changes bank supplier matching semantics in all three match/apply paths, dynamically rewrites the four gated sync functions (regex-replace of the `auth.uid()` gate in their live `pg_get_functiondef` output), and backfills the backlog. Plus a 2-line edge-function change and a small UI copy/validation update.

**Spec:** `docs/superpowers/specs/2026-07-02-categorization-background-and-supplier-assign-design.md` (read it first — it contains verified prod facts and review-driven constraints marked **[review]**).

**Tech Stack:** Postgres/plpgsql migration, pgTAP, Deno edge function, React/TS + Vitest.

**Key files:**
- Create: `supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql` (built up across Tasks 1–5; sections MUST stay in the order §1→§7)
- Create: `supabase/tests/categorization_background_rules.test.sql`
- Modify: `supabase/functions/stripe-sync-transactions/index.ts:297`
- Modify: `src/components/banking/EnhancedCategoryRulesDialog.tsx`
- Create: `tests/unit/enhancedCategoryRulesValidation.test.ts` (or `.tsx` component test)

**Source-of-truth references for existing bodies** (verify against prod via the `supabase-prod` MCP `execute_sql` tool with `SELECT pg_get_functiondef('public.<fn>(<args>)'::regprocedure)` when in doubt):
- `apply_rules_to_pos_sales` / `apply_rules_to_bank_transactions`: `supabase/migrations/20260209000000_add_auth_to_apply_rule_functions.sql` (lines 6–112 and 114–378)
- `find_matching_rules_for_bank_transaction`: `supabase/migrations/20251121143327_update_apply_rules_for_splits.sql`
- `matches_bank_transaction_rule`, `auto_apply_bank_categorization_rules`: `supabase/migrations/20251111000000_enhanced_categorization_rules.sql`

**pgTAP conventions** (mirror `supabase/tests/08_inventory_deduction_conversions.sql`): `BEGIN; SELECT plan(N); SET LOCAL role TO postgres;` fixed test UUIDs, `ALTER TABLE ... DISABLE ROW LEVEL SECURITY;` as needed, end with `SELECT * FROM finish(); ROLLBACK;`. Simulate an authenticated user with `SET LOCAL "request.jwt.claims" TO '{"sub": "<uuid>"}';` and clear it with `SET LOCAL "request.jwt.claims" TO '';` (or reset) for NULL-auth paths.

---

### Task 1: Supplier-assign semantics in the three bank match/apply paths (migration §1–§3)

**Files:**
- Create: `supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql` (§1–§3)
- Create: `supabase/tests/categorization_background_rules.test.sql` (supplier-semantics tests)

- [ ] **Step 1: Write the failing pgTAP tests**

Create `supabase/tests/categorization_background_rules.test.sql`. Seed (fixed UUIDs, style per conventions above): one restaurant, one `user_restaurants` owner row, one `chart_of_accounts` expense category + one cash account with `account_code='1000'`, one supplier, and the rules/transactions per test. Then:

```sql
-- (a) matcher: rule with description+supplier MATCHES a supplier-less txn and returns supplier_id
SELECT is(
  (SELECT m.supplier_id FROM find_matching_rules_for_bank_transaction(
    '<restaurant-uuid>',
    jsonb_build_object('description','SYGMA Network; Payment; ACME - SYGMA Network','amount',-100.00,'supplier_id',NULL)
  ) m),
  '<supplier-uuid>'::uuid,
  'description+supplier rule matches supplier-less txn and exposes supplier_id'
);

-- (b) supplier-only rule does NOT match a supplier-less txn (returns 0 rows, not NULL-row)
SELECT is(
  (SELECT count(*)::int FROM find_matching_rules_for_bank_transaction(
    '<restaurant-uuid>',
    jsonb_build_object('description','anything','amount',-50.00,'supplier_id',NULL))),
  0, 'supplier-only rule does not match supplier-less txn');

-- (c) supplier-only rule DOES match a txn already linked to the supplier
-- (d) supplier + transaction_type='debit' ONLY (no description/amount) stays a FILTER rule:
--     does NOT match a supplier-less debit
-- (e) trigger path: INSERT a bank_transactions row matching a description+supplier auto_apply rule;
--     assert category_id set, is_categorized=true, AND supplier_id assigned from the rule
-- (f) trigger path: INSERT a row whose txn supplier is already set; rule supplier must NOT overwrite it
```

Make (b)/(d) unambiguous by giving each test its own rule+restaurant or deactivating other rules between tests (rules are LIMIT 1 by priority — isolate per fixture restaurant to avoid cross-matching).

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:db`
Expected: FAIL — matcher has no `supplier_id` output column yet; (a)/(e) fail.

- [ ] **Step 3: Implement migration §1–§3**

Create the migration file with header comment linking the spec, then:

**§1 — matcher DROP+CREATE** (RETURNS TABLE change requires DROP; explicit grants required — the function currently has NO explicit grants and Supabase revokes PUBLIC by default):

```sql
-- §1 find_matching_rules_for_bank_transaction: + supplier_id output column,
--    supplier = assignment (not filter) when rule has description/amount criteria.
DROP FUNCTION IF EXISTS find_matching_rules_for_bank_transaction(uuid, jsonb);

CREATE FUNCTION find_matching_rules_for_bank_transaction(p_restaurant_id uuid, p_transaction jsonb)
RETURNS TABLE(rule_id uuid, rule_name text, category_id uuid, priority integer,
              is_split_rule boolean, split_categories jsonb, supplier_id uuid)
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT cr.id, cr.rule_name, cr.category_id, cr.priority,
         cr.is_split_rule, cr.split_categories, cr.supplier_id
  FROM categorization_rules cr
  WHERE cr.restaurant_id = p_restaurant_id
    AND cr.is_active = true
    AND (cr.applies_to = 'bank_transactions' OR cr.applies_to = 'both')
    AND (
      cr.description_pattern IS NULL
      OR (
        CASE cr.description_match_type
          WHEN 'exact' THEN LOWER(p_transaction->>'description') = LOWER(cr.description_pattern)
          WHEN 'contains' THEN LOWER(p_transaction->>'description') LIKE '%' || LOWER(cr.description_pattern) || '%'
          WHEN 'starts_with' THEN LOWER(p_transaction->>'description') LIKE LOWER(cr.description_pattern) || '%'
          WHEN 'ends_with' THEN LOWER(p_transaction->>'description') LIKE '%' || LOWER(cr.description_pattern)
          WHEN 'regex' THEN (p_transaction->>'description') ~ cr.description_pattern
          ELSE false
        END
      )
    )
    AND (cr.amount_min IS NULL OR ABS((p_transaction->>'amount')::NUMERIC) >= cr.amount_min)
    AND (cr.amount_max IS NULL OR ABS((p_transaction->>'amount')::NUMERIC) <= cr.amount_max)
    -- Supplier semantics: a supplier on a rule is a FILTER only when the rule is
    -- "supplier-only" (no description/amount criteria; transaction_type does not count).
    -- Otherwise the supplier is an ASSIGNMENT applied after match (see apply paths).
    AND (
      cr.supplier_id IS NULL
      OR cr.description_pattern IS NOT NULL
      OR cr.amount_min IS NOT NULL
      OR cr.amount_max IS NOT NULL
      OR COALESCE((p_transaction->>'supplier_id')::uuid = cr.supplier_id, false)
    )
    AND (
      cr.transaction_type IS NULL
      OR cr.transaction_type = 'any'
      OR (cr.transaction_type = 'debit' AND (p_transaction->>'amount')::NUMERIC < 0)
      OR (cr.transaction_type = 'credit' AND (p_transaction->>'amount')::NUMERIC > 0)
    )
  ORDER BY cr.priority DESC, cr.created_at ASC
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION find_matching_rules_for_bank_transaction(uuid, jsonb)
  TO authenticated, service_role;
```

(Before finalizing, diff this body against the live prod def — `20251121143327` is the local source — to confirm no drift beyond the supplier clause + new column + search_path pin. The `ELSE false` CASE arm and everything else must be preserved.)

**§2 — `matches_bank_transaction_rule`**: `CREATE OR REPLACE` with the full current body from `20251111000000_enhanced_categorization_rules.sql` (verify against prod def), changing ONLY the supplier check block to:

```sql
  -- Check supplier: filter only when the rule is supplier-only
  -- (no description/amount criteria; transaction_type does not count)
  IF v_rule.supplier_id IS NOT NULL
     AND v_rule.description_pattern IS NULL
     AND v_rule.amount_min IS NULL
     AND v_rule.amount_max IS NULL THEN
    IF v_supplier_id IS NULL OR v_supplier_id != v_rule.supplier_id THEN
      RETURN false;
    END IF;
  END IF;
```

**§3 — `auto_apply_bank_categorization_rules`** (BEFORE INSERT trigger fn): `CREATE OR REPLACE` with the full current body (source: prod def / `20251111000000`), with exactly two changes:

1. Add `cr.supplier_id,` to the SELECT list feeding `v_matching_rule` (after `cr.category_id,`).
2. In the non-split apply branch, after `NEW.is_categorized := true;` add:

```sql
      -- Assign the rule's supplier when the transaction has none (assign-not-filter semantics)
      NEW.supplier_id := COALESCE(NEW.supplier_id, v_matching_rule.supplier_id);
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:db`
Expected: Task 1 tests PASS; full suite green (regressions in other rule tests = you changed more than specified).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql supabase/tests/categorization_background_rules.test.sql
git commit -m "fix(categorization): supplier on bank rules assigns instead of filters when other criteria exist"
```

---

### Task 2: `apply_rules_to_pos_sales_internal` + public wrapper (migration §4)

**Files:**
- Modify: the Task 1 migration (append §4)
- Modify: `supabase/tests/categorization_background_rules.test.sql`

- [ ] **Step 1: Write the failing pgTAP tests**

```sql
-- (g) internal fn exists and is NOT executable by authenticated/anon, IS by service_role
SELECT ok(NOT has_function_privilege('authenticated','apply_rules_to_pos_sales_internal(uuid,integer)','EXECUTE'),
          'authenticated cannot execute pos internal');
SELECT ok(NOT has_function_privilege('anon','apply_rules_to_pos_sales_internal(uuid,integer)','EXECUTE'),
          'anon cannot execute pos internal');
SELECT ok(has_function_privilege('service_role','apply_rules_to_pos_sales_internal(uuid,integer)','EXECUTE'),
          'service_role can execute pos internal');

-- (h) NULL-auth functional path: with request.jwt.claims cleared, seed an uncategorized
--     unified_sales row (item_name 'Sales Tax', is_categorized=false) + an active auto_apply
--     pos_sales rule (item_name_pattern 'Sales Tax', match 'contains'); insert the row with
--     app.skip_unified_sales_triggers='true' set via set_config(...,true) so the trigger
--     doesn't pre-categorize; then:
SELECT is(
  (SELECT applied_count FROM apply_rules_to_pos_sales_internal('<restaurant-uuid>', 100)),
  1, 'internal pos engine categorizes without auth context');
SELECT is(
  (SELECT is_categorized FROM unified_sales WHERE id = '<sale-uuid>'),
  true, 'sale row categorized by internal engine');

-- (i) public wrapper still enforces membership: with request.jwt.claims sub = a uuid
--     NOT in user_restaurants for this restaurant:
SELECT throws_ok(
  $$SELECT * FROM apply_rules_to_pos_sales('<restaurant-uuid>', 10)$$,
  'Permission denied: user does not have access to apply rules for this restaurant',
  'public pos wrapper still raises for non-members');
```

- [ ] **Step 2: Run to verify failure** — `npm run test:db`, expect FAIL (internal fn missing).

- [ ] **Step 3: Implement §4**

Copy the FULL body of `apply_rules_to_pos_sales` from `supabase/migrations/20260209000000_add_auth_to_apply_rule_functions.sql` lines 6–112 (verify identical to prod def first). Create the internal variant from it with exactly these changes:

1. Name/signature: `apply_rules_to_pos_sales_internal(p_restaurant_id uuid, p_batch_limit integer DEFAULT 100)`.
2. DELETE the permission-check block (the `IF NOT EXISTS (SELECT 1 FROM user_restaurants ... RAISE EXCEPTION 'Permission denied...'; END IF;`).
3. ADD `SET search_path = public` to the function header (after `SECURITY DEFINER`).
4. ADD a header comment: `-- Internal engine: no auth check. NOT exposed to clients (EXECUTE revoked below). Called by sync functions, cron backfill, and service-role edge functions.`

Then the wrapper + grants:

```sql
-- Public wrapper: unchanged signature/behavior for authenticated clients.
-- DEFAULT 100 is the safe interactive batch size; background callers pass larger limits.
CREATE OR REPLACE FUNCTION apply_rules_to_pos_sales(p_restaurant_id uuid, p_batch_limit integer DEFAULT 100)
RETURNS TABLE(applied_count integer, total_count integer)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = p_restaurant_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'Permission denied: user does not have access to apply rules for this restaurant';
  END IF;
  RETURN QUERY SELECT * FROM apply_rules_to_pos_sales_internal(p_restaurant_id, p_batch_limit);
END;
$$;

REVOKE EXECUTE ON FUNCTION apply_rules_to_pos_sales_internal(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_rules_to_pos_sales_internal(uuid, integer) TO service_role;
```

Note the wrapper gains `SET search_path = public` — the prior version was SECURITY DEFINER with an unpinned search_path (**[review] critical**).

- [ ] **Step 4: Run to verify pass** — `npm run test:db`, expect PASS.

- [ ] **Step 5: Commit** — `git commit -m "fix(categorization): auth-free internal POS rule engine + hardened public wrapper"`

---

### Task 3: `apply_rules_to_bank_transactions_internal` + wrapper + supplier assignment (migration §5)

**Files:** same migration (append §5), same test file.

- [ ] **Step 1: Write the failing pgTAP tests**

```sql
-- (j) privilege trio for apply_rules_to_bank_transactions_internal(uuid,integer)
--     (same three has_function_privilege assertions as (g))
-- (k) NULL-auth batch path: seed uncategorized bank txn matching a description+supplier rule
--     (insert with the auto-categorize trigger DISABLED via
--      ALTER TABLE bank_transactions DISABLE TRIGGER auto_categorize_bank_transaction; ... re-enable after)
--     then call apply_rules_to_bank_transactions_internal('<restaurant-uuid>', 100) with no jwt claims:
--     assert applied_count=1, txn is_categorized=true, category set, supplier_id assigned from rule,
--     and a journal_entries row exists with reference_id = txn id and created_by IS NULL.
-- (l) public wrapper apply_rules_to_bank_transactions raises 'Permission denied...' for non-member sub.
```

- [ ] **Step 2: Run to verify failure** — `npm run test:db`.

- [ ] **Step 3: Implement §5**

Copy the FULL body of `apply_rules_to_bank_transactions` from `20260209000000_add_auth_to_apply_rule_functions.sql` lines 114–378 (verify vs prod def). Internal variant changes:

1. Name: `apply_rules_to_bank_transactions_internal(p_restaurant_id uuid, p_batch_limit integer DEFAULT 100)`.
2. DELETE the permission-check block.
3. Header keeps `SECURITY DEFINER SET search_path TO 'public'` (already pinned in this fn — keep).
4. Supplier assignment: the main cursor SELECT already pulls `matched.*` columns — add `matched.supplier_id AS rule_supplier_id` to the select list (the matcher now returns it, Task 1). In the NON-SPLIT `UPDATE bank_transactions SET ...` change the line
   `supplier_id = COALESCE(v_transaction.supplier_id, supplier_id),` to
   `supplier_id = COALESCE(v_transaction.supplier_id, v_transaction.rule_supplier_id, supplier_id),`
   (txn's own supplier wins; else rule's supplier; else leave as-is).
5. Header comment as in Task 2.

Wrapper (mirror Task 2's shape exactly, delegating to the bank internal; keep the same `RAISE EXCEPTION` text) + the same REVOKE/GRANT pair for the bank internal.

- [ ] **Step 4: Run to verify pass** — `npm run test:db`.

- [ ] **Step 5: Commit** — `git commit -m "fix(categorization): auth-free internal bank rule engine assigns rule supplier"`

---

### Task 4: Dynamic gate rewrite of the four sync functions (migration §6)

**Files:** same migration (append §6), same test file.

- [ ] **Step 1: Write the failing pgTAP tests**

```sql
-- (m) the four sync functions no longer contain the auth gate and call the internal engine
SELECT ok(
  (SELECT pg_get_functiondef(p.oid) LIKE '%apply_rules_to_pos_sales_internal(p_restaurant_id, 10000)%'
     AND pg_get_functiondef(p.oid) NOT LIKE '%IF auth.uid() IS NOT NULL THEN%'
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.oid::regprocedure::text = 'sync_toast_to_unified_sales(uuid)'),
  'sync_toast_to_unified_sales(uuid) categorizes unconditionally');
-- repeat for: 'sync_toast_to_unified_sales(uuid,date,date)',
--             '_sync_focus_to_unified_sales_impl(uuid,date,date)',
--             '_sync_focus_transactions_to_unified_sales_impl(uuid,date,date)'
```

CAUTION on the NOT LIKE: `sync_toast_to_unified_sales(uuid)` contains exactly ONE `IF auth.uid() IS NOT NULL` today — the categorization gate. The functions also contain `IF auth.uid() IS NOT NULL AND NOT EXISTS (...user_restaurants...)` authorization headers — those must be PRESERVED. So assert the *categorization* gate specifically: use `NOT LIKE '%IF auth.uid() IS NOT NULL THEN\n    PERFORM apply_rules_to_pos_sales%'` — or simpler and robust: assert `def NOT LIKE '%skipping batch categorization%'` (the RAISE LOG text that only exists inside the gate) AND `def LIKE '%apply_rules_to_pos_sales_internal%'`. Use the RAISE-LOG-text form.

- [ ] **Step 2: Run to verify failure** — `npm run test:db`.

- [ ] **Step 3: Implement §6 — the rewrite DO-block**

```sql
-- §6 Rewrite the categorization gate out of the four sync functions.
-- Dynamic (pg_get_functiondef → regexp_replace → EXECUTE) so each environment
-- patches its own live body — prod hotfix drift and stale migration sources
-- cannot regress anything else in these functions.
DO $$
DECLARE
  v_fn  regprocedure;
  v_src text;
  v_new text;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('sync_toast_to_unified_sales',
                        '_sync_focus_to_unified_sales_impl',
                        '_sync_focus_transactions_to_unified_sales_impl')
  LOOP
    v_src := pg_get_functiondef(v_fn);

    IF v_src LIKE '%apply_rules_to_pos_sales_internal%' THEN
      RAISE LOG 'gate rewrite: % already patched — skipping', v_fn;
      CONTINUE;  -- idempotent re-run
    END IF;

    v_new := regexp_replace(
      v_src,
      'IF auth\.uid\(\) IS NOT NULL THEN\s*PERFORM apply_rules_to_pos_sales\(p_restaurant_id, 10000\);\s*ELSE\s*RAISE LOG\s*[^;]+;\s*END IF;',
      'PERFORM apply_rules_to_pos_sales_internal(p_restaurant_id, 10000);'
    );

    IF v_new = v_src THEN
      RAISE EXCEPTION 'gate rewrite: categorization gate not found in % — migration aborted (body drifted?)', v_fn;
    END IF;

    EXECUTE v_new;
    RAISE LOG 'gate rewrite: patched %', v_fn;
  END LOOP;
END;
$$;
```

Notes: the regex must NOT match the authorization header at the top of the toast functions (`IF auth.uid() IS NOT NULL AND NOT EXISTS ...`) — it can't, because the pattern requires `THEN` immediately (`\s*`) after `IS NOT NULL`, and the header has `AND NOT EXISTS` there. The focus functions' RAISE LOG string is split across lines — `\s*[^;]+;` covers it (no semicolons inside any of the log strings). Verify locally by running `npm run db:reset` and checking the def text.

- [ ] **Step 4: Run to verify pass** — `npm run test:db`.

- [ ] **Step 5: Commit** — `git commit -m "fix(categorization): sync functions categorize unconditionally via internal engine (dynamic gate rewrite)"`

---

### Task 5: One-time backfill (migration §7)

**Files:** same migration (append §7), same test file.

- [ ] **Step 1: Write the failing pgTAP test**

pgTAP runs AFTER all migrations, so the backfill has already executed against the test DB's (empty) data — a data assertion can't test it directly. Instead assert convergence behavior functionally: seed an uncategorized matching `unified_sales` row + rule (per test (h) fixtures, different UUIDs), then run the exact backfill DO-block body for that one restaurant (copy the inner loop into the test via `DO $$...$$`), and assert the row is categorized and the loop exits (test completes = no infinite loop).

```sql
SELECT is(
  (SELECT is_categorized FROM unified_sales WHERE id = '<backfill-sale-uuid>'),
  true, 'backfill loop drains POS backlog');
```

- [ ] **Step 2: Run to verify failure** — `npm run test:db` (row seeded, DO-block not yet in test → assertion fails).

- [ ] **Step 3: Implement §7**

```sql
-- §7 One-time backfill of the stuck backlog (~11.7k POS rows / 30d in prod).
-- Per-restaurant counters (i reset each restaurant; POS and bank loops separate)
-- — a shared never-reset counter would starve later restaurants of budget.
-- No-op on empty databases. apply_count on rules legitimately grows by ~1 per
-- categorized row (the 9M/14.8M apply_count anomaly is tracked separately).
DO $$
DECLARE
  r RECORD;
  n integer;
  i integer;
BEGIN
  FOR r IN
    SELECT DISTINCT cr.restaurant_id
    FROM categorization_rules cr
    WHERE cr.is_active AND cr.auto_apply
      AND cr.applies_to IN ('pos_sales', 'both')
  LOOP
    BEGIN
      i := 0;
      LOOP
        SELECT applied_count INTO n
        FROM apply_rules_to_pos_sales_internal(r.restaurant_id, 5000);
        i := i + 1;
        EXIT WHEN COALESCE(n, 0) = 0 OR i >= 50;
      END LOOP;
      RAISE LOG 'categorization backfill (pos): restaurant % done in % rounds', r.restaurant_id, i;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'categorization backfill (pos) failed for restaurant %: %', r.restaurant_id, SQLERRM;
    END;
  END LOOP;

  FOR r IN
    SELECT DISTINCT cr.restaurant_id
    FROM categorization_rules cr
    WHERE cr.is_active AND cr.auto_apply
      AND cr.applies_to IN ('bank_transactions', 'both')
  LOOP
    BEGIN
      i := 0;
      LOOP
        SELECT applied_count INTO n
        FROM apply_rules_to_bank_transactions_internal(r.restaurant_id, 1000);
        i := i + 1;
        EXIT WHEN COALESCE(n, 0) = 0 OR i >= 50;
      END LOOP;
      RAISE LOG 'categorization backfill (bank): restaurant % done in % rounds', r.restaurant_id, i;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'categorization backfill (bank) failed for restaurant %: %', r.restaurant_id, SQLERRM;
    END;
  END LOOP;
END;
$$;
```

- [ ] **Step 4: Run to verify pass** — `npm run test:db` (full suite green).

- [ ] **Step 5: Commit** — `git commit -m "fix(categorization): backfill stuck uncategorized backlog in-migration"`

---

### Task 6: `stripe-sync-transactions` uses the internal engine

**Files:**
- Modify: `supabase/functions/stripe-sync-transactions/index.ts:297`

- [ ] **Step 1: Check for an existing unit test** covering this call (`tests/unit/stripe-sync-tombstone.test.ts` mocks the module — check whether the RPC name is asserted; if yes update the expectation FIRST as the failing test).

- [ ] **Step 2: Implement**

At line 297 change:

```typescript
const { data: rulesResult, error: rulesError } = await supabaseAdmin.rpc('apply_rules_to_bank_transactions', {
  p_restaurant_id: restaurantId,
});
```

to:

```typescript
// Internal engine: the public RPC's auth check raises for service-role callers
// (auth.uid() is NULL). Batch limit 1000 keeps a single call inside edge-fn
// statement budget; the sync runs frequently so large imports drain over cycles.
const { data: rulesResult, error: rulesError } = await supabaseAdmin.rpc('apply_rules_to_bank_transactions_internal', {
  p_restaurant_id: restaurantId,
  p_batch_limit: 1000,
});
```

(Design said "5000"; 1000 is the deliberate choice here because each bank row creates journal entries — heavier per row than POS. Note this deviation in the PR description.)

- [ ] **Step 3: Run** `npm run test && npm run typecheck` — PASS.

- [ ] **Step 4: Commit** — `git commit -m "fix(banking): stripe sync applies rules via internal engine (service-role safe)"`

---

### Task 7: Rule dialog — assign-semantics copy, validation, a11y

**Files:**
- Modify: `src/components/banking/EnhancedCategoryRulesDialog.tsx`
- Create: `tests/unit/enhancedCategoryRulesValidation.test.tsx`

All line numbers below are pre-change references from the frontend design review — re-locate by content.

- [ ] **Step 1: Write failing component test** (React Testing Library, follow an existing dialog test's setup for providers/mocks): rendering the dialog form,
  (i) with generic description `"payment"` + supplier set + no amount range → submit shows the "too generic" error;
  (ii) with generic description + amountMin set → no generic error;
  (iii) with only a supplier selected → the "matches everything" inline alert does NOT render;
  (iv) supplier help text says "tagged with this supplier" when a description is present, and "already linked to this supplier" when supplier-only.

- [ ] **Step 2: Run** the new test file — expect FAIL.

- [ ] **Step 3: Implement**

1. **Submit gate (~line 195):** remove `formData.supplierId ||` from `hasOtherSpecificity`; error copy → `` `"${formData.descriptionPattern}" is too generic. Add an amount range to make this rule more specific.` ``
2. **Short-pattern guard (~line 206):** `if (descPattern && descPattern.length < 3 && !formData.amountMin && !formData.amountMax)` with copy "Use at least 3 characters or add an amount range."
3. **Inline alert (~line 792):** remove `formData.supplierId ||` from `hasOtherCriteria`; guard becomes `(isEmpty && !formData.supplierId || isGeneric) && !hasOtherCriteria` (supplier-only rules are valid filter rules — no false alarm).
4. **Supplier help text** below `SearchableSupplierSelector` (~line 818):

```tsx
<p className="text-[12px] text-muted-foreground mt-1.5">
  {formData.descriptionPattern || formData.amountMin || formData.amountMax
    ? 'Matching transactions will be tagged with this supplier.'
    : 'Only match transactions already linked to this supplier.'}
</p>
```

5. **`renderRuleConditions` (~line 353):**

```typescript
if (rule.supplier_id && rule.supplier) {
  const isSupplierOnly = !rule.description_pattern && rule.amount_min == null && rule.amount_max == null;
  conditions.push(isSupplierOnly
    ? `Supplier: ${rule.supplier.name}`
    : `Assigns supplier: ${rule.supplier.name}`);
}
```

6. **A11y (~line 390):** replace the plain `<p>` dialog subtitle with `<DialogDescription className="text-[13px] text-muted-foreground mt-0.5">…</DialogDescription>`; add `DialogDescription` to the `@/components/ui/dialog` import.

- [ ] **Step 4: Run** `npm run test && npm run typecheck && npm run lint` — PASS.

- [ ] **Step 5: Commit** — `git commit -m "fix(banking): rule dialog reflects supplier-assign semantics + a11y DialogDescription"`

---

## Post-merge production verification (Phase 9/10, main session — not a build task)

1. Confirm migration applied and backfill ran (supabase-prod MCP):
   `SELECT count(*) FROM unified_sales WHERE restaurant_id='7c0c76e3-e770-401b-a2a9-c1edd407efed' AND item_name ILIKE '%sales tax%' AND is_categorized IS NOT TRUE;` → 0, and still 0 one cron cycle (5 min) later.
2. `SELECT is_categorized, supplier_id FROM bank_transactions WHERE description ILIKE '%sygma%';` → all categorized, supplier `efb84198-…` assigned to the previously-NULL ones.
3. `SELECT proname FROM pg_proc WHERE pg_get_functiondef(oid) ILIKE '%skipping batch categorization%';` → 0 rows.
