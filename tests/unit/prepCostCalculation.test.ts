import { describe, it, expect, beforeEach } from 'vitest';
import { 
  calculateIngredientCost, 
  calculateIngredientsCost,
  formatCostResult,
  type IngredientInfo,
  type ProductInfo 
} from '@/lib/prepCostCalculation';

describe('prepCostCalculation - Shared Cost Logic', () => {
  describe('calculateIngredientCost', () => {
    it('should calculate cost for volume-to-container conversion (fl oz to bottle)', () => {
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

      const result = calculateIngredientCost(ingredient);

      expect(result.productName).toBe('Vodka');
      expect(result.quantity).toBe(1.5);
      expect(result.unit).toBe('fl oz');
      expect(result.costPerUnit).toBe(20);
      expect(result.conversionApplied).toBe(true);
      
      // 1.5 fl oz = 44.36 ml
      // 44.36 ml / 750 ml = 0.0591 bottles
      // 0.0591 bottles × $20 = $1.18
      expect(result.inventoryDeduction).toBeCloseTo(0.0591, 3);
      expect(result.costImpact).toBeCloseTo(1.18, 2);
    });

    it('should calculate cost for weight-to-weight conversion (oz to lb)', () => {
      const ingredient: IngredientInfo = {
        product_id: 'pasta-456',
        quantity: 4,
        unit: 'oz',
        product: {
          id: 'pasta-456',
          name: 'Pasta',
          cost_per_unit: 5,
          uom_purchase: 'lb',
          size_value: 1,
          size_unit: 'lb',
        },
      };

      const result = calculateIngredientCost(ingredient);

      expect(result.productName).toBe('Pasta');
      expect(result.conversionApplied).toBe(true);
      
      // 4 oz = 0.25 lb
      // 0.25 lb × $5 = $1.25
      expect(result.inventoryDeduction).toBeCloseTo(0.25, 2);
      expect(result.costImpact).toBeCloseTo(1.25, 2);
    });

    it('should calculate cost for count-to-container (each to bag)', () => {
      const ingredient: IngredientInfo = {
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
        },
      };

      const result = calculateIngredientCost(ingredient);

      expect(result.productName).toBe('Tortillas');
      expect(result.conversionApplied).toBe(true);
      
      // 2 each / 50 per bag = 0.04 bags
      // 0.04 bags × $10 = $0.40
      expect(result.inventoryDeduction).toBeCloseTo(0.04, 2);
      expect(result.costImpact).toBeCloseTo(0.40, 2);
    });

    it('should handle 1:1 conversion when units match', () => {
      const ingredient: IngredientInfo = {
        product_id: 'sugar-101',
        quantity: 2,
        unit: 'kg',
        product: {
          id: 'sugar-101',
          name: 'Sugar',
          cost_per_unit: 8,
          uom_purchase: 'kg',
          size_value: 1,
          size_unit: 'kg',
        },
      };

      const result = calculateIngredientCost(ingredient);

      expect(result.productName).toBe('Sugar');
      expect(result.inventoryDeduction).toBe(2);
      expect(result.costImpact).toBe(16);
    });

    it('should return zero cost when product has no cost_per_unit', () => {
      const ingredient: IngredientInfo = {
        product_id: 'free-item',
        quantity: 5,
        unit: 'each',
        product: {
          id: 'free-item',
          name: 'Free Item',
          cost_per_unit: null,
          uom_purchase: 'each',
        },
      };

      const result = calculateIngredientCost(ingredient);

      expect(result.costImpact).toBe(0);
      expect(result.conversionApplied).toBe(false);
    });

    it('should handle density conversion (cup to kg for rice)', () => {
      const ingredient: IngredientInfo = {
        product_id: 'rice-202',
        quantity: 2,
        unit: 'cup',
        product: {
          id: 'rice-202',
          name: 'Rice',
          cost_per_unit: 15,
          uom_purchase: 'bag',
          size_value: 10,
          size_unit: 'kg',
        },
      };

      const result = calculateIngredientCost(ingredient);

      expect(result.productName).toBe('Rice');
      expect(result.conversionApplied).toBe(true);
      
      // 2 cups × 185g/cup = 370g = 0.37kg
      // 0.37kg / 10kg per bag = 0.037 bags
      // 0.037 bags × $15 per bag = $0.555
      expect(result.inventoryDeduction).toBeCloseTo(0.037, 3);
      expect(result.costImpact).toBeCloseTo(0.555, 2);
    });

    it('CRITICAL: should throw error when product is missing', () => {
      const ingredient: IngredientInfo = {
        product_id: 'missing',
        quantity: 1,
        unit: 'each',
        product: undefined,
      };

      expect(() => calculateIngredientCost(ingredient)).toThrow('Product not found');
    });
  });

  describe('calculateIngredientsCost', () => {
    it('should calculate total cost for multiple ingredients', () => {
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
      ];

      const result = calculateIngredientsCost(ingredients);

      expect(result.ingredients).toHaveLength(2);
      expect(result.warnings).toHaveLength(0);
      
      // Vodka: ~$1.18 + Lime: $0.25 = ~$1.43
      expect(result.totalCost).toBeCloseTo(1.43, 1);
    });

    it('should collect warnings for ingredients with errors', () => {
      const ingredients: IngredientInfo[] = [
        {
          product_id: 'good-product',
          quantity: 1,
          unit: 'each',
          product: {
            id: 'good-product',
            name: 'Good Product',
            cost_per_unit: 5,
            uom_purchase: 'each',
          },
        },
        {
          product_id: 'bad-product',
          quantity: 1,
          unit: 'each',
          product: undefined,
        },
      ];

      const result = calculateIngredientsCost(ingredients);

      expect(result.ingredients).toHaveLength(2);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Product not found');
      expect(result.totalCost).toBe(5); // Only good product counted
    });

    it('should handle empty ingredients array', () => {
      const result = calculateIngredientsCost([]);

      expect(result.totalCost).toBe(0);
      expect(result.ingredients).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('formatCostResult', () => {
    it('should format result with conversion', () => {
      const result = {
        productId: 'vodka-123',
        productName: 'Vodka',
        quantity: 1.5,
        unit: 'fl oz',
        costPerUnit: 20,
        inventoryDeduction: 0.0591,
        inventoryDeductionUnit: 'bottle',
        costImpact: 1.18,
        conversionApplied: true,
      };

      const formatted = formatCostResult(result);

      expect(formatted).toBe('Vodka: 1.5 fl oz (0.0591 bottle) = $1.18');
    });

    it('should format result without conversion', () => {
      const result = {
        productId: 'sugar-101',
        productName: 'Sugar',
        quantity: 2,
        unit: 'kg',
        costPerUnit: 8,
        inventoryDeduction: 2,
        inventoryDeductionUnit: 'kg',
        costImpact: 16,
        conversionApplied: false,
      };

      const formatted = formatCostResult(result);

      expect(formatted).toBe('Sugar: 2 kg = $16.00');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very small quantities without precision loss', () => {
      const ingredient: IngredientInfo = {
        product_id: 'spice',
        quantity: 0.125,
        unit: 'tsp',
        product: {
          id: 'spice',
          name: 'Expensive Spice',
          cost_per_unit: 50,
          uom_purchase: 'jar',
          size_value: 2,
          size_unit: 'fl oz',
        },
      };

      const result = calculateIngredientCost(ingredient);

      expect(result.costImpact).toBeGreaterThan(0);
      expect(result.costImpact).toBeLessThan(5);
    });

    it('should handle large quantities correctly', () => {
      const ingredient: IngredientInfo = {
        product_id: 'flour',
        quantity: 50,
        unit: 'cup',
        product: {
          id: 'flour',
          name: 'Flour',
          cost_per_unit: 25,
          uom_purchase: 'kg',
          size_value: 10,
          size_unit: 'kg',
        },
      };

      const result = calculateIngredientCost(ingredient);

      expect(result.costImpact).toBeGreaterThan(0);
      expect(result.inventoryDeduction).toBeGreaterThan(0);
    });
  });
});
