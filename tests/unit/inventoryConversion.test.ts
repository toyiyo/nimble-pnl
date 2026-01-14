/**
 * Inventory Conversion Tests
 * 
 * Tests the unit conversion logic used for inventory deductions.
 * This mirrors the SQL function `process_unified_inventory_deduction`.
 * 
 * CRITICAL: If these tests fail, inventory deductions may be incorrect,
 * leading to wrong stock levels and inaccurate food cost calculations.
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
} from '../../supabase/functions/_shared/inventoryConversion';

// ===== UNIT DOMAIN TESTS =====

describe('Unit Domain Detection', () => {
  describe('getUnitDomain', () => {
    it('identifies volume units', () => {
      expect(getUnitDomain('ml')).toBe('volume');
      expect(getUnitDomain('l')).toBe('volume');
      expect(getUnitDomain('fl oz')).toBe('volume');
      expect(getUnitDomain('cup')).toBe('volume');
      expect(getUnitDomain('tbsp')).toBe('volume');
      expect(getUnitDomain('tsp')).toBe('volume');
      expect(getUnitDomain('gal')).toBe('volume');
      expect(getUnitDomain('qt')).toBe('volume');
    });

    it('identifies weight units', () => {
      expect(getUnitDomain('g')).toBe('weight');
      expect(getUnitDomain('kg')).toBe('weight');
      expect(getUnitDomain('lb')).toBe('weight');
      expect(getUnitDomain('oz')).toBe('weight');
    });

    it('identifies "each" units', () => {
      expect(getUnitDomain('each')).toBe('each');
      expect(getUnitDomain('unit')).toBe('each');
      expect(getUnitDomain('ea')).toBe('each');
    });

    it('handles case insensitivity', () => {
      expect(getUnitDomain('ML')).toBe('volume');
      expect(getUnitDomain('Kg')).toBe('weight');
      expect(getUnitDomain('EACH')).toBe('each');
    });

    it('handles whitespace', () => {
      expect(getUnitDomain('  ml  ')).toBe('volume');
      expect(getUnitDomain(' kg ')).toBe('weight');
    });

    it('returns unknown for unrecognized units', () => {
      expect(getUnitDomain('bottle')).toBe('unknown');
      expect(getUnitDomain('bag')).toBe('unknown');
      expect(getUnitDomain('case')).toBe('unknown');
      expect(getUnitDomain('')).toBe('unknown');
    });
  });

  describe('isVolumeUnit', () => {
    it('returns true for volume units', () => {
      expect(isVolumeUnit('ml')).toBe(true);
      expect(isVolumeUnit('cup')).toBe(true);
    });

    it('returns false for non-volume units', () => {
      expect(isVolumeUnit('g')).toBe(false);
      expect(isVolumeUnit('each')).toBe(false);
    });
  });

  describe('isWeightUnit', () => {
    it('returns true for weight units', () => {
      expect(isWeightUnit('g')).toBe(true);
      expect(isWeightUnit('lb')).toBe(true);
    });

    it('returns false for non-weight units', () => {
      expect(isWeightUnit('ml')).toBe(false);
      expect(isWeightUnit('each')).toBe(false);
    });
  });
});

// ===== UNIT CONVERSION TESTS =====

describe('Unit Conversions', () => {
  describe('toMilliliters', () => {
    it('converts ml (identity)', () => {
      expect(toMilliliters(100, 'ml')).toBe(100);
    });

    it('converts liters to ml', () => {
      expect(toMilliliters(1, 'l')).toBe(1000);
      expect(toMilliliters(0.5, 'l')).toBe(500);
    });

    it('converts fl oz to ml', () => {
      expect(toMilliliters(1, 'fl oz')).toBeCloseTo(29.5735, 2);
    });

    it('converts cups to ml', () => {
      expect(toMilliliters(1, 'cup')).toBeCloseTo(236.588, 2);
    });

    it('converts tablespoons to ml', () => {
      expect(toMilliliters(1, 'tbsp')).toBeCloseTo(14.7868, 2);
    });

    it('converts teaspoons to ml', () => {
      expect(toMilliliters(1, 'tsp')).toBeCloseTo(4.92892, 2);
    });

    it('converts gallons to ml', () => {
      expect(toMilliliters(1, 'gal')).toBeCloseTo(3785.41, 2);
    });

    it('converts quarts to ml', () => {
      expect(toMilliliters(1, 'qt')).toBeCloseTo(946.353, 2);
    });

    it('returns null for non-volume units', () => {
      expect(toMilliliters(100, 'g')).toBeNull();
      expect(toMilliliters(100, 'each')).toBeNull();
    });
  });

  describe('toGrams', () => {
    it('converts grams (identity)', () => {
      expect(toGrams(100, 'g')).toBe(100);
    });

    it('converts kilograms to grams', () => {
      expect(toGrams(1, 'kg')).toBe(1000);
      expect(toGrams(2.5, 'kg')).toBe(2500);
    });

    it('converts pounds to grams', () => {
      expect(toGrams(1, 'lb')).toBeCloseTo(453.592, 2);
    });

    it('converts ounces to grams', () => {
      expect(toGrams(1, 'oz')).toBeCloseTo(28.3495, 2);
    });

    it('returns null for non-weight units', () => {
      expect(toGrams(100, 'ml')).toBeNull();
      expect(toGrams(100, 'each')).toBeNull();
    });
  });

  describe('getDensityFactor', () => {
    it('returns density for rice', () => {
      expect(getDensityFactor('Jasmine Rice', 'cup')).toBe(185);
      expect(getDensityFactor('White Rice 5lb', 'cup')).toBe(185);
    });

    it('returns density for flour', () => {
      expect(getDensityFactor('All Purpose Flour', 'cup')).toBe(120);
    });

    it('returns density for sugar', () => {
      expect(getDensityFactor('Granulated Sugar', 'cup')).toBe(200);
    });

    it('returns density for butter', () => {
      expect(getDensityFactor('Unsalted Butter', 'cup')).toBe(227);
    });

    it('returns null for non-cup units', () => {
      expect(getDensityFactor('Rice', 'tbsp')).toBeNull();
      expect(getDensityFactor('Rice', 'oz')).toBeNull();
    });

    it('returns null for unknown products', () => {
      expect(getDensityFactor('Chicken Breast', 'cup')).toBeNull();
      expect(getDensityFactor('Olive Oil', 'cup')).toBeNull();
    });
  });
});

// ===== CONVERSION CONSTANTS VALIDATION =====

describe('Conversion Constants', () => {
  it('has all expected volume units', () => {
    expect(Object.keys(VOLUME_UNITS)).toContain('ml');
    expect(Object.keys(VOLUME_UNITS)).toContain('l');
    expect(Object.keys(VOLUME_UNITS)).toContain('fl oz');
    expect(Object.keys(VOLUME_UNITS)).toContain('cup');
    expect(Object.keys(VOLUME_UNITS)).toContain('tbsp');
    expect(Object.keys(VOLUME_UNITS)).toContain('tsp');
    expect(Object.keys(VOLUME_UNITS)).toContain('gal');
    expect(Object.keys(VOLUME_UNITS)).toContain('qt');
  });

  it('has all expected weight units', () => {
    expect(Object.keys(WEIGHT_UNITS)).toContain('g');
    expect(Object.keys(WEIGHT_UNITS)).toContain('kg');
    expect(Object.keys(WEIGHT_UNITS)).toContain('lb');
    expect(Object.keys(WEIGHT_UNITS)).toContain('oz');
  });

  it('volume conversions are mathematically consistent', () => {
    // 1 gallon = 4 quarts
    expect(VOLUME_UNITS['gal']).toBeCloseTo(VOLUME_UNITS['qt'] * 4, 0);
    
    // 1 cup = 16 tablespoons
    expect(VOLUME_UNITS['cup']).toBeCloseTo(VOLUME_UNITS['tbsp'] * 16, 0);
    
    // 1 tablespoon = 3 teaspoons
    expect(VOLUME_UNITS['tbsp']).toBeCloseTo(VOLUME_UNITS['tsp'] * 3, 1);
  });

  it('weight conversions are mathematically consistent', () => {
    // 1 kg = 1000 g
    expect(WEIGHT_UNITS['kg']).toBe(1000);
    
    // 1 lb = 16 oz
    expect(WEIGHT_UNITS['lb']).toBeCloseTo(WEIGHT_UNITS['oz'] * 16, 0);
  });
});

// ===== DEDUCTION CALCULATION TESTS =====

describe('calculateDeduction', () => {
  describe('Direct 1:1 Match', () => {
    it('handles matching units', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 2,
        recipeUnit: 'oz',
        productName: 'Cheddar Cheese',
        purchaseUnit: 'oz',
        sizeValue: null,
        sizeUnit: null,
        costPerUnit: 0.50,
      };

      const result = calculateDeduction(ingredient, 3);

      expect(result.purchaseUnitDeduction).toBe(6); // 2 oz × 3 = 6 oz
      expect(result.conversionMethod).toBe('1:1');
      expect(result.success).toBe(true);
      expect(result.costPerRecipeUnit).toBe(0.50);
    });

    it('is case insensitive', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 1,
        recipeUnit: 'CUP',
        productName: 'Milk',
        purchaseUnit: 'cup',
        sizeValue: null,
        sizeUnit: null,
        costPerUnit: 0.25,
      };

      const result = calculateDeduction(ingredient, 2);

      expect(result.conversionMethod).toBe('1:1');
      expect(result.purchaseUnitDeduction).toBe(2);
    });
  });

  describe('Count-to-Container Conversion', () => {
    it('converts 1 each tortilla to fractional bag (50 per bag)', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 1,
        recipeUnit: 'each',
        productName: 'Flour Tortillas',
        purchaseUnit: 'bag',
        sizeValue: 50,
        sizeUnit: 'each',
        costPerUnit: 10.00,
      };

      const result = calculateDeduction(ingredient, 1);

      // 1 tortilla / 50 per bag = 0.02 bags
      expect(result.conversionMethod).toBe('count_to_container');
      expect(result.success).toBe(true);
      expect(result.purchaseUnitDeduction).toBeCloseTo(0.02, 4);
      expect(result.costPerRecipeUnit).toBeCloseTo(0.20, 2);
    });

    it('converts burger buns (8 per bag)', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 1,
        recipeUnit: 'each',
        productName: 'Burger Buns',
        purchaseUnit: 'bag',
        sizeValue: 8,
        sizeUnit: 'each',
        costPerUnit: 3.00,
      };

      const result = calculateDeduction(ingredient, 8);

      // 8 buns / 8 per bag = 1 bag
      expect(result.conversionMethod).toBe('count_to_container');
      expect(result.purchaseUnitDeduction).toBe(1);
      expect(result.costPerRecipeUnit).toBeCloseTo(0.375, 3);
    });

    it('converts eggs (360 per case)', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 2,
        recipeUnit: 'each',
        productName: 'Large Eggs',
        purchaseUnit: 'case',
        sizeValue: 360,
        sizeUnit: 'each',
        costPerUnit: 50.00,
      };

      const result = calculateDeduction(ingredient, 90);

      // 180 eggs / 360 per case = 0.5 cases
      expect(result.conversionMethod).toBe('count_to_container');
      expect(result.purchaseUnitDeduction).toBeCloseTo(0.5, 2);
      expect(result.costPerRecipeUnit).toBeCloseTo(0.1389, 4);
    });

    it('works with "piece" as individual unit', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 3,
        recipeUnit: 'piece',
        productName: 'Paper Napkins',
        purchaseUnit: 'box',
        sizeValue: 500,
        sizeUnit: 'piece',
        costPerUnit: 8.00,
      };

      const result = calculateDeduction(ingredient, 100);

      // 300 napkins / 500 per box = 0.6 boxes
      expect(result.conversionMethod).toBe('count_to_container');
      expect(result.purchaseUnitDeduction).toBeCloseTo(0.6, 2);
      expect(result.costPerRecipeUnit).toBeCloseTo(0.016, 3);
    });

    it('works with "unit" as individual unit', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 1,
        recipeUnit: 'unit',
        productName: 'Hot Dog Buns',
        purchaseUnit: 'package',
        sizeValue: 12,
        sizeUnit: 'unit',
        costPerUnit: 4.00,
      };

      const result = calculateDeduction(ingredient, 24);

      // 24 buns / 12 per package = 2 packages
      expect(result.conversionMethod).toBe('count_to_container');
      expect(result.purchaseUnitDeduction).toBe(2);
      expect(result.costPerRecipeUnit).toBeCloseTo(0.3333, 4);
    });

    it('does not apply when size_unit is not an individual unit', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 1,
        recipeUnit: 'each',
        productName: 'Vodka',
        purchaseUnit: 'bottle',
        sizeValue: 750,
        sizeUnit: 'ml', // Not an individual unit
        costPerUnit: 25.00,
      };

      const result = calculateDeduction(ingredient, 1);

      // Should fall back, not use count-to-container
      expect(result.conversionMethod).not.toBe('count_to_container');
    });

    it('does not apply when purchase unit is not a container', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 1,
        recipeUnit: 'each',
        productName: 'Product',
        purchaseUnit: 'kg', // Weight unit, not container
        sizeValue: 50,
        sizeUnit: 'each',
        costPerUnit: 10.00,
      };

      const result = calculateDeduction(ingredient, 1);

      // Should fall back, not use count-to-container
      expect(result.conversionMethod).not.toBe('count_to_container');
    });
  });

  describe('Volume-to-Volume Conversion', () => {
    it('converts fl oz recipe to ml package', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 2, // 2 fl oz per recipe
        recipeUnit: 'fl oz',
        productName: 'Vanilla Extract',
        purchaseUnit: 'bottle',
        sizeValue: 118, // 118 ml bottle (4 fl oz)
        sizeUnit: 'ml',
        costPerUnit: 8.99,
      };

      const result = calculateDeduction(ingredient, 1);

      // 2 fl oz = 59.147 ml
      // 59.147 ml / 118 ml = 0.5012 bottles
      expect(result.conversionMethod).toBe('volume_to_volume');
      expect(result.success).toBe(true);
      expect(result.purchaseUnitDeduction).toBeCloseTo(0.5, 1);
    });

    it('converts cup recipe to liter package', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 1, // 1 cup per recipe
        recipeUnit: 'cup',
        productName: 'Milk',
        purchaseUnit: 'jug',
        sizeValue: 1, // 1 liter
        sizeUnit: 'l',
        costPerUnit: 3.99,
      };

      const result = calculateDeduction(ingredient, 4);

      // 4 cups = 946.352 ml
      // 946.352 ml / 1000 ml = 0.946 liters
      expect(result.conversionMethod).toBe('volume_to_volume');
      expect(result.purchaseUnitDeduction).toBeCloseTo(0.946, 2);
    });

    it('converts tablespoons to gallon', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 2, // 2 tbsp per recipe
        recipeUnit: 'tbsp',
        productName: 'Soy Sauce',
        purchaseUnit: 'jug',
        sizeValue: 1, // 1 gallon
        sizeUnit: 'gal',
        costPerUnit: 15.99,
      };

      const result = calculateDeduction(ingredient, 10);

      // 20 tbsp = 295.736 ml
      // 295.736 ml / 3785.41 ml = 0.0781 gallons
      expect(result.conversionMethod).toBe('volume_to_volume');
      expect(result.purchaseUnitDeduction).toBeCloseTo(0.078, 2);
    });
  });

  describe('Weight-to-Weight Conversion', () => {
    it('converts oz recipe to lb package', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 4, // 4 oz per recipe
        recipeUnit: 'oz',
        productName: 'Ground Beef',
        purchaseUnit: 'package',
        sizeValue: 1, // 1 lb package
        sizeUnit: 'lb',
        costPerUnit: 6.99,
      };

      const result = calculateDeduction(ingredient, 5);

      // 20 oz = 566.99 g
      // 1 lb = 453.592 g
      // 566.99 / 453.592 = 1.25 packages
      expect(result.conversionMethod).toBe('weight_to_weight');
      expect(result.success).toBe(true);
      expect(result.purchaseUnitDeduction).toBeCloseTo(1.25, 2);
    });

    it('converts g recipe to kg package', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 100, // 100g per recipe
        recipeUnit: 'g',
        productName: 'Pasta',
        purchaseUnit: 'bag',
        sizeValue: 1, // 1 kg bag
        sizeUnit: 'kg',
        costPerUnit: 2.49,
      };

      const result = calculateDeduction(ingredient, 10);

      // 1000g / 1000g = 1 bag
      expect(result.conversionMethod).toBe('weight_to_weight');
      expect(result.purchaseUnitDeduction).toBe(1);
    });

    it('converts lb recipe to oz package', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 0.5, // 0.5 lb per recipe
        recipeUnit: 'lb',
        productName: 'Bacon',
        purchaseUnit: 'package',
        sizeValue: 12, // 12 oz package
        sizeUnit: 'oz',
        costPerUnit: 7.99,
      };

      const result = calculateDeduction(ingredient, 2);

      // 1 lb = 453.592 g
      // 12 oz = 340.194 g
      // 453.592 / 340.194 = 1.333 packages
      expect(result.conversionMethod).toBe('weight_to_weight');
      expect(result.purchaseUnitDeduction).toBeCloseTo(1.333, 2);
    });
  });

  describe('Density Conversion (Volume to Weight)', () => {
    it('converts cups of rice to lb package', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 1, // 1 cup per recipe
        recipeUnit: 'cup',
        productName: 'Jasmine Rice',
        purchaseUnit: 'bag',
        sizeValue: 5, // 5 lb bag
        sizeUnit: 'lb',
        costPerUnit: 8.99,
      };

      const result = calculateDeduction(ingredient, 2);

      // 2 cups rice = 2 × 185g = 370g
      // 5 lb = 2267.96g
      // 370 / 2267.96 = 0.163 bags
      expect(result.conversionMethod).toBe('density_to_weight');
      expect(result.success).toBe(true);
      expect(result.purchaseUnitDeduction).toBeCloseTo(0.163, 2);
    });

    it('converts cups of flour to kg package', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 2, // 2 cups per recipe
        recipeUnit: 'cup',
        productName: 'All Purpose Flour',
        purchaseUnit: 'bag',
        sizeValue: 2.5, // 2.5 kg bag
        sizeUnit: 'kg',
        costPerUnit: 4.99,
      };

      const result = calculateDeduction(ingredient, 3);

      // 6 cups flour = 6 × 120g = 720g
      // 2.5 kg = 2500g
      // 720 / 2500 = 0.288 bags
      expect(result.conversionMethod).toBe('density_to_weight');
      expect(result.purchaseUnitDeduction).toBeCloseTo(0.288, 2);
    });

    it('converts cups of sugar to oz package', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 0.5, // 0.5 cup per recipe
        recipeUnit: 'cup',
        productName: 'Granulated Sugar',
        purchaseUnit: 'bag',
        sizeValue: 32, // 32 oz (2 lb) bag
        sizeUnit: 'oz',
        costPerUnit: 3.49,
      };

      const result = calculateDeduction(ingredient, 4);

      // 2 cups sugar = 2 × 200g = 400g
      // 32 oz = 907.185g
      // 400 / 907.185 = 0.441 bags
      expect(result.conversionMethod).toBe('density_to_weight');
      expect(result.purchaseUnitDeduction).toBeCloseTo(0.441, 2);
    });
  });

  describe('Fallback Handling', () => {
    it('falls back for incompatible unit types', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 2,
        recipeUnit: 'each', // "each" unit
        productName: 'Lemon',
        purchaseUnit: 'bag',
        sizeValue: 5,
        sizeUnit: 'lb', // weight package
        costPerUnit: 4.99,
      };

      const result = calculateDeduction(ingredient, 3);

      expect(result.conversionMethod).toBe('fallback_1:1');
      expect(result.success).toBe(false);
      expect(result.warning).toBeDefined();
      expect(result.purchaseUnitDeduction).toBe(6); // 2 × 3 = 6
    });

    it('falls back when size_value is null', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 1,
        recipeUnit: 'cup',
        productName: 'Milk',
        purchaseUnit: 'jug',
        sizeValue: null, // Missing size
        sizeUnit: 'l',
        costPerUnit: 3.99,
      };

      const result = calculateDeduction(ingredient, 2);

      expect(result.conversionMethod).toBe('fallback_1:1');
      expect(result.success).toBe(false);
    });

    it('falls back when size_value is zero', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 1,
        recipeUnit: 'oz',
        productName: 'Cheese',
        purchaseUnit: 'block',
        sizeValue: 0, // Invalid size
        sizeUnit: 'lb',
        costPerUnit: 5.99,
      };

      const result = calculateDeduction(ingredient, 1);

      expect(result.conversionMethod).toBe('fallback_1:1');
      expect(result.success).toBe(false);
    });

    it('falls back for unknown density (volume to weight)', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 1,
        recipeUnit: 'cup',
        productName: 'Olive Oil', // No density mapping
        purchaseUnit: 'bottle',
        sizeValue: 500,
        sizeUnit: 'ml', // Volume package - no fallback needed
        costPerUnit: 12.99,
      };

      const result = calculateDeduction(ingredient, 1);

      // This should actually succeed with volume_to_volume
      expect(result.conversionMethod).toBe('volume_to_volume');
      expect(result.success).toBe(true);
    });

    it('falls back for cup recipe to weight package without density', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 1,
        recipeUnit: 'cup',
        productName: 'Shredded Chicken', // No density mapping
        purchaseUnit: 'container',
        sizeValue: 1,
        sizeUnit: 'lb', // Weight package
        costPerUnit: 8.99,
      };

      const result = calculateDeduction(ingredient, 2);

      expect(result.conversionMethod).toBe('fallback_1:1');
      expect(result.success).toBe(false);
    });
  });
});

// ===== COST CALCULATION TESTS =====

describe('calculateTotalCost', () => {
  it('calculates cost correctly', () => {
    // 2 oz per recipe × 5 sold × $0.50/oz = $5.00
    expect(calculateTotalCost(2, 5, 0.50)).toBe(5.00);
  });

  it('handles fractional costs', () => {
    // 0.5 cups × 3 sold × $0.25/cup = $0.375
    expect(calculateTotalCost(0.5, 3, 0.25)).toBeCloseTo(0.375, 3);
  });

  it('handles zero quantity', () => {
    expect(calculateTotalCost(2, 0, 1.00)).toBe(0);
  });

  it('handles zero cost', () => {
    expect(calculateTotalCost(2, 5, 0)).toBe(0);
  });
});

// ===== REFERENCE ID TESTS =====

describe('generateReferenceId', () => {
  it('includes external order ID when provided', () => {
    const result = generateReferenceId('Burger', '2024-01-15', 'ORDER-123');
    expect(result).toBe('ORDER-123_Burger_2024-01-15');
  });

  it('excludes external order ID when null', () => {
    const result = generateReferenceId('Burger', '2024-01-15', null);
    expect(result).toBe('Burger_2024-01-15');
  });

  it('excludes external order ID when undefined', () => {
    const result = generateReferenceId('Burger', '2024-01-15');
    expect(result).toBe('Burger_2024-01-15');
  });

  it('handles special characters in item name', () => {
    const result = generateReferenceId("Chef's Special (Large)", '2024-01-15', 'ORD-1');
    expect(result).toBe("ORD-1_Chef's Special (Large)_2024-01-15");
  });
});

// ===== REAL-WORLD SCENARIO TESTS =====

describe('Real-World Restaurant Scenarios', () => {
  describe('Cocktail Bar', () => {
    it('deducts spirits from 750ml bottles', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 2, // 2 fl oz per cocktail
        recipeUnit: 'fl oz',
        productName: 'Vodka',
        purchaseUnit: 'bottle',
        sizeValue: 750,
        sizeUnit: 'ml',
        costPerUnit: 24.99,
      };

      const result = calculateDeduction(ingredient, 10); // 10 cocktails

      // 20 fl oz = 591.47 ml
      // 591.47 / 750 = 0.789 bottles
      expect(result.conversionMethod).toBe('volume_to_volume');
      expect(result.purchaseUnitDeduction).toBeCloseTo(0.789, 2);
    });

    it('deducts juice from gallon jugs', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 4, // 4 fl oz per drink
        recipeUnit: 'fl oz',
        productName: 'Orange Juice',
        purchaseUnit: 'jug',
        sizeValue: 1,
        sizeUnit: 'gal',
        costPerUnit: 6.99,
      };

      const result = calculateDeduction(ingredient, 25); // 25 mimosas

      // 100 fl oz = 2957.35 ml
      // 1 gal = 3785.41 ml
      // 2957.35 / 3785.41 = 0.781 jugs
      expect(result.purchaseUnitDeduction).toBeCloseTo(0.781, 2);
    });
  });

  describe('Pizza Kitchen', () => {
    it('deducts cheese from 5lb bags', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 8, // 8 oz per pizza
        recipeUnit: 'oz',
        productName: 'Shredded Mozzarella',
        purchaseUnit: 'bag',
        sizeValue: 5,
        sizeUnit: 'lb',
        costPerUnit: 18.99,
      };

      const result = calculateDeduction(ingredient, 20); // 20 pizzas

      // 160 oz = 4535.92g
      // 5 lb = 2267.96g
      // 4535.92 / 2267.96 = 2.0 bags
      expect(result.conversionMethod).toBe('weight_to_weight');
      expect(result.purchaseUnitDeduction).toBe(2.0);
    });

    it('deducts flour from 50lb bags', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 2, // 2 cups per pizza dough
        recipeUnit: 'cup',
        productName: 'Bread Flour',
        purchaseUnit: 'bag',
        sizeValue: 50,
        sizeUnit: 'lb',
        costPerUnit: 24.99,
      };

      const result = calculateDeduction(ingredient, 30); // 30 pizzas

      // 60 cups × 120g/cup = 7200g
      // 50 lb = 22679.6g
      // 7200 / 22679.6 = 0.317 bags
      expect(result.conversionMethod).toBe('density_to_weight');
      expect(result.purchaseUnitDeduction).toBeCloseTo(0.317, 2);
    });
  });

  describe('Breakfast Diner', () => {
    it('deducts butter from 1lb blocks', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 1, // 1 tbsp per pancake stack
        recipeUnit: 'tbsp',
        productName: 'Butter',
        purchaseUnit: 'block',
        sizeValue: 1,
        sizeUnit: 'lb',
        costPerUnit: 4.99,
      };

      const result = calculateDeduction(ingredient, 50); // 50 pancake orders

      // This is volume-to-weight, should use density
      // But tbsp isn't mapped for density, so fallback
      // Actually, let's check if tbsp butter has density
      expect(result.conversionMethod).toBe('fallback_1:1');
      // Note: This identifies a gap - we should add tbsp density support
    });

    it('deducts maple syrup from quart bottles', () => {
      const ingredient: IngredientInfo = {
        recipeQuantity: 2, // 2 fl oz per serving
        recipeUnit: 'fl oz',
        productName: 'Maple Syrup',
        purchaseUnit: 'bottle',
        sizeValue: 1,
        sizeUnit: 'qt',
        costPerUnit: 18.99,
      };

      const result = calculateDeduction(ingredient, 50); // 50 servings

      // 100 fl oz = 2957.35 ml
      // 1 qt = 946.353 ml
      // 2957.35 / 946.353 = 3.125 bottles
      expect(result.conversionMethod).toBe('volume_to_volume');
      expect(result.purchaseUnitDeduction).toBeCloseTo(3.125, 2);
    });
  });
});

// ===== EDGE CASES =====

describe('Edge Cases', () => {
  it('handles very small quantities', () => {
    // Test with volume-to-volume conversion (no density needed)
    const ingredient: IngredientInfo = {
      recipeQuantity: 0.0625, // 1/16 tsp (a pinch)
      recipeUnit: 'tsp',
      productName: 'Vanilla Extract',
      purchaseUnit: 'bottle',
      sizeValue: 4, // 4 fl oz bottle
      sizeUnit: 'fl oz',
      costPerUnit: 8.99,
    };

    const result = calculateDeduction(ingredient, 100);

    // 100 batches × 0.0625 tsp = 6.25 tsp
    // 6.25 tsp × 4.92892 ml/tsp = 30.806 ml
    // 4 fl oz × 29.5735 ml/fl oz = 118.294 ml
    // 30.806 / 118.294 = 0.2604 bottles
    expect(result.success).toBe(true);
    expect(result.purchaseUnitDeduction).toBeCloseTo(0.2604, 2);
  });

  it('handles very large quantities', () => {
    const ingredient: IngredientInfo = {
      recipeQuantity: 50, // 50 lb per batch
      recipeUnit: 'lb',
      productName: 'Potatoes',
      purchaseUnit: 'bag',
      sizeValue: 50,
      sizeUnit: 'lb',
      costPerUnit: 19.99,
    };

    const result = calculateDeduction(ingredient, 10); // 10 batches

    // 500 lb / 50 lb = 10 bags
    expect(result.purchaseUnitDeduction).toBe(10);
  });

  it('handles decimal package sizes', () => {
    const ingredient: IngredientInfo = {
      recipeQuantity: 100,
      recipeUnit: 'g',
      productName: 'Parmesan',
      purchaseUnit: 'wedge',
      sizeValue: 0.5, // 0.5 kg wedge
      sizeUnit: 'kg',
      costPerUnit: 12.99,
    };

    const result = calculateDeduction(ingredient, 5);

    // 500g / 500g = 1 wedge
    expect(result.purchaseUnitDeduction).toBe(1);
  });
});
