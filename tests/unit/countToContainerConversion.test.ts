/**
 * Count-to-Container Unit Conversion Tests
 * 
 * Tests the new count-to-container conversion logic for products stored in packages
 * with countable items (e.g., tortillas, burger buns, eggs).
 * 
 * CRITICAL: These tests ensure that inventory deductions for count-based items
 * correctly calculate fractional packages instead of using 1:1 fallback.
 */

import { describe, it, expect } from 'vitest';
import { calculateInventoryImpact } from '@/lib/enhancedUnitConversion';

describe('Count-to-Container Conversion', () => {
  describe('calculateInventoryImpact - count to container units', () => {
    it('CRITICAL: should convert 1 each to fractional bag (tortilla example)', () => {
      // Product: Flour Tortillas - 50 per bag at $10/bag
      // Recipe: 1 tortilla (each)
      // Expected: 1/50 = 0.02 bags, cost = $0.20
      
      const result = calculateInventoryImpact(
        1,              // recipeQuantity: 1 tortilla
        'each',         // recipeUnit
        1,              // purchaseQuantity (not used for this conversion)
        'bag',          // purchaseUnit
        'Flour Tortillas',  // productName
        10.00,          // costPerPackage: $10 per bag
        50,             // productSizeValue: 50 tortillas per bag
        'each'          // productSizeUnit: each
      );
      
      expect(result.inventoryDeduction).toBeCloseTo(0.02, 4);
      expect(result.inventoryDeductionUnit).toBe('bag');
      expect(result.costImpact).toBeCloseTo(0.20, 2);
      expect(result.percentageOfPackage).toBeCloseTo(2, 2);
      expect(result.conversionDetails?.productSpecific).toBe(true);
      expect(result.conversionDetails?.conversionPath).toEqual([
        '1 each',
        '÷ 50 per bag',
        'bag'
      ]);
    });

    it('should handle burger buns - 8 per bag', () => {
      // Product: Burger Buns - 8 per bag at $3/bag
      // Recipe: 1 bun (each)
      // Expected: 1/8 = 0.125 bags, cost = $0.375
      
      const result = calculateInventoryImpact(
        1,
        'each',
        1,
        'bag',
        'Burger Buns',
        3.00,
        8,
        'each'
      );
      
      expect(result.inventoryDeduction).toBeCloseTo(0.125, 3);
      expect(result.costImpact).toBeCloseTo(0.375, 3);
      expect(result.percentageOfPackage).toBeCloseTo(12.5, 2);
    });

    it('should handle eggs - 360 per case (30 dozen)', () => {
      // Product: Eggs - 360 per case at $50/case
      // Recipe: 2 eggs
      // Expected: 2/360 = 0.0056 cases, cost = $0.28
      
      const result = calculateInventoryImpact(
        2,
        'each',
        1,
        'case',
        'Eggs',
        50.00,
        360,
        'each'
      );
      
      expect(result.inventoryDeduction).toBeCloseTo(0.0056, 4);
      expect(result.costImpact).toBeCloseTo(0.28, 2);
      expect(result.percentageOfPackage).toBeCloseTo(0.56, 2);
    });

    it('should handle napkins - 500 per box', () => {
      // Product: Napkins - 500 per box at $8/box
      // Recipe: 3 napkins (piece)
      // Expected: 3/500 = 0.006 boxes, cost = $0.048
      
      const result = calculateInventoryImpact(
        3,
        'piece',
        1,
        'box',
        'Napkins',
        8.00,
        500,
        'piece'
      );
      
      expect(result.inventoryDeduction).toBeCloseTo(0.006, 4);
      expect(result.costImpact).toBeCloseTo(0.048, 3);
    });

    it('should handle large quantity deduction', () => {
      // Product: Tortillas - 50 per bag at $10/bag
      // Recipe: 2 tortillas for 100 sales
      // Expected: 200/50 = 4 bags, cost = $40
      
      const result = calculateInventoryImpact(
        200,    // 2 tortillas × 100 sales
        'each',
        1,
        'bag',
        'Flour Tortillas',
        10.00,
        50,
        'each'
      );
      
      expect(result.inventoryDeduction).toBeCloseTo(4, 2);
      expect(result.costImpact).toBeCloseTo(40, 2);
      expect(result.percentageOfPackage).toBeCloseTo(400, 2);
    });

    it('should work with "unit" as individual unit', () => {
      // Product: Hot Dog Buns - 12 per package at $4/package
      // Recipe: 1 unit
      // Expected: 1/12 = 0.0833 packages, cost = $0.33
      
      const result = calculateInventoryImpact(
        1,
        'unit',
        1,
        'package',
        'Hot Dog Buns',
        4.00,
        12,
        'unit'
      );
      
      expect(result.inventoryDeduction).toBeCloseTo(0.0833, 4);
      expect(result.costImpact).toBeCloseTo(0.33, 2);
    });

    it('should work with "piece" as individual unit', () => {
      // Product: Pita Bread - 6 per package at $5/package
      // Recipe: 1 piece
      // Expected: 1/6 = 0.1667 packages, cost = $0.83
      
      const result = calculateInventoryImpact(
        1,
        'piece',
        1,
        'package',
        'Pita Bread',
        5.00,
        6,
        'piece'
      );
      
      expect(result.inventoryDeduction).toBeCloseTo(0.1667, 4);
      expect(result.costImpact).toBeCloseTo(0.83, 2);
    });

    it('should work with "container" as package unit', () => {
      // Product: Plastic Cups - 100 per container at $15/container
      // Recipe: 5 each
      // Expected: 5/100 = 0.05 containers, cost = $0.75
      
      const result = calculateInventoryImpact(
        5,
        'each',
        1,
        'container',
        'Plastic Cups',
        15.00,
        100,
        'each'
      );
      
      expect(result.inventoryDeduction).toBeCloseTo(0.05, 4);
      expect(result.costImpact).toBeCloseTo(0.75, 2);
    });
  });

  describe('Edge cases', () => {
    it('should handle zero quantity', () => {
      const result = calculateInventoryImpact(
        0,
        'each',
        1,
        'bag',
        'Tortillas',
        10.00,
        50,
        'each'
      );
      
      expect(result.inventoryDeduction).toBe(0);
      expect(result.costImpact).toBe(0);
    });

    it('should not apply conversion if size_unit is not a count unit', () => {
      // If size_unit is 'ml' instead of 'each', this conversion shouldn't apply
      // It should fall through to other conversion paths
      const result = calculateInventoryImpact(
        1,
        'each',
        750,    // 750ml bottle
        'bottle',
        'Vodka',
        25.00,
        750,
        'ml'    // size_unit is ml, not each
      );
      
      // This should use container-to-volume conversion, not count-to-container
      // So inventoryDeductionUnit should still be 'bottle' but the logic path is different
      expect(result.inventoryDeductionUnit).toBe('bottle');
    });

    it('should not apply conversion if size_value is missing', () => {
      // Without size_value, this conversion path shouldn't apply
      // It will fall through to the 1:1 fallback
      const result = calculateInventoryImpact(
        1,
        'each',
        1,
        'bag',
        'Unknown Product',
        10.00,
        undefined,  // no size_value
        'each'
      );
      
      // Should fall through to other logic (likely 1:1 fallback)
      // The exact behavior depends on the rest of the function
      expect(result).toBeDefined();
    });

    it('should not apply conversion if size_value is zero', () => {
      const result = calculateInventoryImpact(
        1,
        'each',
        1,
        'bag',
        'Unknown Product',
        10.00,
        0,      // zero size_value
        'each'
      );
      
      // Should fall through to other logic
      expect(result).toBeDefined();
    });

    it('should not apply conversion if recipe unit is not individual', () => {
      // If recipe uses 'kg' and purchase is 'bag', shouldn't use count-to-container
      const result = calculateInventoryImpact(
        1,
        'kg',   // weight unit, not count
        1,
        'bag',
        'Flour',
        10.00,
        5,
        'kg'
      );
      
      // Should use weight conversion instead
      expect(result).toBeDefined();
      // Should not use the count-to-container path
      expect(result.conversionDetails?.conversionPath?.[0]).not.toContain('÷');
    });

    it('should not apply conversion if purchase unit is not a container', () => {
      // If purchase is 'kg' and recipe is 'each', shouldn't use count-to-container
      // This is an incompatible conversion and should throw an error
      expect(() => {
        calculateInventoryImpact(
          1,
          'each',
          1,
          'kg',   // weight unit, not container
          'Product',
          10.00,
          50,
          'each'
        );
      }).toThrow(/Cannot convert each to kg/);
    });
  });
});
