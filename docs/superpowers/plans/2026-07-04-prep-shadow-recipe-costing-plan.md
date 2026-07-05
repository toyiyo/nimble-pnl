# Prep Shadow-Recipe Costing Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Production runs deduct ingredients and cost output correctly even when the prep recipe's "shadow" `recipes` row is inactive; silent $0 completions become loud exceptions; shadow recipes stop appearing (and being soft-deletable) on the Recipes page; the one bad prod row is repaired by migration.

**Architecture:** One SQL migration changes `process_unified_inventory_deduction` (new optional `p_recipe_id` param → by-id lookup, no `is_active` filter) and `complete_production_run` (passes the id, raises on silent no-op), repairs data, and adds a backstop trigger. Client changes are confined to `src/hooks/useRecipes.tsx` and `src/components/DeleteRecipeDialog.tsx`.

**Tech Stack:** Postgres/plpgsql (Supabase migration), pgTAP, React hook (useState/useEffect — intentionally NOT migrating to React Query, see design doc §2d), Vitest.

**Design doc:** `docs/superpowers/specs/2026-07-04-prep-shadow-recipe-costing-design.md`

**Local DB test command:** `npm run test:db` (requires `npm run db:start` once). Unit tests: `npm run test`.

---

### Task 1: Migration — deduct by recipe id, loud failure, data repair, backstop trigger

**Files:**
- Create: `supabase/migrations/20260705000000_fix_prep_shadow_recipe_costing.sql`
- Reference (read, do not modify): `supabase/migrations/20260203000000_enhance_prep_recipes_and_production.sql`

The migration has 5 sections IN THIS ORDER (order matters: §2's function body calls the 10-arg signature created in §1; §4's trigger must be created AFTER §3's repair UPDATE).

- [ ] **Step 1: Write the failing pgTAP test file** (see Task 2 — write the test FIRST, run `npm run test:db`, confirm it fails because the migration doesn't exist yet). Task 2 contains the complete test file; do Task 2 Steps 1–2, then return here.

- [ ] **Step 2: Create the migration file skeleton with section comments**

```sql
-- Fix prep shadow-recipe costing (see docs/superpowers/specs/2026-07-04-prep-shadow-recipe-costing-design.md)
--
-- Incident: soft-deleting a prep-linked "shadow" recipe from the Recipes page
-- (is_active = false) made process_unified_inventory_deduction's name+is_active
-- lookup silently no-op, so complete_production_run completed runs at $0 cost
-- with no ingredient deductions.
--
-- ORDER MATTERS:
--   §1 must precede §2 (complete_production_run's new body calls the 10-arg signature).
--   §3 (data repair) must precede §4 (the backstop trigger blocks is_active=false
--      flips on prep-linked recipes; repair only sets true, but keep the order safe).

-- ============================================================
-- §1: process_unified_inventory_deduction gains p_recipe_id
-- ============================================================
-- ... (Step 3)

-- ============================================================
-- §2: complete_production_run — pass recipe id + loud failure
-- ============================================================
-- ... (Step 4)

-- ============================================================
-- §3: Data repair — reactivate prep-linked inactive shadow recipes
-- ============================================================
-- ... (Step 5)

-- ============================================================
-- §4: Backstop trigger — block deactivating prep-linked recipes
-- ============================================================
-- ... (Step 6)

-- ============================================================
-- §5: Comments
-- ============================================================
-- ... (Step 7)
```

- [ ] **Step 3: §1 — Recreate `process_unified_inventory_deduction` with `p_recipe_id`**

Open `supabase/migrations/20260203000000_enhance_prep_recipes_and_production.sql`. The canonical definition is at lines 142–479 (starting `DROP FUNCTION IF EXISTS public.process_unified_inventory_deduction(uuid, text, integer, text, text, text, text);` then `CREATE OR REPLACE FUNCTION public.process_unified_inventory_deduction(...)`). Copy the ENTIRE definition into §1 of the new migration, then apply exactly these three changes:

Change 1 — drop the CURRENT 9-arg signature first (Postgres cannot change a signature via CREATE OR REPLACE; a defaulted 10th param is a NEW signature, and leaving the 9-arg one behind would create PostgREST overload ambiguity):

```sql
DROP FUNCTION IF EXISTS public.process_unified_inventory_deduction(uuid, text, integer, text, text, text, text, text, text);
```

Change 2 — the parameter list gains a trailing defaulted param (everything else identical):

```sql
CREATE OR REPLACE FUNCTION public.process_unified_inventory_deduction(
    p_restaurant_id uuid,
    p_pos_item_name text,
    p_quantity_sold integer,
    p_sale_date text,
    p_external_order_id text DEFAULT NULL,
    p_sale_time text DEFAULT NULL,
    p_restaurant_timezone text DEFAULT 'America/Chicago',
    p_transaction_type text DEFAULT 'usage',
    p_reason_prefix text DEFAULT 'POS sale',
    p_recipe_id uuid DEFAULT NULL
)
```

Change 3 — replace the single recipe-lookup statement. The current body contains exactly this:

```sql
    SELECT * INTO v_recipe_record
    FROM recipes
    WHERE restaurant_id = p_restaurant_id
      AND (pos_item_name = p_pos_item_name OR name = p_pos_item_name)
      AND is_active = true
    LIMIT 1;
```

Replace it with:

```sql
    IF p_recipe_id IS NOT NULL THEN
        -- Production-run path: direct by-id lookup. Deliberately NO is_active
        -- filter — the shadow recipe is an implementation detail and a
        -- soft-deleted shadow row must not silently disable deductions.
        -- Tenant guard (restaurant_id) is preserved.
        SELECT * INTO v_recipe_record
        FROM recipes
        WHERE id = p_recipe_id
          AND restaurant_id = p_restaurant_id;
    ELSE
        -- POS-sale path: unchanged name-based lookup, active recipes only.
        SELECT * INTO v_recipe_record
        FROM recipes
        WHERE restaurant_id = p_restaurant_id
          AND (pos_item_name = p_pos_item_name OR name = p_pos_item_name)
          AND is_active = true
        LIMIT 1;
    END IF;
```

Everything else in the function body (dedup/already_processed check, unit-conversion cascade, transaction inserts, result JSON) is copied verbatim — do NOT reformat or "improve" it.

- [ ] **Step 4: §2 — Recreate `complete_production_run`**

Copy the ENTIRE `CREATE OR REPLACE FUNCTION public.complete_production_run(...)` definition from `20260203000000_enhance_prep_recipes_and_production.sql` (lines 482–697; signature `(p_run_id uuid, p_actual_yield numeric, p_actual_yield_unit measurement_unit, p_ingredients jsonb DEFAULT '[]'::jsonb)` — signature is UNCHANGED so plain `CREATE OR REPLACE` works). Apply exactly these two changes:

Change 1 — the deduction call gains the recipe id as a 10th positional argument. Current:

```sql
  v_deduction_result := public.process_unified_inventory_deduction(
    v_run.restaurant_id,
    v_recipe.name,
    v_batch_multiplier_int,
    v_sale_date,
    v_run.id::text,
    NULL,
    v_restaurant_timezone,
    'transfer',
    'Production'
  );
```

New:

```sql
  v_deduction_result := public.process_unified_inventory_deduction(
    v_run.restaurant_id,
    v_recipe.name,
    v_batch_multiplier_int,
    v_sale_date,
    v_run.id::text,
    NULL,
    v_restaurant_timezone,
    'transfer',
    'Production',
    v_prep.recipe_id
  );
```

Change 2 — immediately AFTER that call (before `v_reference_id := ...`), add the loud-failure guard. It checks `prep_recipe_ingredients` (the prep-side source of truth), NOT `recipe_ingredients` (the shadow list can itself desync — same bug class as the incident):

```sql
  -- Loud failure: a run whose prep expects ingredients must never complete
  -- with zero deductions (design doc §1b). already_processed = true means an
  -- idempotent retry whose transfer transactions already exist — never raise.
  IF COALESCE((v_deduction_result->>'already_processed')::boolean, false) = false
     AND jsonb_array_length(COALESCE(v_deduction_result->'ingredients_deducted', '[]'::jsonb)) = 0
     AND EXISTS (SELECT 1 FROM prep_recipe_ingredients WHERE prep_recipe_id = v_prep.id) THEN
    RAISE EXCEPTION 'Production run %: ingredient deduction failed for recipe % (%) — no ingredients were deducted',
      p_run_id, v_prep.recipe_id, v_recipe.name;
  END IF;
```

- [ ] **Step 5: §3 — Data repair**

```sql
DO $$
DECLARE v_count integer;
BEGIN
  UPDATE recipes r
  SET is_active = true, updated_at = now()
  FROM prep_recipes pr
  WHERE pr.recipe_id = r.id AND r.is_active = false;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Reactivated % prep-linked shadow recipe(s)', v_count;
END $$;
```

- [ ] **Step 6: §4 — Backstop trigger**

```sql
CREATE OR REPLACE FUNCTION public.prevent_shadow_recipe_deactivation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.is_active = true AND NEW.is_active = false
     AND EXISTS (SELECT 1 FROM prep_recipes WHERE recipe_id = OLD.id) THEN
    RAISE EXCEPTION 'Recipe "%" backs a prep (batch) recipe and cannot be deactivated. Manage it from the Prep page.', OLD.name;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_shadow_recipe_deactivation ON public.recipes;
CREATE TRIGGER trg_prevent_shadow_recipe_deactivation
BEFORE UPDATE OF is_active ON public.recipes
FOR EACH ROW
EXECUTE FUNCTION public.prevent_shadow_recipe_deactivation();
```

- [ ] **Step 7: §5 — Comments (no GRANTs)**

The current function has NO explicit `GRANT EXECUTE` (relies on default execute privileges) — do not add one. Re-apply the existing comment for the new signature and document the new behavior:

```sql
-- NOTE: no explicit GRANT EXECUTE existed on the prior signature (default
-- privileges apply); intentionally not adding one here.
COMMENT ON FUNCTION public.process_unified_inventory_deduction(uuid, text, integer, text, text, text, text, text, text, uuid) IS
'Unified inventory deduction for POS sales and production runs. When p_recipe_id is provided (production runs), the recipe is resolved by id with no is_active filter (self-healing against soft-deleted shadow recipes); otherwise by POS item name among active recipes. Supports usage (POS/COGS) and transfer (production, not COGS until sold) transaction types.';

COMMENT ON FUNCTION public.prevent_shadow_recipe_deactivation() IS
'Backstop: blocks is_active true->false on recipes referenced by prep_recipes.recipe_id. Shadow recipes must stay active or production deduction/costing would silently break (2026-07 Cold Stone incident).';
```

- [ ] **Step 8: Apply migration locally and run the pgTAP tests**

Run: `npm run db:reset` (applies all migrations; watch the output for `Reactivated 0 prep-linked shadow recipe(s)` from §3) then `npm run test:db`
Expected: the new `26_prep_shadow_recipe_costing.sql` tests PASS, and the existing `12_prep_production_runs.sql`, `15_production_run_costing.sql`, `16_production_run_idempotency.sql`, `25_quick_cook_inventory.sql` still PASS.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260705000000_fix_prep_shadow_recipe_costing.sql supabase/tests/26_prep_shadow_recipe_costing.sql
git commit -m "fix(prep): deduct production runs by recipe id, fail loudly on zero deductions

Shadow recipe soft-delete no longer silently zeroes batch costing.
Includes data repair + backstop trigger.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: pgTAP tests for the migration

**Files:**
- Create: `supabase/tests/26_prep_shadow_recipe_costing.sql`
- Reference (read for patterns): `supabase/tests/25_quick_cook_inventory.sql`

- [ ] **Step 1: Write the test file (complete content below)**

Note on IDs: this suite uses the `26000000-...` prefix to avoid colliding with other test files. The "incident" recipe is INSERTED with `is_active = false` BEFORE the `prep_recipes` link is created — the §4 trigger only blocks UPDATE flips on already-linked recipes, so this reproduces the incident state without fighting the trigger.

```sql
-- Prep Shadow-Recipe Costing Tests
-- Covers migration 20260705000000_fix_prep_shadow_recipe_costing.sql:
-- 1. Self-heal: production run deducts + costs even when shadow recipe is inactive
-- 2. Loud failure: prep has ingredients but deduction yields none -> exception
-- 3. Idempotency (completed run): early return, no double deduction
-- 4. Idempotency (in_progress retry with existing transactions): no exception
-- 5. Data repair UPDATE reactivates prep-linked inactive recipes
-- 6. Backstop trigger blocks deactivating prep-linked recipes

BEGIN;
SELECT plan(14);

-- ============================================================
-- Setup: auth context, restaurant, membership
-- ============================================================
SELECT set_config('request.jwt.claims', '{"sub":"26000000-0000-0000-0000-0000000000ab","role":"authenticated"}', true);
INSERT INTO auth.users (id, email) VALUES ('26000000-0000-0000-0000-0000000000ab', 'shadow-recipe-test@example.com') ON CONFLICT DO NOTHING;
INSERT INTO restaurants (id, name) VALUES ('26000000-0000-0000-0000-000000000001', 'Shadow Recipe Test Restaurant') ON CONFLICT DO NOTHING;
INSERT INTO user_restaurants (user_id, restaurant_id, role)
VALUES ('26000000-0000-0000-0000-0000000000ab', '26000000-0000-0000-0000-000000000001', 'owner')
ON CONFLICT DO NOTHING;

-- Products: mix ($24.40/case of 5 gal) and pans output (container of 2.5 gal)
INSERT INTO products (id, restaurant_id, sku, name, uom_purchase, size_value, size_unit, cost_per_unit, current_stock)
VALUES
  ('26000000-0000-0000-0000-000000000010', '26000000-0000-0000-0000-000000000001', 'MIX-CASE', 'Ice Cream Mix 14%', 'case', 5, 'gal', 24.40, 75),
  ('26000000-0000-0000-0000-000000000011', '26000000-0000-0000-0000-000000000001', 'PANS-CT',  'Sweet Cream Pans',  'container', 2.5, 'gal', 0, 0)
ON CONFLICT (id) DO NOTHING;

-- INCIDENT STATE: shadow recipe inserted ALREADY INACTIVE (bypasses the new
-- backstop trigger, which only guards true->false UPDATE flips).
INSERT INTO recipes (id, restaurant_id, name, serving_size, is_active)
VALUES ('26000000-0000-0000-0000-000000000100', '26000000-0000-0000-0000-000000000001', 'Sweet Cream Pans Prep', 2, false)
ON CONFLICT DO NOTHING;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit)
VALUES ('26000000-0000-0000-0000-000000000100', '26000000-0000-0000-0000-000000000010', 2.5, 'gal')
ON CONFLICT DO NOTHING;

INSERT INTO prep_recipes (id, restaurant_id, recipe_id, name, default_yield, default_yield_unit, output_product_id)
VALUES ('26000000-0000-0000-0000-000000000020', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000100', 'Sweet Cream Pans Prep', 2, 'container', '26000000-0000-0000-0000-000000000011')
ON CONFLICT DO NOTHING;

INSERT INTO prep_recipe_ingredients (prep_recipe_id, product_id, quantity, unit)
VALUES ('26000000-0000-0000-0000-000000000020', '26000000-0000-0000-0000-000000000010', 2.5, 'gal')
ON CONFLICT DO NOTHING;

-- ============================================================
-- Section 1: Self-heal — inactive shadow recipe still deducts + costs
-- 2.5 gal of a 5-gal case = 0.5 case = $12.20; output 2 containers @ $6.10
-- ============================================================
INSERT INTO production_runs (id, restaurant_id, prep_recipe_id, status, target_yield, target_yield_unit, created_by)
VALUES ('26000000-0000-0000-0000-000000000030', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000020', 'in_progress', 2, 'container', '26000000-0000-0000-0000-0000000000ab')
ON CONFLICT DO NOTHING;

INSERT INTO production_run_ingredients (id, production_run_id, product_id, expected_quantity, actual_quantity, unit)
VALUES ('26000000-0000-0000-0000-000000000040', '26000000-0000-0000-0000-000000000030', '26000000-0000-0000-0000-000000000010', 2.5, 2.5, 'gal')
ON CONFLICT DO NOTHING;

SELECT lives_ok(
  $$SELECT complete_production_run('26000000-0000-0000-0000-000000000030', 2, 'container', '[]'::jsonb)$$,
  'Self-heal: run completes with inactive shadow recipe'
);

SELECT is(
  (SELECT current_stock::numeric FROM products WHERE id = '26000000-0000-0000-0000-000000000010'),
  74.5::numeric,
  'Self-heal: mix stock deducted 75 -> 74.5 (0.5 case)'
);

SELECT is(
  (SELECT current_stock::numeric FROM products WHERE id = '26000000-0000-0000-0000-000000000011'),
  2::numeric,
  'Self-heal: output stock 0 -> 2 containers'
);

SELECT is(
  (SELECT cost_per_unit::numeric FROM products WHERE id = '26000000-0000-0000-0000-000000000011'),
  6.10::numeric,
  'Self-heal: output cost_per_unit $6.10 ($12.20 / 2)'
);

SELECT is(
  (SELECT actual_total_cost::numeric FROM production_runs WHERE id = '26000000-0000-0000-0000-000000000030'),
  12.20::numeric,
  'Self-heal: run actual_total_cost $12.20'
);

SELECT is(
  (SELECT COUNT(*) FROM inventory_transactions
   WHERE reference_id LIKE '26000000-0000-0000-0000-000000000030_%'
   AND product_id = '26000000-0000-0000-0000-000000000010'
   AND transaction_type = 'transfer' AND quantity < 0),
  1::bigint,
  'Self-heal: mix deduction transaction exists'
);

-- ============================================================
-- Section 2: Idempotency path 1 — re-completing a completed run is a no-op
-- ============================================================
SELECT lives_ok(
  $$SELECT complete_production_run('26000000-0000-0000-0000-000000000030', 2, 'container', '[]'::jsonb)$$,
  'Idempotency: re-completing a completed run does not error'
);

SELECT is(
  (SELECT current_stock::numeric FROM products WHERE id = '26000000-0000-0000-0000-000000000010'),
  74.5::numeric,
  'Idempotency: no double deduction on completed-run retry'
);

-- ============================================================
-- Section 3: Idempotency path 2 — in_progress retry whose transactions exist
-- (simulates a retry after partial failure: deduction committed, status not
-- yet flipped). already_processed short-circuit must NOT trip the new guard.
-- ============================================================
UPDATE production_runs SET status = 'in_progress', completed_at = NULL
WHERE id = '26000000-0000-0000-0000-000000000030';

SELECT lives_ok(
  $$SELECT complete_production_run('26000000-0000-0000-0000-000000000030', 2, 'container', '[]'::jsonb)$$,
  'Idempotency: in_progress retry with existing transactions does not raise the deduction guard'
);

SELECT is(
  (SELECT current_stock::numeric FROM products WHERE id = '26000000-0000-0000-0000-000000000010'),
  74.5::numeric,
  'Idempotency: still no double deduction after in_progress retry'
);

-- ============================================================
-- Section 4: Loud failure — prep expects ingredients, shadow list is empty
-- ============================================================
INSERT INTO recipes (id, restaurant_id, name, serving_size, is_active)
VALUES ('26000000-0000-0000-0000-000000000101', '26000000-0000-0000-0000-000000000001', 'Desynced Prep', 1, true)
ON CONFLICT DO NOTHING;
-- NOTE: no recipe_ingredients rows for this recipe (the shadow-side desync).

INSERT INTO prep_recipes (id, restaurant_id, recipe_id, name, default_yield, default_yield_unit, output_product_id)
VALUES ('26000000-0000-0000-0000-000000000021', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000101', 'Desynced Prep', 1, 'unit', NULL)
ON CONFLICT DO NOTHING;

INSERT INTO prep_recipe_ingredients (prep_recipe_id, product_id, quantity, unit)
VALUES ('26000000-0000-0000-0000-000000000021', '26000000-0000-0000-0000-000000000010', 1, 'gal')
ON CONFLICT DO NOTHING;

INSERT INTO production_runs (id, restaurant_id, prep_recipe_id, status, target_yield, target_yield_unit, created_by)
VALUES ('26000000-0000-0000-0000-000000000031', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000021', 'in_progress', 1, 'unit', '26000000-0000-0000-0000-0000000000ab')
ON CONFLICT DO NOTHING;

SELECT throws_like(
  $$SELECT complete_production_run('26000000-0000-0000-0000-000000000031', 1, 'unit', '[]'::jsonb)$$,
  '%no ingredients were deducted%',
  'Loud failure: desynced shadow ingredient list raises instead of completing at $0'
);

-- ============================================================
-- Section 5: Data repair — reactivates prep-linked inactive recipes
-- (re-run the same statement the migration executes)
-- ============================================================
UPDATE recipes r
SET is_active = true, updated_at = now()
FROM prep_recipes pr
WHERE pr.recipe_id = r.id AND r.is_active = false;

SELECT is(
  (SELECT is_active FROM recipes WHERE id = '26000000-0000-0000-0000-000000000100'),
  true,
  'Data repair: prep-linked inactive shadow recipe reactivated'
);

-- ============================================================
-- Section 6: Backstop trigger
-- ============================================================
SELECT throws_like(
  $$UPDATE recipes SET is_active = false WHERE id = '26000000-0000-0000-0000-000000000100'$$,
  '%cannot be deactivated%',
  'Backstop: deactivating a prep-linked recipe is blocked'
);

-- Non-linked recipe can still be deactivated
INSERT INTO recipes (id, restaurant_id, name, serving_size, is_active)
VALUES ('26000000-0000-0000-0000-000000000102', '26000000-0000-0000-0000-000000000001', 'Plain Menu Recipe', 1, true)
ON CONFLICT DO NOTHING;

SELECT lives_ok(
  $$UPDATE recipes SET is_active = false WHERE id = '26000000-0000-0000-0000-000000000102'$$,
  'Backstop: non-linked recipe soft-delete still works'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run to verify it fails before the migration exists**

Run: `npm run test:db`
Expected: `26_prep_shadow_recipe_costing.sql` FAILS (self-heal assertions fail: stock stays 75, cost stays 0; `throws_like` for the guard fails because no exception is raised; trigger test fails because the trigger doesn't exist).

- [ ] **Step 3: Continue with Task 1 Steps 2–8** (migration implementation makes these pass). Commit happens in Task 1 Step 9 (test + migration together).

---

### Task 3: `useRecipes.fetchRecipes` — filter shadow recipes, fail closed

**Files:**
- Modify: `src/hooks/useRecipes.tsx:68-127` (the `fetchRecipes` callback)
- Test: `tests/unit/useRecipesShadowRecipes.test.tsx` (created in Task 5; TDD steps below reference it)

- [ ] **Step 1: Write the failing tests** — implement Task 5 Steps 1–2 for the `fetchRecipes` describe block, run `npx vitest run tests/unit/useRecipesShadowRecipes.test.tsx`, confirm FAIL (shadow recipes are not filtered).

- [ ] **Step 2: Implement.** Replace the single recipes query at `src/hooks/useRecipes.tsx:76-86` with a parallel fetch + fail-closed filter. Current code:

```typescript
      const { data, error } = await supabase
        .from('recipes')
        .select(`
          *,
          ingredients:recipe_ingredients(product_id, quantity, unit)
        `)
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
```

New code:

```typescript
      // Shadow recipes (rows backing prep_recipes) are managed from the Prep
      // page and must not appear here. Fail closed: if the prep_recipes query
      // errors we abort the whole fetch rather than leak shadows back in.
      const [recipesResult, prepLinksResult] = await Promise.all([
        supabase
          .from('recipes')
          .select(`
            *,
            ingredients:recipe_ingredients(product_id, quantity, unit)
          `)
          .eq('restaurant_id', restaurantId)
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('prep_recipes')
          .select('recipe_id')
          .eq('restaurant_id', restaurantId)
          .not('recipe_id', 'is', null),
      ]);

      if (recipesResult.error) throw recipesResult.error;
      if (prepLinksResult.error) throw prepLinksResult.error;

      const shadowRecipeIds = new Set(
        (prepLinksResult.data || []).map((link) => link.recipe_id)
      );
      const data = (recipesResult.data || []).filter(
        (recipe) => !shadowRecipeIds.has(recipe.id)
      );
```

The filter MUST run before the `enhancedRecipes` map (line 89) so shadow rows never get cost recomputes or `UPDATE recipes` writes. The `(data || [])` in the map becomes just `data` (it is now always an array).

- [ ] **Step 3: Run the tests**

Run: `npx vitest run tests/unit/useRecipesShadowRecipes.test.tsx`
Expected: `fetchRecipes` describe block PASSES.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useRecipes.tsx tests/unit/useRecipesShadowRecipes.test.tsx
git commit -m "fix(recipes): hide prep-linked shadow recipes from Recipes page (fail closed)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `useRecipes.deleteRecipe` guard + `DeleteRecipeDialog` branch

**Files:**
- Modify: `src/hooks/useRecipes.tsx:317-343` (the `deleteRecipe` function)
- Modify: `src/components/DeleteRecipeDialog.tsx:25-37` (`handleDelete`)
- Test: `tests/unit/useRecipesShadowRecipes.test.tsx` (delete-guard describe block) and `tests/unit/DeleteRecipeDialogGuard.test.tsx` (Task 5)

- [ ] **Step 1: Write the failing tests** — implement Task 5 Steps 3–4, run them, confirm FAIL.

- [ ] **Step 2: Implement the `deleteRecipe` guard.** In `src/hooks/useRecipes.tsx`, replace the start of `deleteRecipe`:

Current:

```typescript
  const deleteRecipe = async (id: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('recipes')
        .update({ is_active: false })
        .eq('id', id);
```

New:

```typescript
  const deleteRecipe = async (id: string): Promise<boolean> => {
    try {
      // Shadow recipes back a prep (batch) recipe; soft-deleting one silently
      // breaks production deduction/costing. Blocked here AND by a DB trigger.
      const { data: prepLink, error: prepLinkError } = await supabase
        .from('prep_recipes')
        .select('name')
        .eq('recipe_id', id)
        .limit(1)
        .maybeSingle();

      if (prepLinkError) throw prepLinkError;

      if (prepLink) {
        toast({
          title: "Can't delete this recipe",
          description: `It is managed by the batch recipe "${prepLink.name}". Go to the Prep page to manage it.`,
          variant: "destructive",
        });
        return false;
      }

      const { error } = await supabase
        .from('recipes')
        .update({ is_active: false })
        .eq('id', id);
```

(The rest of the function is unchanged.)

- [ ] **Step 3: Implement the dialog branch.** In `src/components/DeleteRecipeDialog.tsx`, `handleDelete` currently closes unconditionally, which makes a blocked delete look like success. Replace:

```typescript
    setLoading(true);
    try {
      await deleteRecipe(recipe.id);
      onClose();
    } catch (error) {
      console.error('Error deleting recipe:', error);
    } finally {
      setLoading(false);
    }
```

with:

```typescript
    setLoading(true);
    try {
      const deleted = await deleteRecipe(recipe.id);
      if (deleted) {
        onClose();
      }
    } catch (error) {
      console.error('Error deleting recipe:', error);
    } finally {
      setLoading(false);
    }
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/useRecipesShadowRecipes.test.tsx tests/unit/DeleteRecipeDialogGuard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useRecipes.tsx src/components/DeleteRecipeDialog.tsx tests/unit/DeleteRecipeDialogGuard.test.tsx tests/unit/useRecipesShadowRecipes.test.tsx
git commit -m "fix(recipes): block soft-deleting prep-linked recipes; keep dialog open on rejection

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Vitest unit tests (written first, referenced by Tasks 3–4)

**Files:**
- Create: `tests/unit/useRecipesShadowRecipes.test.tsx`
- Create: `tests/unit/DeleteRecipeDialogGuard.test.tsx`
- Reference for mocking patterns: `tests/unit/RecipesCreateFromBase.test.tsx` (mocks `@/integrations/supabase/client`, `useAuth`, `use-toast`)

- [ ] **Step 1: Create `tests/unit/useRecipesShadowRecipes.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// ---- Mocks -----------------------------------------------------------------
const toastMock = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

// Configurable per-test responses
let recipesResponse: { data: unknown[] | null; error: unknown };
let prepLinksResponse: { data: unknown[] | null; error: unknown };
let prepLinkSingleResponse: { data: unknown | null; error: unknown };
const recipesUpdateMock = vi.fn().mockReturnValue({
  eq: vi.fn().mockResolvedValue({ error: null }),
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'recipes') {
        return {
          // fetch chain: .select().eq().eq().order()
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockImplementation(() => Promise.resolve(recipesResponse)),
              }),
            }),
          }),
          // deleteRecipe chain: .update().eq()
          update: recipesUpdateMock,
        };
      }
      if (table === 'prep_recipes') {
        return {
          select: vi.fn().mockReturnValue({
            // fetch chain: .select('recipe_id').eq().not()
            eq: vi.fn().mockReturnValue({
              not: vi.fn().mockImplementation(() => Promise.resolve(prepLinksResponse)),
              // deleteRecipe guard chain: .select('name').eq().limit().maybeSingle()
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockImplementation(() => Promise.resolve(prepLinkSingleResponse)),
              }),
            }),
          }),
        };
      }
      if (table === 'recipe_ingredients') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      // unified_sales & anything else: benign empty result
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              not: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      };
    }),
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    }),
    removeChannel: vi.fn(),
  },
}));

import { useRecipes } from '@/hooks/useRecipes';

const makeRecipe = (id: string, name: string) => ({
  id,
  restaurant_id: 'rest-1',
  name,
  serving_size: 1,
  estimated_cost: 0,
  is_active: true,
  created_at: '',
  updated_at: '',
  ingredients: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  recipesResponse = { data: [], error: null };
  prepLinksResponse = { data: [], error: null };
  prepLinkSingleResponse = { data: null, error: null };
});

describe('useRecipes shadow-recipe filtering (fetchRecipes)', () => {
  it('excludes recipes whose ids appear in prep_recipes.recipe_id', async () => {
    recipesResponse = {
      data: [makeRecipe('r-menu', 'Menu Item'), makeRecipe('r-shadow', 'Sweet Cream - pans')],
      error: null,
    };
    prepLinksResponse = { data: [{ recipe_id: 'r-shadow' }], error: null };

    const { result } = renderHook(() => useRecipes('rest-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.recipes.map((r) => r.id)).toEqual(['r-menu']);
  });

  it('fails closed: prep_recipes query error -> no recipes leak, error toast fires', async () => {
    recipesResponse = {
      data: [makeRecipe('r-menu', 'Menu Item'), makeRecipe('r-shadow', 'Sweet Cream - pans')],
      error: null,
    };
    prepLinksResponse = { data: null, error: { message: 'prep_recipes unavailable' } };

    const { result } = renderHook(() => useRecipes('rest-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.recipes).toEqual([]);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' })
    );
  });
});

describe('useRecipes shadow-recipe guard (deleteRecipe)', () => {
  it('blocks deleting a prep-linked recipe: destructive toast, returns false, no update', async () => {
    prepLinkSingleResponse = { data: { name: 'Sweet Cream - pans' }, error: null };

    const { result } = renderHook(() => useRecipes('rest-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let deleted: boolean | undefined;
    await act(async () => {
      deleted = await result.current.deleteRecipe('r-shadow');
    });

    expect(deleted).toBe(false);
    expect(recipesUpdateMock).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
        description: expect.stringContaining('Sweet Cream - pans'),
      })
    );
  });

  it('still soft-deletes a normal recipe', async () => {
    prepLinkSingleResponse = { data: null, error: null };

    const { result } = renderHook(() => useRecipes('rest-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let deleted: boolean | undefined;
    await act(async () => {
      deleted = await result.current.deleteRecipe('r-menu');
    });

    expect(deleted).toBe(true);
    expect(recipesUpdateMock).toHaveBeenCalledWith({ is_active: false });
  });
});
```

- [ ] **Step 2: Run to verify the fetch tests fail before Task 3's change**

Run: `npx vitest run tests/unit/useRecipesShadowRecipes.test.tsx`
Expected: FAIL — `excludes recipes...` gets both recipes (no filtering exists yet); the delete-guard tests fail because `deleteRecipe` never queries `prep_recipes` (the mock's `maybeSingle` is never reached and the update fires).

> NOTE for the implementer: if the current (pre-change) code errors on the mock shape instead of asserting cleanly, that still counts as RED. The mock chains above match the POST-change call shapes by design.

- [ ] **Step 3: Create `tests/unit/DeleteRecipeDialogGuard.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const deleteRecipeMock = vi.fn();
vi.mock('@/hooks/useRecipes', () => ({
  useRecipes: () => ({ deleteRecipe: deleteRecipeMock }),
}));

import { DeleteRecipeDialog } from '@/components/DeleteRecipeDialog';

const recipe = {
  id: 'r-1',
  restaurant_id: 'rest-1',
  name: 'Sweet Cream - pans',
  serving_size: 1,
  estimated_cost: 0,
  is_active: true,
  created_at: '',
  updated_at: '',
} as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DeleteRecipeDialog delete-guard behavior', () => {
  it('stays open (onClose not called) when deleteRecipe returns false', async () => {
    deleteRecipeMock.mockResolvedValue(false);
    const onClose = vi.fn();
    render(<DeleteRecipeDialog isOpen={true} onClose={onClose} recipe={recipe} />);

    await userEvent.click(screen.getByRole('button', { name: /delete recipe/i }));

    await waitFor(() => expect(deleteRecipeMock).toHaveBeenCalledWith('r-1'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes when deleteRecipe returns true', async () => {
    deleteRecipeMock.mockResolvedValue(true);
    const onClose = vi.fn();
    render(<DeleteRecipeDialog isOpen={true} onClose={onClose} recipe={recipe} />);

    await userEvent.click(screen.getByRole('button', { name: /delete recipe/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
```

- [ ] **Step 4: Run to verify the dialog test fails before Task 4's change**

Run: `npx vitest run tests/unit/DeleteRecipeDialogGuard.test.tsx`
Expected: FAIL — `stays open...` fails because the current dialog calls `onClose()` unconditionally.

(Commits for these test files happen with their implementation commits in Tasks 3 and 4.)

---

### Task 6: Full verification sweep

**Files:** none new.

- [ ] **Step 1: Run everything**

```bash
npm run typecheck && npm run lint && npm run test && npm run test:db && npm run build
```

Expected: all pass. If `npm run test:db` needs the local stack: `npm run db:start` first (and `npm run db:reset` to apply the new migration).

- [ ] **Step 2: Fix anything red, re-run, commit fixes**

```bash
git add -A && git commit -m "fix: address verification findings

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Skip the commit if nothing needed fixing.)

---

## Self-Review Notes

- Spec coverage: design §1a→Task 1 Step 3, §1b→Task 1 Step 4, §1c→Step 5, §1d→Step 6, §1e→Step 7, §2a→Task 3, §2b/§2c→Task 4, §2d→recorded in header, pgTAP list→Task 2 (tests 1–14 map to design tests 1–7), Vitest list→Task 5.
- The pgTAP self-heal math mirrors the real incident numbers ($24.40/case of 5 gal, 2.5 gal → $12.20 → $6.10/container) so the test doubles as an incident regression test.
- Types: `deleteRecipe(id)` keeps its `Promise<boolean>` contract; `DeleteRecipeDialog` consumes the boolean; mocks match the exact call chains introduced in Tasks 3–4.
