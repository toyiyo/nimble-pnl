/**
 * Inventory Conversion Scenarios - Comprehensive Edge Case Tests
 * 
 * This test suite validates inventory deduction calculations across
 * real-world restaurant scenarios. Like dashboardScenarios.test.ts,
 * it focuses on mathematical correctness and edge cases.
 * 
 * CRITICAL: These calculations affect:
 * - Stock levels (running out of inventory)
 * - Food cost percentages (P&L accuracy)
 * - Purchase order suggestions
 * - Waste tracking
 */

import { describe, it, expect } from 'vitest';
import {
  VOLUME_UNITS,
  WEIGHT_UNITS,
  DENSITY_CUP_TO_GRAMS,
  getUnitDomain,
  isVolumeUnit,
  isWeightUnit,
  toMilliliters,
  toGrams,
  getDensityFactor,
  calculateDeduction,
  calculateTotalCost,
  generateReferenceId,
  type IngredientInfo,
  type ConversionResult,
} from '../../supabase/functions/_shared/inventoryConversion';

// ===== HELPER FUNCTIONS =====

/**
 * Create ingredient with defaults for cleaner test code
 */
function createIngredient(overrides: Partial<IngredientInfo>): IngredientInfo {
  return {
    recipeQuantity: 1,
    recipeUnit: 'oz',
    productName: 'Test Product',
    purchaseUnit: 'bottle',
    sizeValue: 750,
    sizeUnit: 'ml',
    costPerUnit: 10.00,
    ...overrides,
  };
}

/**
 * Round to specified decimal places for comparison
 */
function round(value: number, decimals: number = 4): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

// ===== SCENARIO 1: BAR OPERATIONS =====

describe('Scenario: Bar Operations', () => {
  describe('Standard Cocktail Production', () => {
    it('calculates vodka deduction for 100 Moscow Mules', () => {
      // Recipe: 2 oz vodka per drink
      // Package: 750ml bottle @ $18.99
      const ingredient = createIngredient({
        recipeQuantity: 2,
        recipeUnit: 'fl oz',
        productName: 'Titos Vodka',
        purchaseUnit: 'bottle',
        sizeValue: 750,
        sizeUnit: 'ml',
        costPerUnit: 18.99,
      });

      const result = calculateDeduction(ingredient, 100);

      // 200 fl oz × 29.5735 ml/fl oz = 5914.7 ml
      // 5914.7 ml / 750 ml = 7.886 bottles
      expect(result.success).toBe(true);
      expect(result.conversionMethod).toBe('volume_to_volume');
      expect(round(result.purchaseUnitDeduction, 2)).toBeCloseTo(7.89, 1);
      
      // Total cost: 7.886 bottles × $18.99 = $149.79
      const totalCost = result.purchaseUnitDeduction * ingredient.costPerUnit;
      expect(round(totalCost, 2)).toBeCloseTo(149.79, 0);
    });

    it('calculates lime juice for 50 Margaritas', () => {
      // Recipe: 1 oz fresh lime juice
      // Package: 1 gallon jug @ $12.50
      const ingredient = createIngredient({
        recipeQuantity: 1,
        recipeUnit: 'fl oz',
        productName: 'Fresh Lime Juice',
        purchaseUnit: 'jug',
        sizeValue: 1,
        sizeUnit: 'gal',
        costPerUnit: 12.50,
      });

      const result = calculateDeduction(ingredient, 50);

      // 50 fl oz × 29.5735 = 1478.675 ml
      // 1 gal = 3785.41 ml
      // 1478.675 / 3785.41 = 0.3906 jugs
      expect(result.success).toBe(true);
      expect(round(result.purchaseUnitDeduction, 3)).toBeCloseTo(0.391, 2);
    });

    it('calculates simple syrup in tablespoons', () => {
      // Recipe: 0.5 tbsp simple syrup
      // Package: 1 liter bottle @ $8.00
      const ingredient = createIngredient({
        recipeQuantity: 0.5,
        recipeUnit: 'tbsp',
        productName: 'Simple Syrup',
        purchaseUnit: 'bottle',
        sizeValue: 1,
        sizeUnit: 'l',
        costPerUnit: 8.00,
      });

      const result = calculateDeduction(ingredient, 200);

      // 100 tbsp × 14.7868 ml = 1478.68 ml
      // 1478.68 / 1000 = 1.479 bottles
      expect(result.success).toBe(true);
      expect(round(result.purchaseUnitDeduction, 2)).toBeCloseTo(1.48, 1);
    });

    it('handles shots from 1.75L handle bottles', () => {
      // Recipe: 1.5 oz whiskey (standard shot)
      // Package: 1.75L handle @ $32.99
      const ingredient = createIngredient({
        recipeQuantity: 1.5,
        recipeUnit: 'fl oz',
        productName: 'Jack Daniels',
        purchaseUnit: 'handle',
        sizeValue: 1750,
        sizeUnit: 'ml',
        costPerUnit: 32.99,
      });

      const result = calculateDeduction(ingredient, 100);

      // 150 fl oz × 29.5735 = 4436.025 ml
      // 4436.025 / 1750 = 2.535 handles
      expect(result.success).toBe(true);
      expect(round(result.purchaseUnitDeduction, 2)).toBeCloseTo(2.54, 1);
    });
  });

  describe('High Volume Bar Night', () => {
    it('tracks multiple ingredients for single cocktail type', () => {
      const quantitySold = 500; // Busy Friday night

      // Ingredient 1: Tequila (2 oz)
      const tequila = createIngredient({
        recipeQuantity: 2,
        recipeUnit: 'fl oz',
        productName: 'Patron Silver',
        sizeValue: 750,
        sizeUnit: 'ml',
        costPerUnit: 45.00,
      });

      // Ingredient 2: Triple Sec (0.75 oz)
      const tripleSec = createIngredient({
        recipeQuantity: 0.75,
        recipeUnit: 'fl oz',
        productName: 'Cointreau',
        sizeValue: 750,
        sizeUnit: 'ml',
        costPerUnit: 35.00,
      });

      // Ingredient 3: Lime juice (1 oz)
      const limeJuice = createIngredient({
        recipeQuantity: 1,
        recipeUnit: 'fl oz',
        productName: 'Fresh Lime Juice',
        sizeValue: 1,
        sizeUnit: 'gal',
        costPerUnit: 12.50,
      });

      const tequilaResult = calculateDeduction(tequila, quantitySold);
      const tripleSecResult = calculateDeduction(tripleSec, quantitySold);
      const limeResult = calculateDeduction(limeJuice, quantitySold);

      // Tequila: 1000 fl oz = 29573.5 ml / 750 = 39.43 bottles
      expect(round(tequilaResult.purchaseUnitDeduction, 1)).toBeCloseTo(39.4, 0);
      
      // Triple Sec: 375 fl oz = 11090 ml / 750 = 14.79 bottles
      expect(round(tripleSecResult.purchaseUnitDeduction, 1)).toBeCloseTo(14.8, 0);
      
      // Lime: 500 fl oz = 14787 ml / 3785.41 = 3.9 jugs
      expect(round(limeResult.purchaseUnitDeduction, 1)).toBeCloseTo(3.9, 0);

      // Total pour cost
      const totalCost = 
        tequilaResult.purchaseUnitDeduction * tequila.costPerUnit +
        tripleSecResult.purchaseUnitDeduction * tripleSec.costPerUnit +
        limeResult.purchaseUnitDeduction * limeJuice.costPerUnit;

      // ~$39.43 × $45 + ~$14.79 × $35 + ~$3.9 × $12.50 = $2342
      expect(round(totalCost, 0)).toBeCloseTo(2342, -1);
    });
  });

  describe('Wine Service', () => {
    it('calculates by-the-glass pours from standard bottles', () => {
      // Standard: 5 fl oz pour, 750ml bottle
      const ingredient = createIngredient({
        recipeQuantity: 5,
        recipeUnit: 'fl oz',
        productName: 'House Cabernet',
        sizeValue: 750,
        sizeUnit: 'ml',
        costPerUnit: 12.00,
      });

      const result = calculateDeduction(ingredient, 25);

      // 125 fl oz = 3696.69 ml
      // 3696.69 / 750 = 4.93 bottles
      // Standard 750ml bottle = ~5 glasses
      expect(result.success).toBe(true);
      expect(round(result.purchaseUnitDeduction, 1)).toBeCloseTo(4.9, 0);
    });

    it('calculates from magnum bottles (1.5L)', () => {
      const ingredient = createIngredient({
        recipeQuantity: 5,
        recipeUnit: 'fl oz',
        productName: 'Premium Pinot',
        sizeValue: 1500,
        sizeUnit: 'ml',
        costPerUnit: 45.00,
      });

      const result = calculateDeduction(ingredient, 20);

      // 100 fl oz = 2957.35 ml
      // 2957.35 / 1500 = 1.97 magnums
      expect(round(result.purchaseUnitDeduction, 2)).toBeCloseTo(1.97, 1);
    });
  });
});

// ===== SCENARIO 2: KITCHEN OPERATIONS =====

describe('Scenario: Kitchen Operations', () => {
  describe('Protein Portioning', () => {
    it('calculates chicken breast portions from case', () => {
      // Recipe: 8 oz chicken breast
      // Package: 40 lb case @ $89.99
      const ingredient = createIngredient({
        recipeQuantity: 8,
        recipeUnit: 'oz',
        productName: 'Chicken Breast',
        purchaseUnit: 'case',
        sizeValue: 40,
        sizeUnit: 'lb',
        costPerUnit: 89.99,
      });

      const result = calculateDeduction(ingredient, 150);

      // 1200 oz × 28.3495 g = 34019.4 g
      // 40 lb × 453.592 g = 18143.68 g
      // 34019.4 / 18143.68 = 1.875 cases
      expect(result.success).toBe(true);
      expect(result.conversionMethod).toBe('weight_to_weight');
      expect(round(result.purchaseUnitDeduction, 2)).toBeCloseTo(1.87, 1);
    });

    it('calculates steak portions from prime rib', () => {
      // Recipe: 16 oz ribeye
      // Package: 10 lb primal @ $149.99
      const ingredient = createIngredient({
        recipeQuantity: 16,
        recipeUnit: 'oz',
        productName: 'Prime Ribeye',
        purchaseUnit: 'primal',
        sizeValue: 10,
        sizeUnit: 'lb',
        costPerUnit: 149.99,
      });

      const result = calculateDeduction(ingredient, 50);

      // 800 oz = 22679.6 g
      // 10 lb = 4535.92 g
      // 22679.6 / 4535.92 = 5 primals
      expect(round(result.purchaseUnitDeduction, 1)).toBeCloseTo(5.0, 0);
    });

    it('calculates seafood by the gram', () => {
      // Recipe: 150g salmon fillet
      // Package: 5 kg box @ $125.00
      const ingredient = createIngredient({
        recipeQuantity: 150,
        recipeUnit: 'g',
        productName: 'Atlantic Salmon',
        purchaseUnit: 'box',
        sizeValue: 5,
        sizeUnit: 'kg',
        costPerUnit: 125.00,
      });

      const result = calculateDeduction(ingredient, 80);

      // 12000 g / 5000 g = 2.4 boxes
      expect(round(result.purchaseUnitDeduction, 1)).toBeCloseTo(2.4, 0);
    });
  });

  describe('Bakery Operations - Density Conversions', () => {
    it('calculates flour from cups to pounds (50lb bag)', () => {
      // Recipe: 2 cups all-purpose flour
      // Package: 50 lb bag @ $24.99
      const ingredient = createIngredient({
        recipeQuantity: 2,
        recipeUnit: 'cup',
        productName: 'All-Purpose Flour',
        purchaseUnit: 'bag',
        sizeValue: 50,
        sizeUnit: 'lb',
        costPerUnit: 24.99,
      });

      const result = calculateDeduction(ingredient, 100);

      // Flour density: 120 g/cup
      // 200 cups × 120 g = 24000 g
      // 50 lb × 453.592 g = 22679.6 g
      // 24000 / 22679.6 = 1.058 bags
      expect(result.success).toBe(true);
      expect(result.conversionMethod).toBe('density_to_weight');
      expect(round(result.purchaseUnitDeduction, 2)).toBeCloseTo(1.06, 1);
    });

    it('calculates sugar from cups to 25lb bag', () => {
      // Recipe: 1.5 cups sugar
      // Package: 25 lb bag @ $18.99
      const ingredient = createIngredient({
        recipeQuantity: 1.5,
        recipeUnit: 'cup',
        productName: 'Granulated Sugar',
        purchaseUnit: 'bag',
        sizeValue: 25,
        sizeUnit: 'lb',
        costPerUnit: 18.99,
      });

      const result = calculateDeduction(ingredient, 50);

      // Sugar density: 200 g/cup
      // 75 cups × 200 g = 15000 g
      // 25 lb × 453.592 g = 11339.8 g
      // 15000 / 11339.8 = 1.323 bags
      expect(round(result.purchaseUnitDeduction, 2)).toBeCloseTo(1.32, 1);
    });

    it('calculates butter from cups to pound blocks', () => {
      // Recipe: 0.5 cup (1 stick) butter
      // Package: 1 lb block @ $5.99
      const ingredient = createIngredient({
        recipeQuantity: 0.5,
        recipeUnit: 'cup',
        productName: 'Unsalted Butter',
        purchaseUnit: 'block',
        sizeValue: 1,
        sizeUnit: 'lb',
        costPerUnit: 5.99,
      });

      const result = calculateDeduction(ingredient, 20);

      // Butter density: 227 g/cup
      // 10 cups × 227 g = 2270 g
      // 1 lb × 453.592 g = 453.592 g
      // 2270 / 453.592 = 5.00 blocks
      expect(round(result.purchaseUnitDeduction, 1)).toBeCloseTo(5.0, 0);
    });

    it('calculates rice from cups to 50lb bag', () => {
      // Recipe: 1 cup jasmine rice
      // Package: 50 lb bag @ $42.99
      const ingredient = createIngredient({
        recipeQuantity: 1,
        recipeUnit: 'cup',
        productName: 'Jasmine Rice',
        purchaseUnit: 'bag',
        sizeValue: 50,
        sizeUnit: 'lb',
        costPerUnit: 42.99,
      });

      const result = calculateDeduction(ingredient, 200);

      // Rice density: 185 g/cup
      // 200 cups × 185 g = 37000 g
      // 50 lb × 453.592 g = 22679.6 g
      // 37000 / 22679.6 = 1.632 bags
      expect(round(result.purchaseUnitDeduction, 2)).toBeCloseTo(1.63, 1);
    });
  });

  describe('Sauce Production', () => {
    it('calculates cream for batch of alfredo', () => {
      // Recipe: 1 cup heavy cream per serving
      // Package: 1 quart container @ $6.99
      const ingredient = createIngredient({
        recipeQuantity: 1,
        recipeUnit: 'cup',
        productName: 'Heavy Cream',
        purchaseUnit: 'container',
        sizeValue: 1,
        sizeUnit: 'qt',
        costPerUnit: 6.99,
      });

      const result = calculateDeduction(ingredient, 30);

      // 30 cups × 236.588 ml = 7097.64 ml
      // 1 qt = 946.353 ml
      // 7097.64 / 946.353 = 7.5 containers
      expect(result.success).toBe(true);
      expect(round(result.purchaseUnitDeduction, 1)).toBeCloseTo(7.5, 0);
    });

    it('calculates olive oil from teaspoons to gallon', () => {
      // Recipe: 2 tsp olive oil per dish
      // Package: 1 gallon tin @ $35.00
      const ingredient = createIngredient({
        recipeQuantity: 2,
        recipeUnit: 'tsp',
        productName: 'Extra Virgin Olive Oil',
        purchaseUnit: 'tin',
        sizeValue: 1,
        sizeUnit: 'gal',
        costPerUnit: 35.00,
      });

      const result = calculateDeduction(ingredient, 500);

      // 1000 tsp × 4.92892 ml = 4928.92 ml
      // 1 gal = 3785.41 ml
      // 4928.92 / 3785.41 = 1.302 tins
      expect(round(result.purchaseUnitDeduction, 2)).toBeCloseTo(1.30, 1);
    });
  });
});

// ===== SCENARIO 3: EDGE CASES & BOUNDARY CONDITIONS =====

describe('Scenario: Edge Cases', () => {
  describe('Very Small Quantities (Spices & Seasonings)', () => {
    it('handles 1/8 teaspoon measurements', () => {
      const ingredient = createIngredient({
        recipeQuantity: 0.125, // 1/8 tsp
        recipeUnit: 'tsp',
        productName: 'Vanilla Extract',
        sizeValue: 4,
        sizeUnit: 'fl oz',
        costPerUnit: 12.99,
      });

      const result = calculateDeduction(ingredient, 1000);

      // 125 tsp × 4.92892 ml = 616.115 ml
      // 4 fl oz × 29.5735 ml = 118.294 ml
      // 616.115 / 118.294 = 5.21 bottles
      expect(result.success).toBe(true);
      expect(round(result.purchaseUnitDeduction, 2)).toBeCloseTo(5.21, 1);
    });

    it('handles tablespoon of minced garlic from jar', () => {
      const ingredient = createIngredient({
        recipeQuantity: 0.5,
        recipeUnit: 'tbsp',
        productName: 'Minced Garlic',
        sizeValue: 32,
        sizeUnit: 'fl oz',
        costPerUnit: 8.99,
      });

      const result = calculateDeduction(ingredient, 200);

      // 100 tbsp × 14.7868 ml = 1478.68 ml
      // 32 fl oz × 29.5735 ml = 946.352 ml
      // 1478.68 / 946.352 = 1.56 jars
      expect(round(result.purchaseUnitDeduction, 2)).toBeCloseTo(1.56, 1);
    });
  });

  describe('Very Large Quantities (Catering)', () => {
    it('handles 1000-person event chicken order', () => {
      const ingredient = createIngredient({
        recipeQuantity: 6, // 6 oz portion
        recipeUnit: 'oz',
        productName: 'Chicken Breast',
        purchaseUnit: 'case',
        sizeValue: 40,
        sizeUnit: 'lb',
        costPerUnit: 89.99,
      });

      const result = calculateDeduction(ingredient, 1000);

      // 6000 oz × 28.3495 g = 170097 g
      // 40 lb × 453.592 g = 18143.68 g
      // 170097 / 18143.68 = 9.375 cases
      expect(result.success).toBe(true);
      expect(round(result.purchaseUnitDeduction, 2)).toBeCloseTo(9.38, 1);
    });

    it('handles high-volume pizza dough production', () => {
      const ingredient = createIngredient({
        recipeQuantity: 3,
        recipeUnit: 'cup',
        productName: 'All-Purpose Flour',
        purchaseUnit: 'pallet',
        sizeValue: 2000, // 2000 lb pallet
        sizeUnit: 'lb',
        costPerUnit: 800.00,
      });

      const result = calculateDeduction(ingredient, 500);

      // 1500 cups × 120 g = 180000 g
      // 2000 lb × 453.592 g = 907184 g
      // 180000 / 907184 = 0.198 pallets
      expect(round(result.purchaseUnitDeduction, 3)).toBeCloseTo(0.198, 2);
    });
  });

  describe('Zero and Near-Zero Values', () => {
    it('handles zero quantity sold gracefully', () => {
      const ingredient = createIngredient({
        recipeQuantity: 2,
        recipeUnit: 'fl oz',
        productName: 'Vodka',
        sizeValue: 750,
        sizeUnit: 'ml',
      });

      const result = calculateDeduction(ingredient, 0);

      // Zero sales should produce zero deduction
      // The conversion method depends on implementation
      expect(result.purchaseUnitDeduction).toBe(0);
    });

    it('handles zero recipe quantity', () => {
      const ingredient = createIngredient({
        recipeQuantity: 0,
        recipeUnit: 'oz',
        sizeValue: 750,
        sizeUnit: 'ml',
      });

      const result = calculateDeduction(ingredient, 100);

      expect(result.purchaseUnitDeduction).toBe(0);
    });
  });

  describe('Null and Missing Values', () => {
    it('falls back when sizeValue is null', () => {
      const ingredient = createIngredient({
        recipeQuantity: 2,
        recipeUnit: 'oz',
        sizeValue: null,
        sizeUnit: 'ml',
      });

      const result = calculateDeduction(ingredient, 10);

      expect(result.success).toBe(false);
      expect(result.conversionMethod).toBe('fallback_1:1');
      expect(result.purchaseUnitDeduction).toBe(20); // 2 × 10
    });

    it('falls back when sizeUnit is null', () => {
      const ingredient = createIngredient({
        recipeQuantity: 2,
        recipeUnit: 'oz',
        sizeValue: 750,
        sizeUnit: null,
      });

      const result = calculateDeduction(ingredient, 10);

      expect(result.success).toBe(false);
      expect(result.conversionMethod).toBe('fallback_1:1');
    });

    it('falls back when sizeValue is zero', () => {
      const ingredient = createIngredient({
        recipeQuantity: 2,
        recipeUnit: 'oz',
        sizeValue: 0,
        sizeUnit: 'ml',
      });

      const result = calculateDeduction(ingredient, 10);

      expect(result.success).toBe(false);
      expect(result.conversionMethod).toBe('fallback_1:1');
    });
  });

  describe('Incompatible Unit Types', () => {
    it('falls back for volume recipe to weight package without density', () => {
      // Salt: no density mapping
      const ingredient = createIngredient({
        recipeQuantity: 1,
        recipeUnit: 'tsp',
        productName: 'Kosher Salt',
        sizeValue: 3,
        sizeUnit: 'lb',
        costPerUnit: 4.99,
      });

      const result = calculateDeduction(ingredient, 100);

      expect(result.success).toBe(false);
      expect(result.conversionMethod).toBe('fallback_1:1');
      expect(result.warning).toBeDefined();
    });

    it('falls back for weight recipe to volume package', () => {
      const ingredient = createIngredient({
        recipeQuantity: 100,
        recipeUnit: 'g',
        productName: 'Honey',
        sizeValue: 500,
        sizeUnit: 'ml',
        costPerUnit: 12.99,
      });

      const result = calculateDeduction(ingredient, 50);

      expect(result.success).toBe(false);
      expect(result.conversionMethod).toBe('fallback_1:1');
    });

    it('falls back for unrecognized units', () => {
      const ingredient = createIngredient({
        recipeQuantity: 1,
        recipeUnit: 'bunch', // Not recognized
        productName: 'Fresh Parsley',
        sizeValue: 12,
        sizeUnit: 'ea', // Not recognized
        costPerUnit: 2.50,
      });

      const result = calculateDeduction(ingredient, 30);

      expect(result.success).toBe(false);
      expect(result.purchaseUnitDeduction).toBe(30); // 1 × 30
    });
  });

  describe('Matching Units (1:1)', () => {
    it('handles direct unit match', () => {
      const ingredient = createIngredient({
        recipeQuantity: 2,
        recipeUnit: 'each',
        productName: 'Eggs',
        purchaseUnit: 'each',
        sizeValue: null,
        sizeUnit: null,
        costPerUnit: 0.25,
      });

      const result = calculateDeduction(ingredient, 100);

      expect(result.success).toBe(true);
      expect(result.conversionMethod).toBe('1:1');
      expect(result.purchaseUnitDeduction).toBe(200);
    });

    it('handles case-insensitive unit matching', () => {
      const ingredient = createIngredient({
        recipeQuantity: 1,
        recipeUnit: 'EACH',
        productName: 'Avocados',
        purchaseUnit: 'each',
        sizeValue: null,
        sizeUnit: null,
        costPerUnit: 1.50,
      });

      const result = calculateDeduction(ingredient, 50);

      expect(result.success).toBe(true);
      expect(result.conversionMethod).toBe('1:1');
    });
  });
});

// ===== SCENARIO 4: COST CALCULATIONS =====

describe('Scenario: Cost Accuracy', () => {
  describe('Pour Cost Calculations', () => {
    it('calculates accurate pour cost for premium liquor', () => {
      // Grey Goose: $32.99 for 750ml
      // Recipe: 2 fl oz per martini
      const ingredient = createIngredient({
        recipeQuantity: 2,
        recipeUnit: 'fl oz',
        productName: 'Grey Goose',
        sizeValue: 750,
        sizeUnit: 'ml',
        costPerUnit: 32.99,
      });

      const result = calculateDeduction(ingredient, 1);

      // 750ml bottle = 25.36 fl oz
      // Cost per fl oz = $32.99 / 25.36 = $1.30
      // 2 oz pour cost = $2.60
      const totalCost = calculateTotalCost(
        ingredient.recipeQuantity,
        1,
        result.costPerRecipeUnit
      );

      expect(round(totalCost, 2)).toBeCloseTo(2.60, 1);
    });

    it('calculates food cost for burger patty', () => {
      // Ground beef: $89.99 for 40lb case
      // Recipe: 6 oz patty
      const ingredient = createIngredient({
        recipeQuantity: 6,
        recipeUnit: 'oz',
        productName: 'Ground Beef 80/20',
        sizeValue: 40,
        sizeUnit: 'lb',
        costPerUnit: 89.99,
      });

      const result = calculateDeduction(ingredient, 1);

      // 40 lb = 640 oz
      // Cost per oz = $89.99 / 640 = $0.1406
      // 6 oz patty = $0.84
      const totalCost = calculateTotalCost(
        ingredient.recipeQuantity,
        1,
        result.costPerRecipeUnit
      );

      expect(round(totalCost, 2)).toBeCloseTo(0.84, 1);
    });
  });

  describe('Batch Cost Validation', () => {
    it('validates total batch cost for soup production', () => {
      // Batch of cream of mushroom: 5 gallons
      // Heavy cream: 2 quarts @ $6.99/qt
      const cream = createIngredient({
        recipeQuantity: 2,
        recipeUnit: 'qt',
        productName: 'Heavy Cream',
        sizeValue: 1,
        sizeUnit: 'qt',
        costPerUnit: 6.99,
      });

      // Mushrooms: 3 lb @ $5.99/lb
      const mushrooms = createIngredient({
        recipeQuantity: 3,
        recipeUnit: 'lb',
        productName: 'Cremini Mushrooms',
        sizeValue: 1,
        sizeUnit: 'lb',
        costPerUnit: 5.99,
      });

      const creamResult = calculateDeduction(cream, 1);
      const mushroomResult = calculateDeduction(mushrooms, 1);

      const creamCost = creamResult.purchaseUnitDeduction * cream.costPerUnit;
      const mushroomCost = mushroomResult.purchaseUnitDeduction * mushrooms.costPerUnit;

      // Cream: 2 × $6.99 = $13.98
      expect(round(creamCost, 2)).toBeCloseTo(13.98, 1);
      
      // Mushrooms: 3 × $5.99 = $17.97
      expect(round(mushroomCost, 2)).toBeCloseTo(17.97, 1);

      // Total: $31.95
      expect(round(creamCost + mushroomCost, 2)).toBeCloseTo(31.95, 1);
    });
  });

  describe('Fractional Costs', () => {
    it('handles costs with many decimal places', () => {
      const ingredient = createIngredient({
        recipeQuantity: 0.333333,
        recipeUnit: 'cup',
        productName: 'All-Purpose Flour',
        sizeValue: 50,
        sizeUnit: 'lb',
        costPerUnit: 24.99,
      });

      const result = calculateDeduction(ingredient, 1);

      expect(result.success).toBe(true);
      expect(result.purchaseUnitDeduction).toBeGreaterThan(0);
      expect(result.costPerRecipeUnit).toBeGreaterThan(0);
    });
  });
});

// ===== SCENARIO 5: REFERENCE ID GENERATION =====

describe('Scenario: Reference ID Generation', () => {
  it('generates consistent IDs for same input', () => {
    const id1 = generateReferenceId('Burger', '2024-01-15', 'ORD123');
    const id2 = generateReferenceId('Burger', '2024-01-15', 'ORD123');

    expect(id1).toBe(id2);
  });

  it('generates different IDs for different orders', () => {
    const id1 = generateReferenceId('Burger', '2024-01-15', 'ORD123');
    const id2 = generateReferenceId('Burger', '2024-01-15', 'ORD124');

    expect(id1).not.toBe(id2);
  });

  it('generates different IDs for different dates', () => {
    const id1 = generateReferenceId('Burger', '2024-01-15', 'ORD123');
    const id2 = generateReferenceId('Burger', '2024-01-16', 'ORD123');

    expect(id1).not.toBe(id2);
  });

  it('handles null external order ID', () => {
    const id1 = generateReferenceId('Burger', '2024-01-15', null);
    const id2 = generateReferenceId('Burger', '2024-01-15', null);

    expect(id1).toBe(id2);
    expect(id1).not.toContain('null');
  });

  it('handles undefined external order ID', () => {
    const id = generateReferenceId('Burger', '2024-01-15', undefined);

    expect(id).toBe('Burger_2024-01-15');
  });

  it('handles special characters in item name', () => {
    const id = generateReferenceId("Chef's Special (8oz)", '2024-01-15', 'ORD123');

    expect(id).toContain("Chef's Special (8oz)");
    expect(id).toContain('ORD123');
  });
});

// ===== SCENARIO 6: MATHEMATICAL CONSISTENCY =====

describe('Scenario: Mathematical Consistency', () => {
  describe('Inverse Conversions', () => {
    it('validates ml → l → ml round trip', () => {
      const mlValue = 1500;
      const liters = mlValue / VOLUME_UNITS['l'];
      const backToMl = liters * VOLUME_UNITS['l'];

      expect(backToMl).toBe(mlValue);
    });

    it('validates oz → lb → oz round trip', () => {
      const ozValue = 32;
      const inGrams = ozValue * WEIGHT_UNITS['oz'];
      const toLbs = inGrams / WEIGHT_UNITS['lb'];
      const backToOz = toLbs * (WEIGHT_UNITS['lb'] / WEIGHT_UNITS['oz']);

      expect(round(backToOz, 2)).toBeCloseTo(32, 0);
    });
  });

  describe('Volume Equivalencies', () => {
    it('validates 1 gallon = 4 quarts', () => {
      const galInMl = VOLUME_UNITS['gal'];
      const qtInMl = VOLUME_UNITS['qt'];

      expect(round(galInMl / qtInMl, 1)).toBeCloseTo(4, 0);
    });

    it('validates 1 cup = 16 tablespoons', () => {
      const cupInMl = VOLUME_UNITS['cup'];
      const tbspInMl = VOLUME_UNITS['tbsp'];

      expect(round(cupInMl / tbspInMl, 0)).toBeCloseTo(16, 0);
    });

    it('validates 1 tablespoon = 3 teaspoons', () => {
      const tbspInMl = VOLUME_UNITS['tbsp'];
      const tspInMl = VOLUME_UNITS['tsp'];

      expect(round(tbspInMl / tspInMl, 0)).toBeCloseTo(3, 0);
    });

    it('validates 1 liter = 33.814 fl oz', () => {
      const literInMl = VOLUME_UNITS['l'];
      const flozInMl = VOLUME_UNITS['fl oz'];

      expect(round(literInMl / flozInMl, 1)).toBeCloseTo(33.8, 0);
    });
  });

  describe('Weight Equivalencies', () => {
    it('validates 1 pound = 16 ounces', () => {
      const lbInG = WEIGHT_UNITS['lb'];
      const ozInG = WEIGHT_UNITS['oz'];

      expect(round(lbInG / ozInG, 0)).toBeCloseTo(16, 0);
    });

    it('validates 1 kilogram = 2.205 pounds', () => {
      const kgInG = WEIGHT_UNITS['kg'];
      const lbInG = WEIGHT_UNITS['lb'];

      expect(round(kgInG / lbInG, 2)).toBeCloseTo(2.20, 1);
    });
  });

  describe('Scaling Linearity', () => {
    it('validates double quantity = double deduction', () => {
      const ingredient = createIngredient({
        recipeQuantity: 2,
        recipeUnit: 'oz',
        sizeValue: 750,
        sizeUnit: 'ml',
      });

      const result10 = calculateDeduction(ingredient, 10);
      const result20 = calculateDeduction(ingredient, 20);

      expect(round(result20.purchaseUnitDeduction / result10.purchaseUnitDeduction, 1))
        .toBeCloseTo(2, 0);
    });

    it('validates half quantity = half deduction', () => {
      const ingredient = createIngredient({
        recipeQuantity: 4,
        recipeUnit: 'oz',
        sizeValue: 750,
        sizeUnit: 'ml',
      });

      const result100 = calculateDeduction(ingredient, 100);
      const result50 = calculateDeduction(ingredient, 50);

      expect(round(result50.purchaseUnitDeduction / result100.purchaseUnitDeduction, 1))
        .toBeCloseTo(0.5, 1);
    });
  });
});

// ===== SCENARIO 7: REAL-WORLD INVENTORY RECONCILIATION =====

describe('Scenario: Inventory Reconciliation', () => {
  describe('End of Week Validation', () => {
    it('validates week of vodka usage matches sales', () => {
      // Week sales: Mon-Sun cocktail count
      const dailySales = [25, 30, 45, 55, 120, 150, 80]; // Total: 505 cocktails
      const totalSales = dailySales.reduce((a, b) => a + b, 0);

      const ingredient = createIngredient({
        recipeQuantity: 1.5, // 1.5 oz per cocktail
        recipeUnit: 'fl oz',
        productName: 'House Vodka',
        sizeValue: 750,
        sizeUnit: 'ml',
        costPerUnit: 15.99,
      });

      const result = calculateDeduction(ingredient, totalSales);

      // 757.5 fl oz × 29.5735 = 22406.45 ml
      // 22406.45 / 750 = 29.875 bottles
      expect(result.success).toBe(true);
      expect(round(result.purchaseUnitDeduction, 0)).toBeCloseTo(30, 0);

      // Starting inventory: 35 bottles
      // Expected ending: 35 - 30 = 5 bottles
      const startingInventory = 35;
      const expectedEnding = startingInventory - result.purchaseUnitDeduction;
      expect(round(expectedEnding, 0)).toBeCloseTo(5, 0);
    });
  });

  describe('Waste Factor Validation', () => {
    it('includes waste factor in calculations', () => {
      // Real-world: account for 5% spillage/waste
      const wasteFactor = 1.05;

      const ingredient = createIngredient({
        recipeQuantity: 2,
        recipeUnit: 'fl oz',
        productName: 'Premium Tequila',
        sizeValue: 750,
        sizeUnit: 'ml',
        costPerUnit: 45.00,
      });

      const theoreticalResult = calculateDeduction(ingredient, 100);
      const withWaste = theoreticalResult.purchaseUnitDeduction * wasteFactor;

      // Theoretical: 7.886 bottles
      // With waste: 7.886 × 1.05 = 8.28 bottles
      expect(round(withWaste, 2)).toBeCloseTo(8.28, 1);
    });
  });
});

// ===== SCENARIO 8: MULTI-LOCATION VALIDATION =====

describe('Scenario: Multi-Location Consistency', () => {
  it('produces same results regardless of batch size', () => {
    const ingredient = createIngredient({
      recipeQuantity: 1.5,
      recipeUnit: 'fl oz',
      productName: 'House Vodka',
      sizeValue: 750,
      sizeUnit: 'ml',
      costPerUnit: 15.99,
    });

    // Location A: Processes all 100 sales at once
    const batchResult = calculateDeduction(ingredient, 100);

    // Location B: Processes 10 batches of 10
    let incrementalTotal = 0;
    for (let i = 0; i < 10; i++) {
      const partialResult = calculateDeduction(ingredient, 10);
      incrementalTotal += partialResult.purchaseUnitDeduction;
    }

    // Results should be identical
    expect(round(incrementalTotal, 4)).toBeCloseTo(
      round(batchResult.purchaseUnitDeduction, 4),
      4
    );
  });
});
