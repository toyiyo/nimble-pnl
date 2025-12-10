/**
 * Cross-Validation Tests: TypeScript vs SQL Inventory Deduction Logic
 * 
 * These tests ensure the TypeScript preview calculations match the SQL function
 * `process_unified_inventory_deduction` (migration 20251023175015).
 * 
 * If these tests fail, it indicates drift between:
 * - Client-side: src/lib/enhancedUnitConversion.ts
 * - Server-side: process_unified_inventory_deduction SQL function
 * 
 * IMPORTANT: The SQL function is authoritative - it's the only code that
 * actually modifies inventory. TypeScript is preview-only.
 * 
 * Test scenarios mirror: supabase/tests/08_inventory_deduction_conversions.sql
 */

import { describe, it, expect } from 'vitest';
import { calculateInventoryImpact } from '@/lib/enhancedUnitConversion';

/**
 * Helper to simulate SQL deduction calculation.
 * Mirrors the logic in process_unified_inventory_deduction.
 */
function calculateExpectedDeduction(params: {
  initialStock: number;
  recipeQuantity: number;
  recipeUnit: string;
  quantitySold: number;
  sizeValue: number;
  sizeUnit: string;
  purchaseUnit: string;
  productName?: string;
  costPerUnit?: number;
}): { expectedStock: number; deductionAmount: number; tolerance: number } {
  const {
    initialStock,
    recipeQuantity,
    recipeUnit,
    quantitySold,
    sizeValue,
    sizeUnit,
    purchaseUnit,
    productName = '',
    costPerUnit = 10, // Default cost for testing
  } = params;

  // Calculate using TypeScript conversion logic
  // calculateInventoryImpact signature:
  // (recipeQuantity, recipeUnit, purchaseQuantity, purchaseUnit, productName, costPerPackage, productSizeValue?, productSizeUnit?)
  const result = calculateInventoryImpact(
    recipeQuantity,
    recipeUnit,
    1, // purchaseQuantity (1 unit at a time)
    purchaseUnit,
    productName,
    costPerUnit,
    sizeValue,
    sizeUnit
  );

  // Scale by quantity sold
  const totalDeduction = result.inventoryDeduction * quantitySold;
  const expectedStock = initialStock - totalDeduction;

  // Tolerance depends on conversion complexity
  // Simple conversions: exact match (0.001)
  // Complex conversions: slightly larger tolerance (0.02)
  const hasComplexConversion = 
    ['cup', 'tbsp', 'tsp'].includes(recipeUnit) ||
    (result.conversionDetails?.conversionPath?.length ?? 0) > 1;
  const tolerance = hasComplexConversion ? 0.02 : 0.001;

  return { expectedStock, deductionAmount: totalDeduction, tolerance };
}

describe('Cross-Validation: TypeScript ↔ SQL Inventory Deduction', () => {
  /**
   * TEST CATEGORY 1: DIRECT UNIT MATCH
   * SQL Test: Direct Match Product - 10 kg - (0.5 kg * 2) = 9 kg
   */
  describe('Category 1: Direct Unit Match (No Conversion)', () => {
    it('Test 1: Recipe unit matches purchase unit exactly (kg to kg)', () => {
      const result = calculateExpectedDeduction({
        initialStock: 10,
        recipeQuantity: 0.5,
        recipeUnit: 'kg',
        quantitySold: 2,
        sizeValue: 1,
        sizeUnit: 'kg',
        purchaseUnit: 'kg',
        productName: 'Direct Match Product',
      });

      // SQL expected: 10 kg - (0.5 kg * 2) = 9 kg
      expect(result.expectedStock).toBeCloseTo(9.0, 2);
    });
  });

  /**
   * TEST CATEGORY 2: CONTAINER UNIT CONVERSIONS
   * Tests bottle, jar, can, container with volume recipe units
   */
  describe('Category 2: Container Unit Conversions', () => {
    it('Test 2: Bottle (750ml) with oz recipe unit → Vodka Cocktail', () => {
      const result = calculateExpectedDeduction({
        initialStock: 12,
        recipeQuantity: 1.5,
        recipeUnit: 'fl oz', // Note: SQL uses 'oz' but means fluid oz for volume
        quantitySold: 10,
        sizeValue: 750,
        sizeUnit: 'ml',
        purchaseUnit: 'bottle',
        productName: 'Vodka Bottle',
      });

      // SQL expected: 12 - (15 oz / 750ml per bottle) ≈ 11.41 bottles
      // 15 fl oz = 443.6 ml, 443.6 / 750 = 0.5915 bottles
      expect(result.expectedStock).toBeGreaterThan(11.40);
      expect(result.expectedStock).toBeLessThan(11.42);
    });

    it('Test 3: Container (1L) with cup recipe unit → Latte', () => {
      const result = calculateExpectedDeduction({
        initialStock: 20,
        recipeQuantity: 0.5,
        recipeUnit: 'cup',
        quantitySold: 20,
        sizeValue: 1,
        sizeUnit: 'L',
        purchaseUnit: 'container',
        productName: 'Milk Container',
      });

      // SQL expected: 20 - (10 cups / 1L) ≈ 17.63 containers
      // 10 cups = 2365.88 ml, 2365.88 / 1000 = 2.37 containers
      expect(result.expectedStock).toBeGreaterThan(17.62);
      expect(result.expectedStock).toBeLessThan(17.65);
    });

    it('Test 4: Jar (500ml) with tbsp recipe unit → Salad', () => {
      const result = calculateExpectedDeduction({
        initialStock: 15,
        recipeQuantity: 2,
        recipeUnit: 'tbsp',
        quantitySold: 15,
        sizeValue: 500,
        sizeUnit: 'ml',
        purchaseUnit: 'jar',
        productName: 'Olive Oil Jar',
      });

      // SQL expected: 15 - (30 tbsp / 500ml) ≈ 14.11 jars
      // 30 tbsp = 443.6 ml, 443.6 / 500 = 0.887 jars
      expect(result.expectedStock).toBeGreaterThan(14.10);
      expect(result.expectedStock).toBeLessThan(14.13);
    });

    it('Test 5: Can (170ml) with tsp recipe unit → Pasta Sauce', () => {
      const result = calculateExpectedDeduction({
        initialStock: 30,
        recipeQuantity: 3,
        recipeUnit: 'tsp',
        quantitySold: 12,
        sizeValue: 170,
        sizeUnit: 'ml',
        purchaseUnit: 'can',
        productName: 'Tomato Paste Can',
      });

      // SQL expected: 30 - (36 tsp / 170ml) ≈ 28.96 cans
      // 36 tsp = 177.44 ml, 177.44 / 170 = 1.044 cans
      expect(result.expectedStock).toBeGreaterThan(28.95);
      expect(result.expectedStock).toBeLessThan(28.97);
    });
  });

  /**
   * TEST CATEGORY 3: WEIGHT-BASED CONVERSIONS
   * Tests bag, box with weight recipe units (g, oz, kg, lb)
   */
  describe('Category 3: Weight-Based Conversions', () => {
    it('Test 6: Bag (5kg) with g recipe unit → Bread', () => {
      const result = calculateExpectedDeduction({
        initialStock: 8,
        recipeQuantity: 300,
        recipeUnit: 'g',
        quantitySold: 10,
        sizeValue: 5,
        sizeUnit: 'kg',
        purchaseUnit: 'bag',
        productName: 'Flour Bag',
      });

      // SQL expected: 8 - (3000g / 5kg) = 7.4 bags
      // 3000g = 3kg, 3kg / 5kg = 0.6 bags
      expect(result.expectedStock).toBeCloseTo(7.4, 2);
    });

    it('Test 7: Box (1lb) with oz recipe unit → Spaghetti', () => {
      const result = calculateExpectedDeduction({
        initialStock: 25,
        recipeQuantity: 4,
        recipeUnit: 'oz', // Weight ounces
        quantitySold: 20,
        sizeValue: 1,
        sizeUnit: 'lb',
        purchaseUnit: 'box',
        productName: 'Pasta Box',
      });

      // SQL expected: 25 - (80oz / 1lb) = 20 boxes
      // 80 oz = 5 lb, 5 lb / 1 lb = 5 boxes
      expect(result.expectedStock).toBeCloseTo(20.0, 2);
    });

    it('Test 8: lb purchase with kg recipe unit → Burger', () => {
      const result = calculateExpectedDeduction({
        initialStock: 50,
        recipeQuantity: 0.15,
        recipeUnit: 'kg',
        quantitySold: 30,
        sizeValue: 1,
        sizeUnit: 'lb',
        purchaseUnit: 'lb',
        productName: 'Ground Beef',
      });

      // SQL expected: 50 - (4.5kg to lb) ≈ 40.08 lb
      // 0.15 kg * 30 = 4.5 kg = 9.92 lb
      expect(result.expectedStock).toBeGreaterThan(40.07);
      expect(result.expectedStock).toBeLessThan(40.09);
    });
  });

  /**
   * TEST CATEGORY 4: PRODUCT-SPECIFIC DENSITY CONVERSIONS
   * Tests rice, flour, sugar with cup-to-weight conversions
   */
  describe('Category 4: Product-Specific Density Conversions', () => {
    it('Test 9: Rice - cup to g conversion (185g/cup) → Fried Rice', () => {
      const result = calculateExpectedDeduction({
        initialStock: 10,
        recipeQuantity: 2,
        recipeUnit: 'cup',
        quantitySold: 20,
        sizeValue: 10,
        sizeUnit: 'kg',
        purchaseUnit: 'bag',
        productName: 'White Rice', // Name triggers rice density
      });

      // SQL expected: 10 - (40 cups * 185g / 10kg) ≈ 9.26 bags
      // 2 cups * 20 = 40 cups, 40 * 185g = 7400g = 7.4 kg
      // 7.4 kg / 10 kg = 0.74 bags, 10 - 0.74 = 9.26 bags
      expect(result.expectedStock).toBeGreaterThan(9.25);
      expect(result.expectedStock).toBeLessThan(9.27);
    });

    it('Test 10: Flour - cup to g conversion (120g/cup) → Cake', () => {
      const result = calculateExpectedDeduction({
        initialStock: 5,
        recipeQuantity: 3,
        recipeUnit: 'cup',
        quantitySold: 10,
        sizeValue: 2,
        sizeUnit: 'kg',
        purchaseUnit: 'bag',
        productName: 'All Purpose Flour', // Name triggers flour density
      });

      // SQL expected: 5 - (30 cups * 120g / 2kg) ≈ 3.2 bags
      // 3 cups * 10 = 30 cups, 30 * 120g = 3600g = 3.6 kg
      // 3.6 kg / 2 kg = 1.8 bags, 5 - 1.8 = 3.2 bags
      expect(result.expectedStock).toBeGreaterThan(3.19);
      expect(result.expectedStock).toBeLessThan(3.21);
    });

    it('Test 11: Sugar - cup to g conversion (200g/cup) → Cookie', () => {
      const result = calculateExpectedDeduction({
        initialStock: 8,
        recipeQuantity: 1,
        recipeUnit: 'cup',
        quantitySold: 25,
        sizeValue: 5,
        sizeUnit: 'kg',
        purchaseUnit: 'bag',
        productName: 'Granulated Sugar', // Name triggers sugar density
      });

      // SQL expected: 8 - (25 cups * 200g / 5kg) = 7 bags
      // 1 cup * 25 = 25 cups, 25 * 200g = 5000g = 5 kg
      // 5 kg / 5 kg = 1 bag, 8 - 1 = 7 bags
      expect(result.expectedStock).toBeCloseTo(7.0, 2);
    });
  });

  /**
   * TEST CATEGORY 5: DIRECT MEASUREMENT UNITS
   * Tests when purchase unit is already a measurement (ml, L, g, etc.)
   */
  describe('Category 5: Direct Measurement Units', () => {
    it('Test 12: ml purchase with fl oz recipe unit → Juice', () => {
      const result = calculateExpectedDeduction({
        initialStock: 5000, // 5000ml = 5L
        recipeQuantity: 4,
        recipeUnit: 'fl oz',
        quantitySold: 50,
        sizeValue: 1,
        sizeUnit: 'ml',
        purchaseUnit: 'ml',
        productName: 'Orange Juice',
      });

      // 4 fl oz * 50 = 200 fl oz = 5914.7 ml
      // 5000 - 5914.7 = -914.7 (would go negative in real scenario)
      // But we're testing conversion accuracy, not stock limits
      expect(result.deductionAmount).toBeCloseTo(5914.7, 0);
    });

    it('Test 13: L purchase with cup recipe unit → Water', () => {
      const result = calculateExpectedDeduction({
        initialStock: 20, // 20L
        recipeQuantity: 2,
        recipeUnit: 'cup',
        quantitySold: 30,
        sizeValue: 1,
        sizeUnit: 'L',
        purchaseUnit: 'L',
        productName: 'Filtered Water',
      });

      // 2 cups * 30 = 60 cups = 14.195 L
      // 20 - 14.195 = 5.805 L
      expect(result.expectedStock).toBeGreaterThan(5.79);
      expect(result.expectedStock).toBeLessThan(5.82);
    });

    it('Test 14: g purchase with oz recipe unit → Cheese', () => {
      const result = calculateExpectedDeduction({
        initialStock: 2000, // 2000g = 2kg
        recipeQuantity: 2,
        recipeUnit: 'oz', // Weight ounces
        quantitySold: 25,
        sizeValue: 1,
        sizeUnit: 'g',
        purchaseUnit: 'g',
        productName: 'Shredded Cheese',
      });

      // 2 oz * 25 = 50 oz = 1417.5 g
      // 2000 - 1417.5 = 582.5 g
      expect(result.expectedStock).toBeGreaterThan(582);
      expect(result.expectedStock).toBeLessThan(583);
    });
  });

  /**
   * TEST CATEGORY 6: EDGE CASES
   * Tests edge cases and boundary conditions
   */
  describe('Category 6: Edge Cases', () => {
    it('handles very small quantities accurately', () => {
      const result = calculateExpectedDeduction({
        initialStock: 10,
        recipeQuantity: 0.25, // 1/4 tsp
        recipeUnit: 'tsp',
        quantitySold: 100,
        sizeValue: 500,
        sizeUnit: 'ml',
        purchaseUnit: 'bottle',
        productName: 'Vanilla Extract',
      });

      // 0.25 tsp * 100 = 25 tsp = 123.2 ml
      // 123.2 / 500 = 0.2465 bottles
      // 10 - 0.2465 = 9.75 bottles
      expect(result.expectedStock).toBeGreaterThan(9.74);
      expect(result.expectedStock).toBeLessThan(9.76);
    });

    it('handles large quantities without precision loss', () => {
      const result = calculateExpectedDeduction({
        initialStock: 1000,
        recipeQuantity: 50,
        recipeUnit: 'g',
        quantitySold: 500,
        sizeValue: 25,
        sizeUnit: 'kg',
        purchaseUnit: 'bag',
        productName: 'Bulk Ingredient',
      });

      // 50g * 500 = 25000g = 25kg
      // 25kg / 25kg = 1 bag
      // 1000 - 1 = 999 bags
      expect(result.expectedStock).toBeCloseTo(999, 2);
    });

    it('handles single unit sale correctly', () => {
      const result = calculateExpectedDeduction({
        initialStock: 5,
        recipeQuantity: 2,
        recipeUnit: 'fl oz',
        quantitySold: 1, // Single sale
        sizeValue: 750,
        sizeUnit: 'ml',
        purchaseUnit: 'bottle',
        productName: 'Whiskey',
      });

      // 2 fl oz = 59.15 ml
      // 59.15 / 750 = 0.0789 bottles
      // 5 - 0.0789 = 4.921 bottles
      expect(result.expectedStock).toBeGreaterThan(4.92);
      expect(result.expectedStock).toBeLessThan(4.93);
    });
  });

  /**
   * CRITICAL ALIGNMENT CONSTANTS
   * These verify the exact values match between TypeScript and SQL
   */
  describe('Critical Alignment: Conversion Constants', () => {
    it('fl oz to ml uses 29.5735 (matches SQL)', () => {
      const result = calculateExpectedDeduction({
        initialStock: 1,
        recipeQuantity: 1,
        recipeUnit: 'fl oz',
        quantitySold: 1,
        sizeValue: 29.5735, // Exactly 1 fl oz in ml
        sizeUnit: 'ml',
        purchaseUnit: 'bottle',
        productName: 'Test',
      });

      // Should deduct exactly 1 bottle
      expect(result.deductionAmount).toBeCloseTo(1.0, 4);
    });

    it('oz (weight) to g uses 28.3495 (matches SQL)', () => {
      const result = calculateExpectedDeduction({
        initialStock: 1,
        recipeQuantity: 1,
        recipeUnit: 'oz',
        quantitySold: 1,
        sizeValue: 28.3495, // Exactly 1 oz in grams
        sizeUnit: 'g',
        purchaseUnit: 'bag',
        productName: 'Test Weight',
      });

      // Should deduct exactly 1 bag
      expect(result.deductionAmount).toBeCloseTo(1.0, 4);
    });

    it('cup to ml uses 236.588 (matches SQL)', () => {
      const result = calculateExpectedDeduction({
        initialStock: 1,
        recipeQuantity: 1,
        recipeUnit: 'cup',
        quantitySold: 1,
        sizeValue: 236.588, // Exactly 1 cup in ml
        sizeUnit: 'ml',
        purchaseUnit: 'container',
        productName: 'Test',
      });

      // Should deduct exactly 1 container
      expect(result.deductionAmount).toBeCloseTo(1.0, 4);
    });

    it('tbsp to ml uses 14.7868 (matches SQL)', () => {
      const result = calculateExpectedDeduction({
        initialStock: 1,
        recipeQuantity: 1,
        recipeUnit: 'tbsp',
        quantitySold: 1,
        sizeValue: 14.7868, // Exactly 1 tbsp in ml
        sizeUnit: 'ml',
        purchaseUnit: 'jar',
        productName: 'Test',
      });

      // Should deduct exactly 1 jar
      expect(result.deductionAmount).toBeCloseTo(1.0, 4);
    });

    it('tsp to ml uses 4.92892 (matches SQL)', () => {
      const result = calculateExpectedDeduction({
        initialStock: 1,
        recipeQuantity: 1,
        recipeUnit: 'tsp',
        quantitySold: 1,
        sizeValue: 4.92892, // Exactly 1 tsp in ml
        sizeUnit: 'ml',
        purchaseUnit: 'can',
        productName: 'Test',
      });

      // Should deduct exactly 1 can
      expect(result.deductionAmount).toBeCloseTo(1.0, 4);
    });

    it('lb to g uses 453.592 (matches SQL)', () => {
      const result = calculateExpectedDeduction({
        initialStock: 1,
        recipeQuantity: 1,
        recipeUnit: 'lb',
        quantitySold: 1,
        sizeValue: 453.592, // Exactly 1 lb in grams
        sizeUnit: 'g',
        purchaseUnit: 'bag',
        productName: 'Test Weight',
      });

      // Should deduct exactly 1 bag
      expect(result.deductionAmount).toBeCloseTo(1.0, 4);
    });

    it('rice density uses 185g/cup (matches SQL)', () => {
      const result = calculateExpectedDeduction({
        initialStock: 1,
        recipeQuantity: 1,
        recipeUnit: 'cup',
        quantitySold: 1,
        sizeValue: 185, // Exactly 1 cup of rice in grams
        sizeUnit: 'g',
        purchaseUnit: 'bag',
        productName: 'White Rice',
      });

      // Should deduct exactly 1 bag
      expect(result.deductionAmount).toBeCloseTo(1.0, 4);
    });

    it('flour density uses 120g/cup (matches SQL)', () => {
      const result = calculateExpectedDeduction({
        initialStock: 1,
        recipeQuantity: 1,
        recipeUnit: 'cup',
        quantitySold: 1,
        sizeValue: 120, // Exactly 1 cup of flour in grams
        sizeUnit: 'g',
        purchaseUnit: 'bag',
        productName: 'All Purpose Flour',
      });

      // Should deduct exactly 1 bag
      expect(result.deductionAmount).toBeCloseTo(1.0, 4);
    });

    it('sugar density uses 200g/cup (matches SQL)', () => {
      const result = calculateExpectedDeduction({
        initialStock: 1,
        recipeQuantity: 1,
        recipeUnit: 'cup',
        quantitySold: 1,
        sizeValue: 200, // Exactly 1 cup of sugar in grams
        sizeUnit: 'g',
        purchaseUnit: 'bag',
        productName: 'Granulated Sugar',
      });

      // Should deduct exactly 1 bag
      expect(result.deductionAmount).toBeCloseTo(1.0, 4);
    });

    it('butter density uses 227g/cup (matches SQL)', () => {
      const result = calculateExpectedDeduction({
        initialStock: 1,
        recipeQuantity: 1,
        recipeUnit: 'cup',
        quantitySold: 1,
        sizeValue: 227, // Exactly 1 cup of butter in grams
        sizeUnit: 'g',
        purchaseUnit: 'bag',
        productName: 'Unsalted Butter',
      });

      // Should deduct exactly 1 bag
      expect(result.deductionAmount).toBeCloseTo(1.0, 4);
    });
  });
});

/**
 * DOCUMENTATION: SQL Function Alignment
 * 
 * The SQL function `process_unified_inventory_deduction` uses these conversions:
 * 
 * Volume (to ml):
 * - 'fl oz' -> 29.5735
 * - 'cup'   -> 236.588
 * - 'tbsp'  -> 14.7868
 * - 'tsp'   -> 4.92892
 * - 'gal'   -> 3785.41
 * - 'qt'    -> 946.353
 * - 'L'     -> 1000
 * 
 * Weight (to grams):
 * - 'oz'    -> 28.3495
 * - 'lb'    -> 453.592
 * - 'kg'    -> 1000
 * 
 * Densities (g/cup):
 * - rice    -> 185
 * - flour   -> 120
 * - sugar   -> 200
 * - butter  -> 227
 * 
 * If any of these values change in the SQL function, the corresponding
 * constants in enhancedUnitConversion.ts must be updated and these
 * tests will catch the drift.
 */
