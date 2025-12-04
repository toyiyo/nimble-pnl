/**
 * Client-side Inventory Deduction Simulation
 * 
 * This module provides client-side simulation of inventory deductions
 * using the tested calculateInventoryImpact function from enhancedUnitConversion.
 * 
 * This ensures the UI preview matches the actual deduction logic.
 * 
 * ALIGNMENT WITH DATABASE FUNCTION
 * --------------------------------
 * This module aligns with `process_unified_inventory_deduction` (migration 20251023175015).
 * 
 * Both use domain-driven conversion logic:
 * 
 * 1. VOLUME-TO-VOLUME: When recipe unit AND product size_unit are both volume units
 *    - Volume units: fl oz, ml, l, cup, tbsp, tsp, gal, qt
 *    - Uses 'fl oz' for fluid ounces (29.5735 ml conversion)
 * 
 * 2. WEIGHT-TO-WEIGHT: When recipe unit AND product size_unit are both weight units  
 *    - Weight units: g, kg, lb, oz
 *    - Uses 'oz' for weight ounces (28.3495 g conversion)
 * 
 * 3. DENSITY CONVERSION: Volume recipe units (cup, tsp, tbsp) to weight packages
 *    - Rice: 185g/cup, Flour: 120g/cup, Sugar: 200g/cup, Butter: 227g/cup
 * 
 * 4. FALLBACK: When conversion fails, uses 1:1 ratio with warning
 */

import { calculateInventoryImpact, getProductUnitInfo } from '@/lib/enhancedUnitConversion';
import { supabase } from '@/integrations/supabase/client';

export interface IngredientDeduction {
  product_name: string;
  product_id: string;
  quantity_recipe_units: number;
  recipe_unit: string;
  quantity_purchase_units: number;
  purchase_unit: string;
  remaining_stock_purchase_units: number;
  conversion_method?: string;
  cost_per_unit: number;
  total_cost: number;
}

export interface ConversionWarning {
  product_name: string;
  recipe_quantity: number;
  recipe_unit: string;
  purchase_unit: string;
  deduction_amount: number;
  warning_type: 'fallback_1:1' | 'missing_size_info' | 'incompatible_units';
  message: string;
}

export interface SimulationResult {
  recipe_name: string;
  recipe_id: string | null;
  ingredients_deducted: IngredientDeduction[];
  total_cost: number;
  conversion_warnings: ConversionWarning[];
  has_recipe: boolean;
}

interface RecipeWithIngredients {
  id: string;
  name: string;
  pos_item_name: string | null;
  ingredients: {
    product_id: string;
    quantity: number;
    unit: string;
    product: {
      id: string;
      name: string;
      current_stock: number;
      cost_per_unit: number | null;
      uom_purchase: string | null;
      uom_recipe: string | null;
      size_value: number | null;
      size_unit: string | null;
    };
  }[];
}

/**
 * Simulate inventory deduction for a POS sale using client-side logic.
 * This uses the tested calculateInventoryImpact function to ensure
 * consistent behavior between UI previews and actual deductions.
 */
export async function simulateDeductionClientSide(
  restaurantId: string,
  posItemName: string,
  quantitySold: number
): Promise<SimulationResult> {
  // Initialize result
  const result: SimulationResult = {
    recipe_name: '',
    recipe_id: null,
    ingredients_deducted: [],
    total_cost: 0,
    conversion_warnings: [],
    has_recipe: false,
  };

  // 1. Find matching recipe by POS item name
  const { data: recipe, error: recipeError } = await supabase
    .from('recipes')
    .select(`
      id,
      name,
      pos_item_name,
      ingredients:recipe_ingredients(
        product_id,
        quantity,
        unit,
        product:products(
          id,
          name,
          current_stock,
          cost_per_unit,
          uom_purchase,
          uom_recipe,
          size_value,
          size_unit
        )
      )
    `)
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .or(`pos_item_name.ilike.${posItemName},name.ilike.${posItemName}`)
    .single();

  if (recipeError || !recipe) {
    // No recipe found
    return result;
  }

  const typedRecipe = recipe as unknown as RecipeWithIngredients;
  
  result.recipe_name = typedRecipe.name;
  result.recipe_id = typedRecipe.id;
  result.has_recipe = true;

  // 2. Process each ingredient
  for (const ingredient of typedRecipe.ingredients) {
    const product = ingredient.product;
    if (!product) continue;

    const recipeQuantity = ingredient.quantity * quantitySold;
    const recipeUnit = ingredient.unit;
    const productInfo = getProductUnitInfo(product);
    
    try {
      // Use the tested calculateInventoryImpact function
      const impact = calculateInventoryImpact(
        recipeQuantity,
        recipeUnit,
        productInfo.quantityPerPurchaseUnit,
        productInfo.purchaseUnit,
        product.name,
        product.cost_per_unit || 0,
        productInfo.sizeValue,
        productInfo.sizeUnit
      );

      const ingredientDeduction: IngredientDeduction = {
        product_name: product.name,
        product_id: product.id,
        quantity_recipe_units: recipeQuantity,
        recipe_unit: recipeUnit,
        quantity_purchase_units: impact.inventoryDeduction,
        purchase_unit: impact.inventoryDeductionUnit,
        remaining_stock_purchase_units: (product.current_stock || 0) - impact.inventoryDeduction,
        conversion_method: impact.conversionDetails?.productSpecific ? 'product_specific' : 'standard',
        cost_per_unit: product.cost_per_unit || 0,
        total_cost: impact.costImpact,
      };

      result.ingredients_deducted.push(ingredientDeduction);
      result.total_cost += impact.costImpact;

    } catch (error: unknown) {
      // Handle conversion errors with fallback 1:1 ratio
      const errorMessage = error instanceof Error ? error.message : 'Unknown conversion error';
      
      // Use 1:1 fallback
      const fallbackDeduction = recipeQuantity;
      const fallbackCost = fallbackDeduction * (product.cost_per_unit || 0);

      const ingredientDeduction: IngredientDeduction = {
        product_name: product.name,
        product_id: product.id,
        quantity_recipe_units: recipeQuantity,
        recipe_unit: recipeUnit,
        quantity_purchase_units: fallbackDeduction,
        purchase_unit: productInfo.purchaseUnit,
        remaining_stock_purchase_units: (product.current_stock || 0) - fallbackDeduction,
        conversion_method: 'fallback_1:1',
        cost_per_unit: product.cost_per_unit || 0,
        total_cost: fallbackCost,
      };

      result.ingredients_deducted.push(ingredientDeduction);
      result.total_cost += fallbackCost;

      // Add conversion warning
      result.conversion_warnings.push({
        product_name: product.name,
        recipe_quantity: recipeQuantity,
        recipe_unit: recipeUnit,
        purchase_unit: productInfo.purchaseUnit,
        deduction_amount: fallbackDeduction,
        warning_type: 'fallback_1:1',
        message: errorMessage,
      });
    }
  }

  return result;
}

/**
 * Check if a recipe exists for a given POS item name.
 * Uses the tested hasRecipeMapping logic.
 */
export async function checkRecipeExists(
  restaurantId: string,
  posItemName: string
): Promise<{ exists: boolean; recipeId: string | null; recipeName: string | null }> {
  const { data: recipe } = await supabase
    .from('recipes')
    .select('id, name')
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .or(`pos_item_name.ilike.${posItemName},name.ilike.${posItemName}`)
    .single();

  if (recipe) {
    return { exists: true, recipeId: recipe.id, recipeName: recipe.name };
  }

  return { exists: false, recipeId: null, recipeName: null };
}

/**
 * Calculate the impact of selling a specific quantity of a recipe.
 * This is useful for showing real-time impact previews in the UI.
 */
export function calculateSaleImpact(
  recipeIngredients: Array<{
    productName: string;
    recipeQuantity: number;
    recipeUnit: string;
    purchaseQuantity: number;
    purchaseUnit: string;
    costPerUnit: number;
    currentStock: number;
    sizeValue?: number;
    sizeUnit?: string;
  }>,
  quantitySold: number
): {
  ingredients: Array<{
    productName: string;
    deductionAmount: number;
    deductionUnit: string;
    remainingStock: number;
    costImpact: number;
    lowStockWarning: boolean;
  }>;
  totalCost: number;
  warnings: string[];
} {
  const ingredients: Array<{
    productName: string;
    deductionAmount: number;
    deductionUnit: string;
    remainingStock: number;
    costImpact: number;
    lowStockWarning: boolean;
  }> = [];
  let totalCost = 0;
  const warnings: string[] = [];

  for (const ing of recipeIngredients) {
    const recipeQty = ing.recipeQuantity * quantitySold;

    try {
      const impact = calculateInventoryImpact(
        recipeQty,
        ing.recipeUnit,
        ing.purchaseQuantity,
        ing.purchaseUnit,
        ing.productName,
        ing.costPerUnit,
        ing.sizeValue,
        ing.sizeUnit
      );

      const remainingStock = ing.currentStock - impact.inventoryDeduction;
      const lowStockWarning = remainingStock < 1;

      ingredients.push({
        productName: ing.productName,
        deductionAmount: impact.inventoryDeduction,
        deductionUnit: impact.inventoryDeductionUnit,
        remainingStock,
        costImpact: impact.costImpact,
        lowStockWarning,
      });

      totalCost += impact.costImpact;

      if (lowStockWarning) {
        warnings.push(`Low stock warning: ${ing.productName} will have ${remainingStock.toFixed(2)} ${impact.inventoryDeductionUnit} remaining`);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      warnings.push(`Conversion error for ${ing.productName}: ${errorMessage}`);
      
      // Use fallback
      ingredients.push({
        productName: ing.productName,
        deductionAmount: recipeQty,
        deductionUnit: ing.purchaseUnit,
        remainingStock: ing.currentStock - recipeQty,
        costImpact: recipeQty * ing.costPerUnit,
        lowStockWarning: (ing.currentStock - recipeQty) < 1,
      });
      totalCost += recipeQty * ing.costPerUnit;
    }
  }

  return { ingredients, totalCost, warnings };
}
