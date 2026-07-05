# Prep Shadow-Recipe Costing Fix — Design

**Date:** 2026-07-04
**Status:** Approved (user selected self-heal + no backfill)
**Related:** Prod incident at Wetzel's - Cold Stone - Alamo Ranch (`7c0c76e3-e770-401b-a2a9-c1edd407efed`)

## Problem

Every prep recipe has a "shadow" row in `recipes` (created by
`20260116000000_link_prep_recipes_to_recipes.sql` and `usePrepRecipes.createPrepRecipe`,
always with `is_active = true`). `complete_production_run` deducts ingredients by calling
`process_unified_inventory_deduction`, which looks the recipe up **by name with
`is_active = true`** and **silently returns an empty result** when nothing matches.

The Recipes page (`useRecipes`) lists all active recipes — including shadow recipes —
and its `deleteRecipe` is a soft-delete (`is_active = false`). A user deleted the
"Sweet Cream - pans" shadow recipe there (it looked like a stray duplicate). Since then
every Cook Now run at that restaurant:

- created **no ingredient deduction transactions** (ICE CREAM MIX stock never decreased),
- computed `v_total_cost_snapshot = 0`,
- left the output product's `cost_per_unit` at `$0`,
- and still completed "successfully" with `actual_total_cost = 0`.

Confirmed in prod: 5 runs on 2026-07-03/04 completed at $0; the only prep recipe in the
entire DB linked to an inactive shadow recipe is this one.

## Goals

1. Production runs must deduct and cost correctly even if the shadow recipe was
   soft-deleted (self-healing — the shadow recipe is an implementation detail).
2. A production run must **never complete silently at $0** when the recipe's
   ingredient list could not be resolved.
3. Shadow recipes must stop leaking into the Recipes page, and must not be
   soft-deletable from there.
4. Repair the existing bad prod data (reactivate the one inactive shadow recipe)
   through a migration, not a manual prod write.

**Non-goals (decided trade-offs):**
- No backfill of the 5 historical $0 runs (user decision: fix forward; stock can be
  corrected with a manual inventory adjustment).
- No removal of the shadow-recipe pattern itself (Option C, larger refactor, rejected).

## Design

### 1. Migration: deduct by recipe id (self-heal) + loud failure

New migration `supabase/migrations/<ts>_fix_prep_shadow_recipe_costing.sql`:

**a. `process_unified_inventory_deduction` gains `p_recipe_id uuid DEFAULT NULL`.**
- `DROP FUNCTION IF EXISTS public.process_unified_inventory_deduction(uuid, text, integer, text, text, text, text, text, text)`
  then re-`CREATE` with the new trailing parameter (Postgres cannot `CREATE OR REPLACE`
  across signatures). Body is copied from the current canonical definition in
  `20260203000000_enhance_prep_recipes_and_production.sql` with one change:

```sql
IF p_recipe_id IS NOT NULL THEN
    SELECT * INTO v_recipe_record
    FROM recipes
    WHERE id = p_recipe_id
      AND restaurant_id = p_restaurant_id;   -- tenant guard; NO is_active filter
ELSE
    SELECT * INTO v_recipe_record
    FROM recipes
    WHERE restaurant_id = p_restaurant_id
      AND (pos_item_name = p_pos_item_name OR name = p_pos_item_name)
      AND is_active = true                    -- POS path unchanged
    LIMIT 1;
END IF;
```

- All existing named-param callers (`useInventoryDeduction`,
  `useAutomaticInventoryDeduction`, `supabase/functions/_shared/inventoryConversion.ts`)
  are unaffected: the new param defaults to NULL and the POS behavior is unchanged.
- Re-apply the existing GRANT/COMMENT statements for the new signature.

**b. `complete_production_run` passes the id and fails loudly.**
- `CREATE OR REPLACE` (signature unchanged). Pass `v_prep.recipe_id` as `p_recipe_id`.
- After the deduction call, guard against silent no-ops:

```sql
IF COALESCE((v_deduction_result->>'already_processed')::boolean, false) = false
   AND jsonb_array_length(COALESCE(v_deduction_result->'ingredients_deducted', '[]'::jsonb)) = 0
   AND EXISTS (SELECT 1 FROM recipe_ingredients WHERE recipe_id = v_prep.recipe_id) THEN
  RAISE EXCEPTION 'Production run %: ingredient deduction failed for recipe % — no ingredients were deducted', p_run_id, v_prep.recipe_id;
END IF;
```

  - `already_processed = true` (idempotent retry) must NOT raise.
  - A recipe with zero `recipe_ingredients` rows must NOT raise here (some preps may
    legitimately have no tracked ingredients); zero-cost ingredients also do not raise —
    only "ingredients exist but none were deducted".

**c. Data repair (idempotent):**

```sql
UPDATE recipes r
SET is_active = true, updated_at = now()
FROM prep_recipes pr
WHERE pr.recipe_id = r.id AND r.is_active = false;
```

This reactivates the Cold Stone shadow recipe on deploy (currently the only affected row).

### 2. Client: stop the leak

**a. `useRecipes.fetchRecipes`** (src/hooks/useRecipes.tsx): fetch
`prep_recipes.select('recipe_id')` for the restaurant alongside the recipes query and
filter out any recipe whose id is a prep `recipe_id`. Shadow recipes disappear from the
Recipes page (they are managed from the Batch/Prep page).

**b. `useRecipes.deleteRecipe`**: before soft-deleting, check
`prep_recipes` for `recipe_id = id` (scoped to the restaurant). If linked, show a
destructive toast — "This recipe belongs to the batch recipe <name>. Manage it from the
Prep page." — and return `false` without updating. Defense in depth in case a shadow
recipe is reachable through another surface (direct link, stale cache).

### 3. Tests

**pgTAP** (`supabase/tests/26_prep_shadow_recipe_costing.sql`):
1. Setup: restaurant, user, ingredient product with cost, prep recipe + shadow recipe +
   `recipe_ingredients` + `prep_recipe_ingredients`, output product.
2. Soft-delete the shadow recipe (`is_active = false`), create + complete a production
   run → assert: deduction transaction exists (negative qty), output product
   `cost_per_unit > 0`, run `actual_total_cost > 0`. (Self-heal proven.)
3. Delete the `recipe_ingredients` rows, new run → `throws_ok` on
   `complete_production_run`. (Loud failure proven.)
4. Idempotency: re-call `complete_production_run` on a completed run → no error,
   no double deduction (existing behavior preserved).
5. Data repair: insert an inactive prep-linked recipe, run the repair UPDATE → active.

**Vitest** (`tests/unit/useRecipesShadowFilter.test.tsx` or similar):
1. `fetchRecipes` excludes recipes whose ids appear in `prep_recipes.recipe_id`.
2. `deleteRecipe` on a prep-linked recipe: no `recipes` update issued, error toast shown,
   returns false.
3. `deleteRecipe` on a normal recipe still soft-deletes.

## Error handling

- The new exception from `complete_production_run` propagates to `useQuickCook` /
  `useProductionRuns`, which already toast RPC errors and clean up the orphaned run
  (existing `cleanupOrphanedRun` path). No client changes needed for error display.
- Tenant guard: the by-id lookup keeps `restaurant_id = p_restaurant_id`, so a caller
  cannot deduct against another restaurant's recipe.

## Rollout

- Single PR: migration + client changes + tests. Migration is safe to run any time
  (function replacement + idempotent UPDATE touching 1 row in prod).
- After deploy, Cook Now at Cold Stone deducts 0.5 case of ICE CREAM MIX 14% and sets
  Sweet Cream - pans to ~$6.10/container per 2-container batch. Historical $0 runs are
  left as-is (user decision); stock variance (~2.5 cases) to be corrected via a manual
  inventory adjustment in the app.
