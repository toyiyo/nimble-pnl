/**
 * Shared cost calculation logic for prep recipes and production batches.
 * 
 * This module provides reusable functions for calculating ingredient costs
 * with proper unit conversion. Both the recipe system and batch system
 * MUST use these functions to ensure consistency.
 * 
 * @see docs/UNIT_CONVERSIONS.md for conversion details
 * @see BATCH_FUNCTIONALITY_AUDIT.md for why this module exists
 */

import { calculateInventoryImpact, getProductUnitInfo } from './enhancedUnitConversion';
import type { IngredientUnit } from './recipeUnits';

/**
 * Product information required for cost calculation.
 * This matches the structure from both recipes and prep batches.
 */
export interface ProductInfo {
  id: string;
  name: string;
  cost_per_unit?: number | null;
  uom_purchase?: string | null;
  size_value?: number | null;
  size_unit?: string | null;
  current_stock?: number | null;
}

/**
 * Ingredient information for cost calculation.
 */
export interface IngredientInfo {
  product_id: string;
  quantity: number;
  unit: IngredientUnit | string;
  product?: ProductInfo;
}

/**
 * Result of ingredient cost calculation.
 */
export interface IngredientCostResult {
  productId: string;
  productName: string;
  quantity: number;
  unit: string;
  costPerUnit: number;
  inventoryDeduction: number;
  inventoryDeductionUnit: string;
  costImpact: number;
  conversionApplied: boolean;
  conversionPath?: string[];
}

/**
 * Calculate the cost of a single ingredient with proper unit conversion.
 * 
 * This is the authoritative function for ingredient cost calculation.
 * It properly converts between recipe units and purchase units.
 * 
 * @param ingredient - The ingredient with quantity, unit, and product info
 * @returns Cost calculation result with conversion details
 * 
 * @example
 * ```typescript
 * const ingredient = {
 *   product_id: 'vodka-123',
 *   quantity: 1.5,
 *   unit: 'fl oz',
 *   product: {
 *     id: 'vodka-123',
 *     name: 'Vodka',
 *     cost_per_unit: 20,
 *     uom_purchase: 'bottle',
 *     size_value: 750,
 *     size_unit: 'ml'
 *   }
 * };
 * 
 * const result = calculateIngredientCost(ingredient);
 * // result.costImpact = $1.18 (1.5 fl oz from 750ml bottle)
 * ```
 */
export function calculateIngredientCost(ingredient: IngredientInfo): IngredientCostResult {
  const product = ingredient.product;
  
  if (!product) {
    throw new Error(`Product not found for ingredient ${ingredient.product_id}`);
  }

  const productName = product.name || 'Unknown Product';
  const costPerUnit = product.cost_per_unit || 0;

  // If no cost, return zero-cost result
  if (costPerUnit === 0) {
    return {
      productId: ingredient.product_id,
      productName,
      quantity: ingredient.quantity,
      unit: ingredient.unit as string,
      costPerUnit: 0,
      inventoryDeduction: ingredient.quantity,
      inventoryDeductionUnit: ingredient.unit as string,
      costImpact: 0,
      conversionApplied: false,
    };
  }

  // Get validated product unit info using shared helper
  const { purchaseUnit, quantityPerPurchaseUnit, sizeValue, sizeUnit } = getProductUnitInfo(product);

  // Calculate inventory impact with unit conversion
  const conversionResult = calculateInventoryImpact(
    ingredient.quantity,
    ingredient.unit as string,
    quantityPerPurchaseUnit,
    purchaseUnit,
    productName,
    costPerUnit,
    sizeValue,
    sizeUnit
  );

  return {
    productId: ingredient.product_id,
    productName,
    quantity: ingredient.quantity,
    unit: ingredient.unit as string,
    costPerUnit,
    inventoryDeduction: conversionResult.inventoryDeduction,
    inventoryDeductionUnit: conversionResult.inventoryDeductionUnit,
    costImpact: conversionResult.costImpact,
    conversionApplied: !!conversionResult.conversionDetails,
    conversionPath: conversionResult.conversionDetails?.conversionPath,
  };
}

/**
 * Calculate total cost for multiple ingredients with unit conversion.
 * 
 * This is the shared function that BOTH recipes and batches should use.
 * 
 * @param ingredients - Array of ingredients to calculate cost for
 * @returns Total cost and detailed breakdown by ingredient
 * 
 * @example
 * ```typescript
 * const { totalCost, ingredients } = calculateIngredientsCost([
 *   { product_id: 'vodka-123', quantity: 1.5, unit: 'fl oz', product: {...} },
 *   { product_id: 'lime-456', quantity: 0.5, unit: 'each', product: {...} }
 * ]);
 * ```
 */
export function calculateIngredientsCost(
  ingredients: IngredientInfo[]
): {
  totalCost: number;
  ingredients: IngredientCostResult[];
  warnings: string[];
} {
  const results: IngredientCostResult[] = [];
  const warnings: string[] = [];
  let totalCost = 0;

  for (const ingredient of ingredients) {
    try {
      const result = calculateIngredientCost(ingredient);
      results.push(result);
      totalCost += result.costImpact;

      // Log warning if no conversion was applied (might indicate missing product data)
      if (!result.conversionApplied && result.unit !== result.inventoryDeductionUnit) {
        warnings.push(
          `No unit conversion for ${result.productName}: ${result.quantity} ${result.unit} used as 1:1 ratio with ${result.inventoryDeductionUnit}`
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      warnings.push(`Error calculating cost for ${ingredient.product?.name || ingredient.product_id}: ${errorMessage}`);
      
      // Add zero-cost result to maintain array consistency
      results.push({
        productId: ingredient.product_id,
        productName: ingredient.product?.name || 'Unknown',
        quantity: ingredient.quantity,
        unit: ingredient.unit as string,
        costPerUnit: 0,
        inventoryDeduction: 0,
        inventoryDeductionUnit: ingredient.unit as string,
        costImpact: 0,
        conversionApplied: false,
      });
    }
  }

  return {
    totalCost,
    ingredients: results,
    warnings,
  };
}

/**
 * Helper to format cost results for display/logging.
 */
export function formatCostResult(result: IngredientCostResult): string {
  const conversion = result.conversionApplied
    ? ` (${result.inventoryDeduction.toFixed(4)} ${result.inventoryDeductionUnit})`
    : '';
  
  return `${result.productName}: ${result.quantity} ${result.unit}${conversion} = $${result.costImpact.toFixed(2)}`;
}
