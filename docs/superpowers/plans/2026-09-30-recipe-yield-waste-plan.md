# Recipe yield % (waste allowance) — plan

Design: `docs/superpowers/specs/2026-09-30-recipe-yield-waste-design.md`

Each task is TDD: write the test, see it fail, write the code, see it pass,
commit with explicit paths. Tasks run in the order below.

## A. Database

1. Add `supabase/migrations/20260930120000_recipe_yield_pct.sql`. Add the
   three columns and the three CHECK constraints as `NOT VALID` (design §4).
2. Add `supabase/migrations/20260930120100_recipe_yield_pct_validate.sql`.
   Validate the three constraints. Commit tasks 1–2 together.
3. Write `supabase/tests/recipe_yield_deduction.test.sql` with the CHECK
   cases (49 and 101 fail on both columns, 50 and 100 pass). Run
   `npm run test:db`. Commit.
4. Extend the pgTAP file with the deduction cases (design §9): 100%
   unchanged, 90% deducts 5.5556, override 80% wins, NULL yield = 100%,
   `prosecdef` is true, prep run uses the product yield. See them fail.
5. Add `supabase/migrations/20260930120200_recipe_yield_deduction.sql`.
   Copy the full `process_unified_inventory_deduction` from
   `20260705000000` with its header (`SECURITY DEFINER`,
   `SET search_path TO 'public'`). Change the cursor, line 163, and the
   reason suffix only. Run `npm run test:db`. Commit.
6. Run `npm run db:reset`. Regenerate `src/integrations/supabase/types.ts`
   for the new columns. Commit.

## B. Shared TS helper

7. Write `tests/unit/recipeYield.test.ts` (fails). Add
   `src/lib/recipeYield.ts` with `resolveYieldPct`, `loadedQuantity`,
   `computeLineCost` (design §5.1). Commit.

## C. Cost callers

8. Extend a `useRecipes` unit test: `buildEnhancedRecipes` with a 90%
   product changes `computed_cost`. Change `computeIngredientCost` to
   return `loadedCost`. Add `yield_pct` to the product selects it reads.
   Commit.
9. Write the test for `calculateIngredientCost` at 90% (fails). Add
   `yield_pct` to `IngredientInfo.product` and to the queries that fill it.
   Apply the product yield in `src/lib/prepCostCalculation.ts`. Commit.
10. Write the `inventorySimulation` parity test at 90% (fails). Apply the
    effective yield at `src/utils/inventorySimulation.ts:151`. Commit.

## D. Override persistence

11. Write a test that `updateRecipeIngredients` sends
    `yield_pct_override` (fails). Change its type and insert. Read the
    override back in `fetchRecipeIngredients`. Commit.
12. Write a test that `buildRecipePrefill` copies `yield_pct_override`
    (fails). Change `src/utils/recipePrefill.ts`. Commit.

## E. UI

13. Write `tests/unit/RecipeIngredientItemYield.test.tsx` (fails): inherit
    chip, override chip, low-yield flag at 75, cleared field gives `null`.
    Add the Yield field, the Cost cell, and the caption to
    `RecipeIngredientItem.tsx` (design §6.1, §5.1b). Commit.
14. Change `RecipeDialog.tsx`: add the zod field, delete the duplicate cost
    loop, call `computeLineCost`, map the override on save and on reset.
    Extend an existing `RecipeDialog*` test for the save payload. Commit.
15. Write `tests/unit/useRecipeWeeklyVolume.test.ts` (fails). Add
    `src/hooks/useRecipeWeeklyVolume.ts` (React Query, `staleTime: 60000`,
    last 7 restaurant days of `unified_sales.quantity`). Commit.
16. Write a test for the cost summary (fails): four tiles, "—" with no
    `avg_sale_price`, weekly line only with sales. Add the tile grid to
    `RecipeDialog.tsx` (design §6.2). Commit.
17. Write a test for the product fields (fails): Usable yield, Waste reason,
    low-yield hint, "Used in N recipes". Add the fields to
    `SizePackagingSection` and the schema and save payload in
    `ProductUpdateDialog.tsx` (design §6.3). Commit.

## F. Connector

18. Write `supabase/functions/_shared/recipeAnalytics.test.ts` (fails):
    per-recipe `portion_cost`, `loaded_cost`, `waste_cost`, and the
    `ingredients[]` fields at 90%. Add the calculation to
    `_shared/recipeAnalytics.ts` with `calculateDeduction`.
19. Change `executeGetRecipeAnalytics` so the ingredient fetch runs after the
    top-20 slice, in one `.in('recipe_id', ids)` query. Commit tasks 18–19.

## G. Verify and ship

20. Run `npm run typecheck`, `npm run lint`, `npm run test`,
    `npm run test:db`, `npm run build`.
21. Push the branch. Open the PR.
