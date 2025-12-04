/**
 * Utilities for POS item to recipe mapping
 * These functions determine whether a POS sale item has an associated recipe
 * for inventory deduction purposes.
 */

export interface RecipeInfo {
  id: string;
  name: string;
  profitMargin?: number;
  hasIngredients: boolean;
}

/**
 * Full recipe interface with all fields
 */
export interface Recipe {
  id: string;
  name: string;
  pos_item_name?: string;
  profit_margin?: number;
  ingredients?: Array<{ product_id: string; quantity: number; unit: string }>;
}

/**
 * Minimal recipe interface for quick mapping checks
 * Used when only checking if a POS item has a recipe, without needing full details
 */
export interface MinimalRecipe {
  id: string;
  pos_item_name?: string | null;
}

export interface SaleItem {
  itemName: string;
  quantity: number;
  totalPrice?: number;
}

/**
 * Create a map of POS item names (lowercase) to recipe information
 * for quick O(1) lookups when checking if a sale item has a recipe.
 */
export function createRecipeByItemNameMap(
  recipes: Recipe[]
): Map<string, RecipeInfo> {
  const map = new Map<string, RecipeInfo>();
  
  recipes.forEach(recipe => {
    if (recipe.pos_item_name) {
      map.set(recipe.pos_item_name.toLowerCase(), {
        id: recipe.id,
        name: recipe.name,
        profitMargin: recipe.profit_margin,
        hasIngredients: recipe.ingredients ? recipe.ingredients.length > 0 : false
      });
    }
  });
  
  return map;
}

/**
 * Create a simple set of mapped POS item names for quick existence checks.
 * This is more efficient when you only need to check if a recipe exists,
 * without needing the full recipe details.
 */
export function createMappedItemNamesSet(
  recipes: MinimalRecipe[]
): Set<string> {
  const set = new Set<string>();
  
  recipes.forEach(recipe => {
    if (recipe.pos_item_name) {
      set.add(recipe.pos_item_name.toLowerCase());
    }
  });
  
  return set;
}

/**
 * Check if a sale item has a recipe mapping using a pre-built set.
 * More efficient for simple existence checks.
 */
export function hasRecipeMappingFromSet(
  itemName: string,
  mappedItemNames: Set<string>
): boolean {
  return mappedItemNames.has(itemName.toLowerCase());
}

/**
 * Check if a sale item has a recipe mapping.
 * Uses case-insensitive comparison.
 */
export function hasRecipeMapping(
  itemName: string,
  recipeByItemName: Map<string, RecipeInfo>
): boolean {
  return recipeByItemName.has(itemName.toLowerCase());
}

/**
 * Get recipe info for a sale item.
 * Returns undefined if no recipe mapping exists.
 */
export function getRecipeForItem(
  itemName: string,
  recipeByItemName: Map<string, RecipeInfo>
): RecipeInfo | undefined {
  return recipeByItemName.get(itemName.toLowerCase());
}

/**
 * Count the number of unique items without recipe mappings.
 * Used for dashboard metrics.
 */
export function countUnmappedItems(
  sales: SaleItem[],
  recipeByItemName: Map<string, RecipeInfo>
): number {
  const uniqueItemNames = new Set(sales.map(sale => sale.itemName));
  return Array.from(uniqueItemNames).filter(
    itemName => !hasRecipeMapping(itemName, recipeByItemName)
  ).length;
}

/**
 * Get a list of unique item names that don't have recipe mappings.
 */
export function getUnmappedItems(
  sales: SaleItem[],
  recipeByItemName: Map<string, RecipeInfo>
): string[] {
  const uniqueItemNames = new Set(sales.map(sale => sale.itemName));
  return Array.from(uniqueItemNames).filter(
    itemName => !hasRecipeMapping(itemName, recipeByItemName)
  );
}

/**
 * Determine the recipe status for a sale item.
 * Returns one of:
 * - 'mapped': Item has a recipe with ingredients
 * - 'mapped-no-ingredients': Item has a recipe but no ingredients defined
 * - 'unmapped': Item has no recipe mapping
 */
export function getRecipeStatus(
  itemName: string,
  recipeByItemName: Map<string, RecipeInfo>
): 'mapped' | 'mapped-no-ingredients' | 'unmapped' {
  const recipe = getRecipeForItem(itemName, recipeByItemName);
  
  if (!recipe) {
    return 'unmapped';
  }
  
  return recipe.hasIngredients ? 'mapped' : 'mapped-no-ingredients';
}
