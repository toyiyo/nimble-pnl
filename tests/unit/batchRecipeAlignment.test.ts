import { describe, it, expect } from 'vitest';
import { calculateIngredientsCost, type IngredientInfo } from '@/lib/prepCostCalculation';

/**
 * Critical Alignment Tests
 * 
 * These tests ensure that batch and recipe systems calculate identical costs
 * for the same ingredients. This is essential because:
 * 
 * 1. Batches create output products with costs derived from ingredients
 * 2. Recipes deduct from those same products
 * 3. If costs don't match, P&L reports will be incorrect
 * 
 * See: BATCH_FUNCTIONALITY_AUDIT.md for background
 */
describe('Batch ↔ Recipe Cost Alignment', () => {
  describe('Volume-to-Container Conversions', () => {
    it('should calculate same cost for fl oz → bottle (vodka example)', () => {
      const ingredient: IngredientInfo = {
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
        },
      };

      // This is what both batch AND recipe should calculate
      const result = calculateIngredientsCost([ingredient]);

      // 1.5 fl oz = 44.36ml
      // 44.36ml / 750ml = 0.0591 bottles
      // 0.0591 bottles × $20 = $1.18
      expect(result.totalCost).toBeCloseTo(1.18, 2);
      expect(result.warnings).toHaveLength(0);
    });

    it('should calculate same cost for ml → bottle', () => {
      const ingredient: IngredientInfo = {
        product_id: 'vodka-123',
        quantity: 100,
        unit: 'ml',
        product: {
          id: 'vodka-123',
          name: 'Vodka',
          cost_per_unit: 20,
          uom_purchase: 'bottle',
          size_value: 750,
          size_unit: 'ml',
        },
      };

      const result = calculateIngredientsCost([ingredient]);

      // 100ml / 750ml = 0.1333 bottles
      // 0.1333 bottles × $20 = $2.67
      expect(result.totalCost).toBeCloseTo(2.67, 2);
    });

    it('should calculate same cost for cup → L (container)', () => {
      const ingredient: IngredientInfo = {
        product_id: 'juice-456',
        quantity: 2,
        unit: 'cup',
        product: {
          id: 'juice-456',
          name: 'Orange Juice',
          cost_per_unit: 8,
          uom_purchase: 'container',
          size_value: 2,
          size_unit: 'L',
        },
      };

      const result = calculateIngredientsCost([ingredient]);

      // 2 cups = 473.176ml = 0.473L
      // 0.473L / 2L = 0.2365 containers
      // 0.2365 × $8 = $1.89
      expect(result.totalCost).toBeCloseTo(1.89, 2);
    });
  });

  describe('Weight-to-Weight Conversions', () => {
    it('should calculate same cost for oz → lb', () => {
      const ingredient: IngredientInfo = {
        product_id: 'pasta-789',
        quantity: 4,
        unit: 'oz',
        product: {
          id: 'pasta-789',
          name: 'Pasta',
          cost_per_unit: 5,
          uom_purchase: 'lb',
          size_value: 1,
          size_unit: 'lb',
        },
      };

      const result = calculateIngredientsCost([ingredient]);

      // 4 oz = 0.25 lb
      // 0.25 lb × $5 = $1.25
      expect(result.totalCost).toBeCloseTo(1.25, 2);
    });

    it('should calculate same cost for g → kg', () => {
      const ingredient: IngredientInfo = {
        product_id: 'sugar-101',
        quantity: 500,
        unit: 'g',
        product: {
          id: 'sugar-101',
          name: 'Sugar',
          cost_per_unit: 10,
          uom_purchase: 'kg',
          size_value: 1,
          size_unit: 'kg',
        },
      };

      const result = calculateIngredientsCost([ingredient]);

      // 500g = 0.5kg
      // 0.5kg × $10 = $5.00
      expect(result.totalCost).toBeCloseTo(5.00, 2);
    });
  });

  describe('Count-to-Container Conversions', () => {
    it('should calculate same cost for each → bag (tortilla example)', () => {
      const ingredient: IngredientInfo = {
        product_id: 'tortilla-202',
        quantity: 2,
        unit: 'each',
        product: {
          id: 'tortilla-202',
          name: 'Tortillas',
          cost_per_unit: 10,
          uom_purchase: 'bag',
          size_value: 50,
          size_unit: 'each',
        },
      };

      const result = calculateIngredientsCost([ingredient]);

      // 2 each / 50 per bag = 0.04 bags
      // 0.04 bags × $10 = $0.40
      expect(result.totalCost).toBeCloseTo(0.40, 2);
    });

    it('should calculate same cost for each → box (buns example)', () => {
      const ingredient: IngredientInfo = {
        product_id: 'buns-303',
        quantity: 6,
        unit: 'each',
        product: {
          id: 'buns-303',
          name: 'Hamburger Buns',
          cost_per_unit: 8,
          uom_purchase: 'box',
          size_value: 24,
          size_unit: 'each',
        },
      };

      const result = calculateIngredientsCost([ingredient]);

      // 6 each / 24 per box = 0.25 boxes
      // 0.25 boxes × $8 = $2.00
      expect(result.totalCost).toBeCloseTo(2.00, 2);
    });
  });

  describe('Density Conversions', () => {
    it('should calculate same cost for cup → kg (rice)', () => {
      const ingredient: IngredientInfo = {
        product_id: 'rice-404',
        quantity: 2,
        unit: 'cup',
        product: {
          id: 'rice-404',
          name: 'Rice',
          cost_per_unit: 15,
          uom_purchase: 'bag',
          size_value: 10,
          size_unit: 'kg',
        },
      };

      const result = calculateIngredientsCost([ingredient]);

      // 2 cups × 185g/cup = 370g = 0.37kg
      // 0.37kg / 10kg = 0.037 bags
      // 0.037 bags × $15 = $0.555
      expect(result.totalCost).toBeCloseTo(0.555, 2);
    });

    it('should calculate same cost for cup → lb (flour)', () => {
      const ingredient: IngredientInfo = {
        product_id: 'flour-505',
        quantity: 3,
        unit: 'cup',
        product: {
          id: 'flour-505',
          name: 'Flour',
          cost_per_unit: 12,
          uom_purchase: 'bag',
          size_value: 5,
          size_unit: 'lb',
        },
      };

      const result = calculateIngredientsCost([ingredient]);

      // 3 cups × 120g/cup = 360g = 0.7937 lb
      // 0.7937 lb / 5 lb = 0.1587 bags
      // 0.1587 bags × $12 = $1.90
      expect(result.totalCost).toBeCloseTo(1.90, 1);
    });
  });

  describe('Multi-Ingredient Recipes', () => {
    it('should calculate same total cost for complex recipe with multiple conversion types', () => {
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
          },
        },
        {
          product_id: 'lime-456',
          quantity: 0.5,
          unit: 'each',
          product: {
            id: 'lime-456',
            name: 'Lime',
            cost_per_unit: 0.50,
            uom_purchase: 'each',
            size_value: 1,
            size_unit: 'each',
          },
        },
        {
          product_id: 'sugar-789',
          quantity: 10,
          unit: 'g',
          product: {
            id: 'sugar-789',
            name: 'Sugar',
            cost_per_unit: 8,
            uom_purchase: 'kg',
            size_value: 1,
            size_unit: 'kg',
          },
        },
      ];

      const result = calculateIngredientsCost(ingredients);

      // Vodka: $1.18 (from volume conversion)
      // Lime: $0.25 (0.5 × $0.50)
      // Sugar: $0.08 (10g = 0.01kg × $8)
      // Total: $1.51
      expect(result.totalCost).toBeCloseTo(1.51, 2);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('CRITICAL: Regression Prevention', () => {
    it('should NEVER use direct multiplication without conversion', () => {
      // This test documents the previous bug to prevent regression
      const ingredient: IngredientInfo = {
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
        },
      };

      const result = calculateIngredientsCost([ingredient]);

      // OLD BUGGY CALCULATION: 1.5 × $20 = $30.00 ❌
      const buggyCalculation = 1.5 * 20;
      expect(result.totalCost).not.toBe(buggyCalculation);
      expect(result.totalCost).toBeLessThan(buggyCalculation);

      // CORRECT CALCULATION: (1.5 fl oz / 750ml) × $20 = $1.18 ✅
      expect(result.totalCost).toBeCloseTo(1.18, 2);
    });

    it('should handle all container units consistently', () => {
      const containerUnits = ['bottle', 'bag', 'box', 'can', 'jar', 'case', 'package', 'container'];

      containerUnits.forEach((containerUnit) => {
        const ingredient: IngredientInfo = {
          product_id: `test-${containerUnit}`,
          quantity: 100,
          unit: 'ml',
          product: {
            id: `test-${containerUnit}`,
            name: `Test ${containerUnit}`,
            cost_per_unit: 10,
            uom_purchase: containerUnit,
            size_value: 500,
            size_unit: 'ml',
          },
        };

        const result = calculateIngredientsCost([ingredient]);

        // 100ml / 500ml = 0.2 containers
        // 0.2 × $10 = $2.00
        expect(result.totalCost).toBeCloseTo(2.00, 2);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero quantity', () => {
      const ingredient: IngredientInfo = {
        product_id: 'vodka-123',
        quantity: 0,
        unit: 'fl oz',
        product: {
          id: 'vodka-123',
          name: 'Vodka',
          cost_per_unit: 20,
          uom_purchase: 'bottle',
          size_value: 750,
          size_unit: 'ml',
        },
      };

      const result = calculateIngredientsCost([ingredient]);
      expect(result.totalCost).toBe(0);
    });

    it('should handle very large quantities without overflow', () => {
      const ingredient: IngredientInfo = {
        product_id: 'water-999',
        quantity: 10000,
        unit: 'ml',
        product: {
          id: 'water-999',
          name: 'Water',
          cost_per_unit: 5,
          uom_purchase: 'bottle',
          size_value: 1000,
          size_unit: 'ml',
        },
      };

      const result = calculateIngredientsCost([ingredient]);
      
      // 10000ml / 1000ml = 10 bottles
      // 10 bottles × $5 = $50
      expect(result.totalCost).toBe(50);
    });

    it('should handle very small quantities with precision', () => {
      const ingredient: IngredientInfo = {
        product_id: 'spice-888',
        quantity: 0.125,
        unit: 'tsp',
        product: {
          id: 'spice-888',
          name: 'Expensive Spice',
          cost_per_unit: 100,
          uom_purchase: 'jar',
          size_value: 4,
          size_unit: 'fl oz',
        },
      };

      const result = calculateIngredientsCost([ingredient]);
      
      expect(result.totalCost).toBeGreaterThan(0);
      expect(result.totalCost).toBeLessThan(10);
    });
  });
});
