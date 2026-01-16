import type { Recipe, RecipeIngredient } from "@/hooks/useRecipes";
import type { IngredientUnit } from "@/lib/recipeUnits";
import { toIngredientUnit } from "@/lib/recipeUnits";

export type RecipeCopyOptions = {
  includeName: boolean;
  includeDescription: boolean;
  includePosMapping: boolean;
  includeServingSize: boolean;
  includeIngredients: boolean;
};

export type RecipePrefill = Partial<{
  name: string;
  description: string;
  pos_item_name: string;
  pos_item_id: string;
  serving_size: number;
  ingredients: {
    product_id: string;
    quantity: number;
    unit: IngredientUnit;
    notes?: string;
  }[];
}>;

export const buildRecipePrefill = (
  baseRecipe: Recipe,
  baseIngredients: RecipeIngredient[],
  options: RecipeCopyOptions
): RecipePrefill => {
  const prefill: RecipePrefill = {};

  if (options.includeName) {
    prefill.name = baseRecipe.name;
  }

  if (options.includeDescription) {
    prefill.description = baseRecipe.description || "";
  }

  if (options.includePosMapping) {
    prefill.pos_item_name = baseRecipe.pos_item_name || "";
    prefill.pos_item_id = baseRecipe.pos_item_id || "";
  }

  if (options.includeServingSize) {
    prefill.serving_size = baseRecipe.serving_size || 1;
  }

  if (options.includeIngredients) {
    prefill.ingredients = baseIngredients.map((ingredient) => ({
      product_id: ingredient.product_id,
      quantity: Number(ingredient.quantity),
      unit: toIngredientUnit(ingredient.unit),
      notes: ingredient.notes || "",
    }));
  }

  return prefill;
};
