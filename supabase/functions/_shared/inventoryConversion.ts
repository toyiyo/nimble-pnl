/**
 * Inventory Unit Conversion Module
 * 
 * Pure TypeScript implementation of the unit conversion logic used in
 * the `process_unified_inventory_deduction` database function.
 * 
 * This module is designed to:
 * 1. Be testable without database dependencies
 * 2. Mirror the exact logic in the SQL function
 * 3. Be usable for client-side previews/simulations
 * 
 * Used by:
 * - Database: supabase/migrations/20251023175015_*.sql
 * - Frontend: Preview deductions before processing
 * - Tests: Validate conversion calculations
 */

// ===== UNIT DEFINITIONS =====

/**
 * Volume units and their conversion factors to milliliters (ml)
 */
export const VOLUME_UNITS: Record<string, number> = {
  'ml': 1,
  'l': 1000,
  'fl oz': 29.5735,
  'cup': 236.588,
  'tbsp': 14.7868,
  'tsp': 4.92892,
  'gal': 3785.41,
  'qt': 946.353,
  'pint': 473.176,
};

/**
 * Weight units and their conversion factors to grams (g)
 */
export const WEIGHT_UNITS: Record<string, number> = {
  'g': 1,
  'kg': 1000,
  'lb': 453.592,
  'oz': 28.3495,
};

/**
 * Density conversions: cups to grams for common ingredients
 * Used when recipe is in volume (cups) but package is in weight
 */
export const DENSITY_CUP_TO_GRAMS: Record<string, number> = {
  'rice': 185,
  'flour': 120,
  'sugar': 200,
  'butter': 227,
};

/**
 * Container units (bag, box, case, package, etc.)
 * Used for count-to-container conversions
 */
export const CONTAINER_UNITS: string[] = [
  'bag', 'box', 'case', 'package', 'container'
];

/**
 * Individual count units (each, piece, unit)
 * Used for count-to-container conversions
 */
export const INDIVIDUAL_UNITS: string[] = [
  'each', 'piece', 'unit'
];

// ===== TYPE DEFINITIONS =====

export type UnitDomain = 'volume' | 'weight' | 'each' | 'unknown';

export type ConversionMethod = 
  | '1:1'
  | 'count_to_container'
  | 'volume_to_volume'
  | 'weight_to_weight'
  | 'density_to_weight'
  | 'fallback_1:1';

export interface ConversionResult {
  /** Amount in purchase units to deduct from inventory */
  purchaseUnitDeduction: number;
  /** Cost per recipe unit (for total cost calculation) */
  costPerRecipeUnit: number;
  /** Method used for conversion */
  conversionMethod: ConversionMethod;
  /** Whether conversion succeeded or fell back */
  success: boolean;
  /** Warning message if fallback was used */
  warning?: string;
}

export interface IngredientInfo {
  /** Quantity needed per recipe (e.g., 2 cups) */
  recipeQuantity: number;
  /** Unit used in recipe (e.g., 'cup', 'oz', 'g') */
  recipeUnit: string;
  /** Product name (for density lookup) */
  productName: string;
  /** Unit product is purchased in (e.g., 'bottle', 'bag', 'each') */
  purchaseUnit: string;
  /** Size value of package (e.g., 750 for a 750ml bottle) */
  sizeValue: number | null;
  /** Unit of package size (e.g., 'ml', 'l', 'oz') */
  sizeUnit: string | null;
  /** Cost per purchase unit */
  costPerUnit: number;
}

// ===== HELPER FUNCTIONS =====

/**
 * Determine the domain (volume, weight, each) of a unit
 */
export function getUnitDomain(unit: string): UnitDomain {
  const normalized = unit.toLowerCase().trim();
  
  if (normalized in VOLUME_UNITS) return 'volume';
  if (normalized in WEIGHT_UNITS) return 'weight';
  if (normalized === 'each' || normalized === 'unit' || normalized === 'ea') return 'each';
  
  return 'unknown';
}

/**
 * Check if a unit is a volume unit
 */
export function isVolumeUnit(unit: string): boolean {
  return getUnitDomain(unit) === 'volume';
}

/**
 * Check if a unit is a weight unit
 */
export function isWeightUnit(unit: string): boolean {
  return getUnitDomain(unit) === 'weight';
}

/**
 * Convert a volume amount to milliliters
 */
export function toMilliliters(amount: number, unit: string): number | null {
  const normalized = unit.toLowerCase().trim();
  const factor = VOLUME_UNITS[normalized];
  
  if (factor === undefined) return null;
  return amount * factor;
}

/**
 * Convert a weight amount to grams
 */
export function toGrams(amount: number, unit: string): number | null {
  const normalized = unit.toLowerCase().trim();
  const factor = WEIGHT_UNITS[normalized];
  
  if (factor === undefined) return null;
  return amount * factor;
}

/**
 * Get density conversion factor (cups to grams) for a product
 * Returns null if no density mapping exists
 */
export function getDensityFactor(productName: string, recipeUnit: string): number | null {
  // Only support cup-based density conversions for now
  if (recipeUnit.toLowerCase() !== 'cup') return null;
  
  const nameLower = productName.toLowerCase();
  
  for (const [ingredient, gramsPerCup] of Object.entries(DENSITY_CUP_TO_GRAMS)) {
    if (nameLower.includes(ingredient)) {
      return gramsPerCup;
    }
  }
  
  return null;
}

// ===== MAIN CONVERSION FUNCTION =====

/**
 * Calculate the inventory deduction for a recipe ingredient.
 * 
 * This mirrors the logic in `process_unified_inventory_deduction`:
 * 1. Direct unit match → 1:1 conversion
 * 2. Volume-to-Volume → Convert through milliliters
 * 3. Weight-to-Weight → Convert through grams
 * 4. Density conversion → Volume recipe to weight package
 * 5. Fallback → 1:1 with warning
 * 
 * @param ingredient - Ingredient information from recipe
 * @param quantitySold - Number of recipe portions sold
 * @returns Conversion result with deduction amount and method
 */
export function calculateDeduction(
  ingredient: IngredientInfo,
  quantitySold: number
): ConversionResult {
  const deductionAmount = ingredient.recipeQuantity * quantitySold;
  const recipeUnit = ingredient.recipeUnit.toLowerCase().trim();
  const purchaseUnit = ingredient.purchaseUnit.toLowerCase().trim();
  const sizeUnit = (ingredient.sizeUnit || '').toLowerCase().trim();
  
  // CASE 0: Direct unit match
  if (recipeUnit === purchaseUnit) {
    return {
      purchaseUnitDeduction: deductionAmount,
      costPerRecipeUnit: ingredient.costPerUnit,
      conversionMethod: '1:1',
      success: true,
    };
  }
  
  // CASE 0.5: Count-to-Container Conversion (NEW)
  // Handles products stored in packages with countable items (e.g., tortillas, buns)
  if (INDIVIDUAL_UNITS.includes(recipeUnit) && 
      CONTAINER_UNITS.includes(purchaseUnit) &&
      ingredient.sizeValue && ingredient.sizeValue > 0 &&
      sizeUnit && INDIVIDUAL_UNITS.includes(sizeUnit)) {
    
    // Recipe uses individual items, product stored in containers
    // sizeValue tells us how many items per container
    const purchaseUnitDeduction = deductionAmount / ingredient.sizeValue;
    const costPerRecipeUnit = ingredient.costPerUnit / ingredient.sizeValue;
    
    return {
      purchaseUnitDeduction,
      costPerRecipeUnit,
      conversionMethod: 'count_to_container',
      success: true,
    };
  }
  
  // CASE 1: Volume-to-Volume Conversion
  if (isVolumeUnit(recipeUnit) && isVolumeUnit(sizeUnit)) {
    if (ingredient.sizeValue && ingredient.sizeValue > 0) {
      const recipeInMl = toMilliliters(deductionAmount, recipeUnit);
      const packageSizeMl = toMilliliters(ingredient.sizeValue, sizeUnit);
      
      if (recipeInMl !== null && packageSizeMl !== null && packageSizeMl > 0) {
        const purchaseUnitDeduction = recipeInMl / packageSizeMl;
        const costPerRecipeUnit = (ingredient.costPerUnit / packageSizeMl) * (recipeInMl / deductionAmount);
        
        return {
          purchaseUnitDeduction,
          costPerRecipeUnit,
          conversionMethod: 'volume_to_volume',
          success: true,
        };
      }
    }
  }
  
  // CASE 2: Weight-to-Weight Conversion
  if (isWeightUnit(recipeUnit) && isWeightUnit(sizeUnit)) {
    if (ingredient.sizeValue && ingredient.sizeValue > 0) {
      const recipeInGrams = toGrams(deductionAmount, recipeUnit);
      const packageSizeGrams = toGrams(ingredient.sizeValue, sizeUnit);
      
      if (recipeInGrams !== null && packageSizeGrams !== null && packageSizeGrams > 0) {
        const purchaseUnitDeduction = recipeInGrams / packageSizeGrams;
        const costPerRecipeUnit = (ingredient.costPerUnit / packageSizeGrams) * (recipeInGrams / deductionAmount);
        
        return {
          purchaseUnitDeduction,
          costPerRecipeUnit,
          conversionMethod: 'weight_to_weight',
          success: true,
        };
      }
    }
  }
  
  // CASE 3: Density Conversion (Volume recipe to Weight package)
  if (['cup', 'tsp', 'tbsp'].includes(recipeUnit) && isWeightUnit(sizeUnit)) {
    if (ingredient.sizeValue && ingredient.sizeValue > 0) {
      const densityFactor = getDensityFactor(ingredient.productName, recipeUnit);
      
      if (densityFactor !== null) {
        const recipeInGrams = deductionAmount * densityFactor;
        const packageSizeGrams = toGrams(ingredient.sizeValue, sizeUnit);
        
        if (packageSizeGrams !== null && packageSizeGrams > 0) {
          const purchaseUnitDeduction = recipeInGrams / packageSizeGrams;
          const costPerRecipeUnit = (ingredient.costPerUnit / packageSizeGrams) * (recipeInGrams / deductionAmount);
          
          return {
            purchaseUnitDeduction,
            costPerRecipeUnit,
            conversionMethod: 'density_to_weight',
            success: true,
          };
        }
      }
    }
  }
  
  // FALLBACK: 1:1 with warning
  return {
    purchaseUnitDeduction: deductionAmount,
    costPerRecipeUnit: ingredient.costPerUnit,
    conversionMethod: 'fallback_1:1',
    success: false,
    warning: `Could not convert ${deductionAmount} ${recipeUnit} to ${purchaseUnit} (package unit: ${sizeUnit}). Using 1:1 ratio.`,
  };
}

/**
 * Calculate total cost for a deduction
 */
export function calculateTotalCost(
  recipeQuantity: number,
  quantitySold: number,
  costPerRecipeUnit: number
): number {
  return recipeQuantity * quantitySold * costPerRecipeUnit;
}

/**
 * Generate a reference ID for duplicate detection
 */
export function generateReferenceId(
  posItemName: string,
  saleDate: string,
  externalOrderId?: string | null
): string {
  if (externalOrderId) {
    return `${externalOrderId}_${posItemName}_${saleDate}`;
  }
  return `${posItemName}_${saleDate}`;
}
