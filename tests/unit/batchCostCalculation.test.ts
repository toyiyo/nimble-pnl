import { describe, it, expect } from 'vitest';
import { calculateIngredientsCost, type IngredientInfo } from '@/lib/prepCostCalculation';
import type { IngredientUnit } from '@/lib/recipeUnits';

/**
 * Batch Cost Calculation Tests
 * 
 * These tests verify that the batch system correctly calculates costs
 * using the shared prepCostCalculation module.
 * 
 * The batch system was previously broken because it multiplied quantity × cost_per_unit
 * without doing any unit conversion. Now it uses the same logic as recipes.
 * 
 * See: BATCH_FUNCTIONALITY_AUDIT.md for background
 */
describe('Batch Cost Calculation Integration', () => {
  describe('Volume-to-Container Conversions', () => {
    it('should calculate cost with unit conversion for fl oz → bottle', () => {
      const ingredients: IngredientInfo[] = [
        {
          product_id: 'vodka-123',
          quantity: 1.5,
          unit: 'fl oz',
          product: {
            id: 'vodka-123',
            name: 'Vodka',
            cost_per_unit: 20,
            uom_purchase: 'bottle',
            size_value: 750,
            size_unit: 'ml',
            current_stock: 10,
          },
        },
      ];

      const result = calculateIngredientsCost(ingredients);

      // Should use conversion, not direct multiplication
      expect(result.totalCost).toBeCloseTo(1.18, 2);
      expect(result.totalCost).not.toBe(30); // Would be 1.5 * $20 without conversion
    });
  });

  describe('Count-to-Container Conversions', () => {
    it('should calculate cost with count-to-container conversion for each → bag', () => {
      const ingredients: IngredientInfo[] = [
        {
          product_id: 'tortilla-789',
          quantity: 2,
          unit: 'each',
          product: {
            id: 'tortilla-789',
            name: 'Tortillas',
            cost_per_unit: 10,
            uom_purchase: 'bag',
            size_value: 50,
            size_unit: 'each',
            current_stock: 5,
          },
        },
      ];

      const result = calculateIngredientsCost(ingredients);

      // Should use count-to-container conversion
      expect(result.totalCost).toBeCloseTo(0.40, 2);
      expect(result.totalCost).not.toBe(20); // Would be 2 * $10 without conversion
    });
  });

  describe('Multi-Ingredient Batches', () => {
    it('should handle multiple ingredients with mixed conversion types', () => {
      const ingredients: IngredientInfo[] = [
        {
          product_id: 'vodka-123',
          quantity: 1.5,
          unit: 'fl oz',
          product: {
            id: 'vodka-123',
            name: 'Vodka',
            cost_per_unit: 20,
            uom_purchase: 'bottle',
            size_value: 750,
            size_unit: 'ml',
            current_stock: 10,
          },
        },
        {
          product_id: 'tortilla-789',
          quantity: 2,
          unit: 'each',
          product: {
            id: 'tortilla-789',
            name: 'Tortillas',
            cost_per_unit: 10,
            uom_purchase: 'bag',
            size_value: 50,
            size_unit: 'each',
            current_stock: 5,
          },
        },
      ];

      const result = calculateIngredientsCost(ingredients);

      // Total should be sum of both conversions: $1.18 + $0.40 = $1.58
      expect(result.totalCost).toBeCloseTo(1.58, 2);
    });
  });

  describe('Error Handling', () => {
    it('should return zero for empty ingredients', () => {
      const result = calculateIngredientsCost([]);

      expect(result.totalCost).toBe(0);
      expect(result.ingredients).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should handle ingredients without products gracefully', () => {
      const ingredients: IngredientInfo[] = [
        {
          product_id: 'missing-product',
          quantity: 1,
          unit: 'each',
          product: undefined,
        },
      ];

      const result = calculateIngredientsCost(ingredients);

      // Should handle gracefully and return 0 cost
      expect(result.totalCost).toBe(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('CRITICAL: Prevents Previous Bug', () => {
    it('should NOT multiply quantity directly by cost_per_unit without conversion', () => {
      // This test documents the previous bug to prevent regression
      const ingredients: IngredientInfo[] = [
        {
          product_id: 'vodka-123',
          quantity: 1.5,
          unit: 'fl oz',
          product: {
            id: 'vodka-123',
            name: 'Vodka',
            cost_per_unit: 20,
            uom_purchase: 'bottle',
            size_value: 750,
            size_unit: 'ml',
            current_stock: 10,
          },
        },
      ];

      const result = calculateIngredientsCost(ingredients);

      // CRITICAL: Old buggy calculation would have been: 1.5 × $20 = $30.00 ❌
      const buggyCalculation = 1.5 * 20;
      expect(result.totalCost).not.toBe(buggyCalculation);
      expect(result.totalCost).toBeLessThan(buggyCalculation);

      // CORRECT CALCULATION: (1.5 fl oz / 750ml bottle) × $20 = $1.18 ✅
      expect(result.totalCost).toBeCloseTo(1.18, 2);
    });
  });
});
