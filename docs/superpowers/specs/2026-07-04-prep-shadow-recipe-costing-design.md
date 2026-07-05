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
- **Grants (design-review note):** the current function has no explicit `GRANT EXECUTE`
  (it relies on default PUBLIC execute); the migration re-applies only the existing
  `COMMENT ON FUNCTION` for the new signature and states this explicitly in a comment —
  do not invent grants that don't exist today.

**b. `complete_production_run` passes the id and fails loudly.**
- `CREATE OR REPLACE` (signature unchanged). Pass `v_prep.recipe_id` as `p_recipe_id`.
- **Ordering constraint (design-review major):** part (a)'s DROP+CREATE must precede
  this `CREATE OR REPLACE` in the migration file — the new body references the 10-arg
  call. Add an explicit comment in the migration stating the required order.
- After the deduction call, guard against silent no-ops. **The guard checks
  `prep_recipe_ingredients` (the prep-side source of truth, keyed by `v_prep.id`), NOT
  `recipe_ingredients`** (design-review major: the shadow list can itself desync — the
  same class of bug as this incident — and a guard that trusts it would silently pass
  the exact failure mode being fixed):

```sql
IF COALESCE((v_deduction_result->>'already_processed')::boolean, false) = false
   AND jsonb_array_length(COALESCE(v_deduction_result->'ingredients_deducted', '[]'::jsonb)) = 0
   AND EXISTS (SELECT 1 FROM prep_recipe_ingredients WHERE prep_recipe_id = v_prep.id) THEN
  RAISE EXCEPTION 'Production run %: ingredient deduction failed for recipe % (%) — no ingredients were deducted', p_run_id, v_prep.recipe_id, v_recipe.name;
END IF;
```

  - `already_processed = true` (retry of a not-yet-`completed` run whose transfer
    transactions already exist) must NOT raise.
  - A prep with zero `prep_recipe_ingredients` rows must NOT raise (some preps may
    legitimately have no tracked ingredients); zero-cost ingredients also do not raise —
    only "ingredients expected but none were deducted".
  - Genuine desync (prep has ingredients, shadow `recipe_ingredients` empty/dangling)
    DOES raise — that is intentional loud failure, and the exception message includes
    the recipe name for log triage.

**c. Data repair (idempotent, with visible count):**

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

This reactivates the Cold Stone shadow recipe on deploy (currently the only affected row)
and logs the affected-row count in deploy output.

**d. DB-level backstop trigger (design-review suggestion, adopted):** a `BEFORE UPDATE`
trigger on `recipes` raising a clear error when `is_active` flips `true → false` while a
`prep_recipes` row references the recipe. This closes the incident vector for ALL
surfaces (direct REST, service scripts, future UI), not just the Recipes page.
`deletePrepRecipe` is unaffected (it hard-DELETEs the shadow row; the trigger only
guards UPDATE). Created AFTER the repair UPDATE in (c) within the migration.

### 2. Client: stop the leak

**a. `useRecipes.fetchRecipes`** (src/hooks/useRecipes.tsx): run
`Promise.all([recipesQuery, prepRecipesQuery])` (where `prepRecipesQuery` is
`prep_recipes.select('recipe_id')` scoped to the restaurant), **filter shadow recipes
out BEFORE the per-row cost-recalculation map** (design-review major: otherwise shadow
rows get cost recomputes and `UPDATE recipes` writes just before being hidden).
**Failure contract (design-review major): fail closed** — if the `prep_recipes` query
errors, the whole fetch throws into the existing catch (error toast), rather than
treating it as "no shadow recipes", which would leak shadows back onto the page. The
existing `!restaurantId || !user` early return covers the new query too. Both
supporting indexes already exist (`idx_prep_recipes_restaurant`,
`idx_prep_recipes_recipe_id`).

**b. `useRecipes.deleteRecipe`**: before soft-deleting, check
`prep_recipes` for `recipe_id = id` (scoped to the restaurant). If linked, show a
destructive toast — "<name> is managed by a batch (prep) recipe. Go to the Prep page to
manage it." — and return `false` without updating. Defense in depth in case a shadow
recipe is reachable through another surface (direct link, stale cache).

**c. `DeleteRecipeDialog.handleDelete`** (src/components/DeleteRecipeDialog.tsx,
design-review major): branch on the boolean — `const ok = await deleteRecipe(recipe.id);
if (ok) onClose();`. Today the dialog closes unconditionally, so a blocked delete would
look like success with only a fleeting toast behind it. Keeping the dialog open anchors
the rejection.

**d. Intentionally NOT migrating `useRecipes` to React Query** (design-review note):
the hook is useState/useEffect + realtime channel today with six call sites; migrating
is out of scope for this incident fix and is recorded here so later reviewers know the
deviation from CLAUDE.md's React Query pattern is a pre-existing, consciously deferred
gap.

### 3. Tests

**pgTAP** (`supabase/tests/26_prep_shadow_recipe_costing.sql`):
1. Setup: restaurant, user, ingredient product with cost, prep recipe + shadow recipe +
   `recipe_ingredients` + `prep_recipe_ingredients`, output product.
   (Note: the backstop trigger from 1d means the test soft-deletes the shadow recipe by
   disabling/deferring around the trigger OR by deleting the `prep_recipes` link first —
   simplest is to set `is_active = false` BEFORE inserting the `prep_recipes` row, or
   use `ALTER TABLE recipes DISABLE TRIGGER` within the test transaction. Decide in
   implementation; the test must still prove self-heal against an inactive shadow row.)
2. Soft-delete the shadow recipe (`is_active = false`), create + complete a production
   run → assert: deduction transaction exists (negative qty), output product
   `cost_per_unit > 0`, run `actual_total_cost > 0`. (Self-heal proven.)
3. Delete the `recipe_ingredients` rows (shadow-side desync), new run → `throws_ok` on
   `complete_production_run`. (Loud failure proven; guard keyed on
   `prep_recipe_ingredients`.)
4. Idempotency path 1: re-call `complete_production_run` on a `completed` run → no
   error, no double deduction (early return preserved).
5. Idempotency path 2 (design-review major): run left `in_progress` with matching
   transfer `inventory_transactions` already present (simulated partial retry) →
   `already_processed = true` short-circuit means NO exception and no double deduction.
6. Data repair: prep-linked inactive recipe, run the repair UPDATE → active.
7. Backstop trigger: `UPDATE recipes SET is_active = false` on a prep-linked recipe →
   `throws_ok`; on a non-linked recipe → `lives_ok`.

**Vitest** (`tests/unit/useRecipesShadowFilter.test.tsx` or similar):
1. `fetchRecipes` excludes recipes whose ids appear in `prep_recipes.recipe_id`.
2. `fetchRecipes` fails closed: `prep_recipes` query error → error path, shadows do NOT
   leak into the list.
3. `deleteRecipe` on a prep-linked recipe: no `recipes` update issued, error toast shown,
   returns false.
4. `deleteRecipe` on a normal recipe still soft-deletes.
5. `DeleteRecipeDialog`: stays open when `deleteRecipe` returns false; closes on true.

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
