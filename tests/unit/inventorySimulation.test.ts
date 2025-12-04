import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateSaleImpact } from '@/utils/inventorySimulation';

// Mock the calculateInventoryImpact function to test the wrapper logic
vi.mock('@/lib/enhancedUnitConversion', async () => {
  const actual = await vi.importActual('@/lib/enhancedUnitConversion');
  return {
    ...actual,
    // Keep the actual implementation for testing
  };
});

describe('Inventory Simulation Utilities', () => {
  describe('calculateSaleImpact', () => {
    it('calculates impact for simple same-unit ingredients', () => {
      const ingredients = [
        {
          productName: 'Tequila',
          recipeQuantity: 2,
          recipeUnit: 'oz',
          purchaseQuantity: 25.36, // 750ml ≈ 25.36 oz
          purchaseUnit: 'oz',
          costPerUnit: 25,
          currentStock: 5,
        },
      ];

      const result = calculateSaleImpact(ingredients, 1);

      expect(result.ingredients).toHaveLength(1);
      expect(result.ingredients[0].productName).toBe('Tequila');
      expect(result.ingredients[0].deductionAmount).toBe(2);
      expect(result.ingredients[0].deductionUnit).toBe('oz');
      expect(result.ingredients[0].remainingStock).toBe(3);
      expect(result.totalCost).toBeGreaterThan(0);
    });

    it('scales deductions by quantity sold', () => {
      const ingredients = [
        {
          productName: 'Lime Juice',
          recipeQuantity: 1,
          recipeUnit: 'oz',
          purchaseQuantity: 32, // 32 oz bottle
          purchaseUnit: 'oz',
          costPerUnit: 8,
          currentStock: 10,
        },
      ];

      const result1 = calculateSaleImpact(ingredients, 1);
      const result5 = calculateSaleImpact(ingredients, 5);

      expect(result5.ingredients[0].deductionAmount).toBe(5);
      expect(result5.totalCost).toBe(result1.totalCost * 5);
    });

    it('detects low stock warnings', () => {
      const ingredients = [
        {
          productName: 'Premium Vodka',
          recipeQuantity: 2,
          recipeUnit: 'oz',
          purchaseQuantity: 25.36,
          purchaseUnit: 'oz',
          costPerUnit: 30,
          currentStock: 2.5, // Will go below 1 after deduction
        },
      ];

      const result = calculateSaleImpact(ingredients, 1);

      expect(result.ingredients[0].lowStockWarning).toBe(true);
      // Check that a warning exists for low stock
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w: string) => w.includes('Premium Vodka'))).toBe(true);
    });

    it('handles multiple ingredients', () => {
      const ingredients = [
        {
          productName: 'Tequila',
          recipeQuantity: 2,
          recipeUnit: 'oz',
          purchaseQuantity: 25.36,
          purchaseUnit: 'oz',
          costPerUnit: 25,
          currentStock: 10,
        },
        {
          productName: 'Triple Sec',
          recipeQuantity: 1,
          recipeUnit: 'oz',
          purchaseQuantity: 25.36,
          purchaseUnit: 'oz',
          costPerUnit: 15,
          currentStock: 8,
        },
        {
          productName: 'Lime Juice',
          recipeQuantity: 0.75,
          recipeUnit: 'oz',
          purchaseQuantity: 32,
          purchaseUnit: 'oz',
          costPerUnit: 8,
          currentStock: 20,
        },
      ];

      const result = calculateSaleImpact(ingredients, 2);

      expect(result.ingredients).toHaveLength(3);
      expect(result.ingredients[0].deductionAmount).toBe(4); // 2 oz * 2 sold
      expect(result.ingredients[1].deductionAmount).toBe(2); // 1 oz * 2 sold
      expect(result.ingredients[2].deductionAmount).toBe(1.5); // 0.75 oz * 2 sold
      expect(result.totalCost).toBeGreaterThan(0);
    });

    it('handles container units with size info using fl oz', () => {
      // Note: The enhancedUnitConversion only handles 'fl oz' for fluid ounces
      // Using 'fl oz' as recipe unit for liquor measurements
      const ingredients = [
        {
          productName: 'Maestro Dobel',
          recipeQuantity: 1.5,
          recipeUnit: 'fl oz', // Use 'fl oz' for fluid ounces
          purchaseQuantity: 1, // 1 bottle
          purchaseUnit: 'bottle',
          costPerUnit: 45,
          currentStock: 3,
          sizeValue: 750,
          sizeUnit: 'ml',
        },
      ];

      const result = calculateSaleImpact(ingredients, 1);

      expect(result.ingredients).toHaveLength(1);
      // 1.5 fl oz = 44.36ml, bottle is 750ml
      // So deduction should be 44.36/750 = 0.059 bottles
      expect(result.ingredients[0].deductionAmount).toBeCloseTo(0.059, 2);
      expect(result.ingredients[0].deductionUnit).toBe('bottle');
    });

    it('handles empty ingredients array', () => {
      const result = calculateSaleImpact([], 1);

      expect(result.ingredients).toHaveLength(0);
      expect(result.totalCost).toBe(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('handles zero quantity sold', () => {
      const ingredients = [
        {
          productName: 'Tequila',
          recipeQuantity: 2,
          recipeUnit: 'oz',
          purchaseQuantity: 25.36,
          purchaseUnit: 'oz',
          costPerUnit: 25,
          currentStock: 10,
        },
      ];

      const result = calculateSaleImpact(ingredients, 0);

      expect(result.ingredients[0].deductionAmount).toBe(0);
      expect(result.totalCost).toBe(0);
    });

    it('uses fallback for incompatible units', () => {
      // When recipe unit is 'oz' (weight) and purchase is 'bottle' (container)
      // without 'fl oz' handling, it should use fallback
      const ingredients = [
        {
          productName: 'Maestro Dobel',
          recipeQuantity: 1.5,
          recipeUnit: 'oz', // Weight oz, not handled for container conversion
          purchaseQuantity: 1,
          purchaseUnit: 'bottle',
          costPerUnit: 45,
          currentStock: 3,
          sizeValue: 750,
          sizeUnit: 'ml',
        },
      ];

      const result = calculateSaleImpact(ingredients, 1);

      // Should have a warning about fallback conversion
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('Integration: Bug fix scenario', () => {
    /**
     * This test validates that the client-side simulation matches
     * expected behavior for the Maestro Dobel scenario from the bug report.
     * Using 'fl oz' as that's what the conversion function expects.
     */
    it('correctly calculates impact for Maestro Dobel sale with fl oz', () => {
      const ingredients = [
        {
          productName: 'Maestro Dobel Tequila',
          recipeQuantity: 1.5, // 1.5 fl oz per shot
          recipeUnit: 'fl oz', // Use 'fl oz' for proper conversion
          purchaseQuantity: 1,
          purchaseUnit: 'bottle',
          costPerUnit: 45,
          currentStock: 5,
          sizeValue: 750,
          sizeUnit: 'ml',
        },
      ];

      // Simulate selling 88 shots (from the bug report screenshot)
      const result = calculateSaleImpact(ingredients, 88);

      expect(result.ingredients).toHaveLength(1);
      
      // 88 shots * 1.5 fl oz = 132 fl oz total
      // 132 fl oz * 29.5735 ml/fl oz = 3903.7 ml
      // 3903.7 ml / 750 ml/bottle = 5.2 bottles
      expect(result.ingredients[0].deductionAmount).toBeCloseTo(5.2, 1);
      
      // Remaining stock should be negative (sold more than available)
      expect(result.ingredients[0].remainingStock).toBeLessThan(0);
      expect(result.ingredients[0].lowStockWarning).toBe(true);
      
      // Total cost should be ~5.2 bottles * $45
      expect(result.totalCost).toBeCloseTo(234, 0);
    });

    it('handles recipe with no ingredients gracefully', () => {
      const result = calculateSaleImpact([], 10);
      
      expect(result.ingredients).toHaveLength(0);
      expect(result.totalCost).toBe(0);
      expect(result.warnings).toHaveLength(0);
    });
  });

  /**
   * DB ALIGNMENT TESTS
   * 
   * These tests verify that the client-side logic matches the database function
   * `process_unified_inventory_deduction` (migration 20251023175015).
   * 
   * The DB uses domain-driven conversion:
   * 1. Volume-to-Volume: fl oz, ml, l, cup, tbsp, tsp, gal, qt
   * 2. Weight-to-Weight: g, kg, lb, oz
   * 3. Density: cup/tsp/tbsp to weight (rice=185g/cup, flour=120g/cup, etc.)
   */
  describe('DB Alignment: process_unified_inventory_deduction', () => {
    
    describe('Case 1: Volume-to-Volume conversion', () => {
      it('converts fl oz recipe to ml product size', () => {
        // DB: recipe_unit=fl oz, size_unit=ml → volume_to_volume
        const ingredients = [
          {
            productName: 'Simple Syrup',
            recipeQuantity: 0.5, // 0.5 fl oz per drink
            recipeUnit: 'fl oz',
            purchaseQuantity: 1,
            purchaseUnit: 'bottle',
            costPerUnit: 12,
            currentStock: 10,
            sizeValue: 750,
            sizeUnit: 'ml',
          },
        ];

        const result = calculateSaleImpact(ingredients, 10);

        // 10 drinks * 0.5 fl oz = 5 fl oz
        // 5 fl oz * 29.5735 ml = 147.87 ml
        // 147.87 ml / 750 ml = 0.197 bottles
        expect(result.ingredients[0].deductionAmount).toBeCloseTo(0.197, 2);
        expect(result.ingredients[0].deductionUnit).toBe('bottle');
      });

      it('converts cup recipe to gallon product size', () => {
        // DB: recipe_unit=cup, size_unit=gal → volume_to_volume
        const ingredients = [
          {
            productName: 'Milk',
            recipeQuantity: 1, // 1 cup per recipe
            recipeUnit: 'cup',
            purchaseQuantity: 1,
            purchaseUnit: 'container',
            costPerUnit: 5,
            currentStock: 3,
            sizeValue: 1,
            sizeUnit: 'gal',
          },
        ];

        const result = calculateSaleImpact(ingredients, 16);

        // 16 recipes * 1 cup = 16 cups
        // 16 cups * 236.588 ml = 3785.41 ml = 1 gallon
        expect(result.ingredients[0].deductionAmount).toBeCloseTo(1.0, 1);
      });
    });

    describe('Case 2: Weight-to-Weight conversion', () => {
      it('converts oz (weight) recipe to lb product size', () => {
        // DB: recipe_unit=oz (weight), size_unit=lb → weight_to_weight
        const ingredients = [
          {
            productName: 'Ground Beef',
            recipeQuantity: 4, // 4 oz per burger
            recipeUnit: 'oz',
            purchaseQuantity: 1,
            purchaseUnit: 'bag',
            costPerUnit: 15,
            currentStock: 5,
            sizeValue: 5,
            sizeUnit: 'lb',
          },
        ];

        const result = calculateSaleImpact(ingredients, 10);

        // 10 burgers * 4 oz = 40 oz
        // 40 oz * 28.3495 g = 1133.98 g
        // 5 lb * 453.592 g = 2267.96 g
        // 1133.98 g / 2267.96 g = 0.5 bags
        expect(result.ingredients[0].deductionAmount).toBeCloseTo(0.5, 1);
      });

      it('converts g recipe to kg product size', () => {
        // DB: recipe_unit=g, size_unit=kg → weight_to_weight
        const ingredients = [
          {
            productName: 'Chicken Breast',
            recipeQuantity: 200, // 200g per serving
            recipeUnit: 'g',
            purchaseQuantity: 1,
            purchaseUnit: 'bag',
            costPerUnit: 20,
            currentStock: 4,
            sizeValue: 2,
            sizeUnit: 'kg',
          },
        ];

        const result = calculateSaleImpact(ingredients, 5);

        // 5 servings * 200g = 1000g = 1kg
        // 1kg / 2kg = 0.5 bags
        expect(result.ingredients[0].deductionAmount).toBeCloseTo(0.5, 1);
      });
    });

    describe('Case 3: Density conversion (volume to weight)', () => {
      it('converts cup of rice to lb using density (185g/cup)', () => {
        // DB: recipe_unit=cup, product=rice, size_unit=lb → density_to_weight
        const ingredients = [
          {
            productName: 'Jasmine Rice',
            recipeQuantity: 1, // 1 cup per serving
            recipeUnit: 'cup',
            purchaseQuantity: 1,
            purchaseUnit: 'bag',
            costPerUnit: 25,
            currentStock: 2,
            sizeValue: 25,
            sizeUnit: 'lb',
          },
        ];

        const result = calculateSaleImpact(ingredients, 10);

        // 10 servings * 1 cup = 10 cups
        // 10 cups * 185g/cup = 1850g
        // 25 lb * 453.592 g/lb = 11339.8g
        // 1850g / 11339.8g ≈ 0.163 bags
        expect(result.ingredients[0].deductionAmount).toBeCloseTo(0.163, 2);
      });

      it('converts cup of flour to lb using density (120g/cup)', () => {
        const ingredients = [
          {
            productName: 'All Purpose Flour',
            recipeQuantity: 2, // 2 cups per recipe
            recipeUnit: 'cup',
            purchaseQuantity: 1,
            purchaseUnit: 'bag',
            costPerUnit: 5,
            currentStock: 3,
            sizeValue: 5,
            sizeUnit: 'lb',
          },
        ];

        const result = calculateSaleImpact(ingredients, 5);

        // 5 recipes * 2 cups = 10 cups
        // 10 cups * 120g/cup = 1200g
        // 5 lb * 453.592 g/lb = 2267.96g
        // 1200g / 2267.96g ≈ 0.529 bags
        expect(result.ingredients[0].deductionAmount).toBeCloseTo(0.529, 2);
      });

      it('converts cup of sugar to lb using density (200g/cup)', () => {
        const ingredients = [
          {
            productName: 'Granulated Sugar',
            recipeQuantity: 0.5, // 0.5 cup per recipe
            recipeUnit: 'cup',
            purchaseQuantity: 1,
            purchaseUnit: 'bag',
            costPerUnit: 4,
            currentStock: 5,
            sizeValue: 4,
            sizeUnit: 'lb',
          },
        ];

        const result = calculateSaleImpact(ingredients, 8);

        // 8 recipes * 0.5 cups = 4 cups
        // 4 cups * 200g/cup = 800g
        // 4 lb * 453.592 g/lb = 1814.37g
        // 800g / 1814.37g ≈ 0.441 bags
        expect(result.ingredients[0].deductionAmount).toBeCloseTo(0.441, 2);
      });
    });

    describe('Case 4: Fallback (1:1 ratio with warning)', () => {
      it('uses fallback when units are incompatible and adds warning', () => {
        // DB: When conversion fails, uses 1:1 with warning
        const ingredients = [
          {
            productName: 'Mystery Ingredient',
            recipeQuantity: 2,
            recipeUnit: 'splash', // Not a recognized unit
            purchaseQuantity: 1,
            purchaseUnit: 'bottle',
            costPerUnit: 20,
            currentStock: 5,
            sizeValue: 750,
            sizeUnit: 'ml',
          },
        ];

        const result = calculateSaleImpact(ingredients, 3);

        // Fallback: 3 sales * 2 splashes = 6 (1:1 ratio)
        expect(result.ingredients[0].deductionAmount).toBe(6);
        expect(result.warnings.length).toBeGreaterThan(0);
      });
    });
  });
});
