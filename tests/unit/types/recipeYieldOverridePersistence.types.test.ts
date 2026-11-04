/**
 * Compile-time check: `updateRecipeIngredients` accepts `yield_pct_override`
 * on each ingredient line, and `RecipeIngredient` (the type
 * `fetchRecipeIngredients` returns) carries it back.
 *
 * These are type assertions, so `npm run typecheck:types` is the real test.
 * Vitest strips the types and runs only the runtime check below.
 */
import { describe, it, expect } from 'vitest';
import type { useRecipes, RecipeIngredient } from '@/hooks/useRecipes';

type UpdateFn = ReturnType<typeof useRecipes>['updateRecipeIngredients'];

declare const updateRecipeIngredients: UpdateFn;

function callsWithOverride() {
  return updateRecipeIngredients('recipe-1', [
    { product_id: 'product-1', quantity: 2, unit: 'oz', yield_pct_override: 80 },
  ]);
}

const readsOverrideBack = (ingredient: RecipeIngredient): number | null | undefined =>
  ingredient.yield_pct_override;

describe('updateRecipeIngredients / RecipeIngredient yield_pct_override typing', () => {
  it('compiles a call that sends yield_pct_override', () => {
    expect(typeof callsWithOverride).toBe('function');
  });

  it('compiles reading yield_pct_override off a fetched RecipeIngredient', () => {
    expect(typeof readsOverrideBack).toBe('function');
  });
});
