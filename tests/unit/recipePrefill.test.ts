import { describe, expect, it } from "vitest";
import type { Recipe, RecipeIngredient } from "@/hooks/useRecipes";
import { buildRecipePrefill, type RecipeCopyOptions } from "@/utils/recipePrefill";

const baseRecipe: Recipe = {
  id: "recipe-1",
  restaurant_id: "rest-1",
  name: "Carne Guisada",
  description: "Slow-braised beef",
  pos_item_name: "Carne Guisada Plate",
  pos_item_id: "pos-123",
  serving_size: 2,
  estimated_cost: 4.2,
  is_active: true,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

const baseIngredients: RecipeIngredient[] = [
  {
    id: "ing-1",
    recipe_id: "recipe-1",
    product_id: "prod-1",
    quantity: 2,
    unit: "oz",
    notes: "trimmed",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  },
];

describe("buildRecipePrefill", () => {
  it("copies only the selected fields", () => {
    const options: RecipeCopyOptions = {
      includeName: false,
      includeDescription: true,
      includePosMapping: false,
      includeServingSize: true,
      includeIngredients: true,
    };

    const result = buildRecipePrefill(baseRecipe, baseIngredients, options);

    expect(result).toMatchObject({
      description: "Slow-braised beef",
      serving_size: 2,
    });
    expect(result.ingredients).toHaveLength(1);
    expect(result.name).toBeUndefined();
    expect(result.pos_item_name).toBeUndefined();
  });

  it("copies name and POS mapping when enabled", () => {
    const options: RecipeCopyOptions = {
      includeName: true,
      includeDescription: false,
      includePosMapping: true,
      includeServingSize: false,
      includeIngredients: false,
    };

    const result = buildRecipePrefill(baseRecipe, baseIngredients, options);

    expect(result.name).toBe("Carne Guisada");
    expect(result.pos_item_name).toBe("Carne Guisada Plate");
    expect(result.pos_item_id).toBe("pos-123");
    expect(result.ingredients).toBeUndefined();
  });
});
