import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { calculateIngredientsCost } from '@/lib/prepCostCalculation';
import type { IngredientUnit } from '@/lib/recipeUnits';

/**
 * Quick Cook Tests
 *
 * These tests verify the core logic for the "Cook Now" functionality:
 * 1. Preview generation with correct ingredient deductions
 * 2. Stock sufficiency checks
 * 3. Cost calculations for output product pricing
 * 4. Output quantity and unit handling
 *
 * The actual database operations (complete_production_run) are tested via pgTAP.
 */

// Type definitions matching useQuickCook.tsx
interface QuickCookIngredient {
  product_id: string;
  product_name: string;
  quantity: number;
  unit: IngredientUnit;
  current_stock: number;
  stock_unit: string;
  is_sufficient: boolean;
}

interface PrepRecipeIngredient {
  id: string;
  prep_recipe_id: string;
  product_id: string;
  quantity: number;
  unit: IngredientUnit;
  notes?: string;
  sort_order?: number;
  product?: {
    id: string;
    name: string;
    cost_per_unit?: number;
    current_stock?: number;
    uom_purchase?: string;
    size_value?: number | null;
    size_unit?: string | null;
    category?: string;
  };
}

interface MockPrepRecipe {
  id: string;
  restaurant_id: string;
  name: string;
  description?: string;
  default_yield: number;
  default_yield_unit: IngredientUnit;
  output_product_id?: string | null;
  output_product?: {
    id: string;
    name: string;
    current_stock?: number;
  } | null;
  ingredients?: PrepRecipeIngredient[];
  shelf_life_days?: number;
}

// Helper: Generate preview (mirrors useQuickCook.previewQuickCook logic exactly)
function generateQuickCookPreview(recipe: MockPrepRecipe) {
  const ingredients = recipe.ingredients || [];

  // Calculate total cost using shared cost calculation
  const costResult = calculateIngredientsCost(
    ingredients.map((ing) => ({
      product_id: ing.product_id,
      quantity: ing.quantity,
      unit: ing.unit,
      product: ing.product,
    }))
  );

  const ingredientsToDeduct: QuickCookIngredient[] = ingredients.map((ing, index) => {
    const currentStock = ing.product?.current_stock ?? 0;
    const stockUnit = ing.product?.uom_purchase || ing.unit;
    const quantity = ing.quantity; // 1X yield

    // Use the same inventory deduction calculation as production
    // If deduction is 0 but quantity > 0, use quantity (handles missing product case)
    const costDeduction = costResult.ingredients[index]?.inventoryDeduction ?? 0;
    const inventoryDeduction = (costDeduction > 0 || quantity === 0) ? costDeduction : quantity;

    return {
      product_id: ing.product_id,
      product_name: ing.product?.name || 'Unknown',
      quantity,
      unit: ing.unit,
      current_stock: currentStock,
      stock_unit: stockUnit,
      is_sufficient: currentStock >= inventoryDeduction,
    };
  });

  const hasInsufficientStock = ingredientsToDeduct.some((ing) => !ing.is_sufficient);

  return {
    recipe,
    ingredients_to_deduct: ingredientsToDeduct,
    output_quantity: recipe.default_yield,
    output_unit: recipe.default_yield_unit,
    output_product_id: recipe.output_product_id,
    output_product_name: recipe.output_product?.name || recipe.name,
    has_insufficient_stock: hasInsufficientStock,
    total_cost: costResult.totalCost,
  };
}

// Helper to compute cost per output unit (not part of QuickCookPreview interface)
function computeCostPerOutputUnit(totalCost: number, outputQuantity: number): number {
  return outputQuantity > 0 ? totalCost / outputQuantity : 0;
}

// Helper: Generate SKU for auto-created products (mirrors useQuickCook logic)
function generateProductSku(recipeName: string): string {
  const slug = recipeName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '') || 'PREP';
  return `PREP-${slug}`.slice(0, 24) + `-${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

describe('Quick Cook - Preview Generation', () => {
  describe('Ingredient Deduction Preview', () => {
    it('should correctly list all ingredients to deduct at 1X yield', () => {
      const recipe: MockPrepRecipe = {
        id: 'recipe-1',
        restaurant_id: 'rest-1',
        name: 'House Marinara',
        default_yield: 4,
        default_yield_unit: 'qt',
        ingredients: [
          {
            id: 'ing-1',
            prep_recipe_id: 'recipe-1',
            product_id: 'tomato-1',
            quantity: 2,
            unit: 'can',
            product: {
              id: 'tomato-1',
              name: 'Crushed Tomatoes',
              cost_per_unit: 3.50,
              current_stock: 10,
              uom_purchase: 'can',
            },
          },
          {
            id: 'ing-2',
            prep_recipe_id: 'recipe-1',
            product_id: 'garlic-1',
            quantity: 0.25,
            unit: 'lb',
            product: {
              id: 'garlic-1',
              name: 'Garlic',
              cost_per_unit: 8,
              current_stock: 2,
              uom_purchase: 'lb',
            },
          },
          {
            id: 'ing-3',
            prep_recipe_id: 'recipe-1',
            product_id: 'basil-1',
            quantity: 1,
            unit: 'oz',
            product: {
              id: 'basil-1',
              name: 'Fresh Basil',
              cost_per_unit: 4,
              current_stock: 3,
              uom_purchase: 'oz',
            },
          },
        ],
      };

      const preview = generateQuickCookPreview(recipe);

      expect(preview.ingredients_to_deduct).toHaveLength(3);

      // Verify each ingredient
      expect(preview.ingredients_to_deduct[0]).toEqual({
        product_id: 'tomato-1',
        product_name: 'Crushed Tomatoes',
        quantity: 2,
        unit: 'can',
        current_stock: 10,
        stock_unit: 'can',
        is_sufficient: true,
      });

      expect(preview.ingredients_to_deduct[1]).toEqual({
        product_id: 'garlic-1',
        product_name: 'Garlic',
        quantity: 0.25,
        unit: 'lb',
        current_stock: 2,
        stock_unit: 'lb',
        is_sufficient: true,
      });

      expect(preview.ingredients_to_deduct[2]).toEqual({
        product_id: 'basil-1',
        product_name: 'Fresh Basil',
        quantity: 1,
        unit: 'oz',
        current_stock: 3,
        stock_unit: 'oz',
        is_sufficient: true,
      });
    });

    it('should use recipe quantities directly (1X yield)', () => {
      const recipe: MockPrepRecipe = {
        id: 'recipe-1',
        restaurant_id: 'rest-1',
        name: 'Simple Prep',
        default_yield: 10,
        default_yield_unit: 'lb',
        ingredients: [
          {
            id: 'ing-1',
            prep_recipe_id: 'recipe-1',
            product_id: 'item-1',
            quantity: 5.5,
            unit: 'lb',
            product: {
              id: 'item-1',
              name: 'Test Item',
              current_stock: 20,
            },
          },
        ],
      };

      const preview = generateQuickCookPreview(recipe);

      // Should be exactly the recipe quantity, not multiplied
      expect(preview.ingredients_to_deduct[0].quantity).toBe(5.5);
    });
  });

  describe('Stock Sufficiency Checks', () => {
    it('should mark ingredient as sufficient when stock >= quantity', () => {
      const recipe: MockPrepRecipe = {
        id: 'recipe-1',
        restaurant_id: 'rest-1',
        name: 'Test Recipe',
        default_yield: 1,
        default_yield_unit: 'batch',
        ingredients: [
          {
            id: 'ing-1',
            prep_recipe_id: 'recipe-1',
            product_id: 'item-1',
            quantity: 5,
            unit: 'each',
            product: {
              id: 'item-1',
              name: 'Item with Stock',
              current_stock: 5, // Exactly enough
            },
          },
        ],
      };

      const preview = generateQuickCookPreview(recipe);

      expect(preview.ingredients_to_deduct[0].is_sufficient).toBe(true);
      expect(preview.has_insufficient_stock).toBe(false);
    });

    it('should mark ingredient as insufficient when stock < quantity', () => {
      const recipe: MockPrepRecipe = {
        id: 'recipe-1',
        restaurant_id: 'rest-1',
        name: 'Test Recipe',
        default_yield: 1,
        default_yield_unit: 'batch',
        ingredients: [
          {
            id: 'ing-1',
            prep_recipe_id: 'recipe-1',
            product_id: 'item-1',
            quantity: 5,
            unit: 'each',
            product: {
              id: 'item-1',
              name: 'Low Stock Item',
              current_stock: 3, // Not enough
            },
          },
        ],
      };

      const preview = generateQuickCookPreview(recipe);

      expect(preview.ingredients_to_deduct[0].is_sufficient).toBe(false);
      expect(preview.has_insufficient_stock).toBe(true);
    });

    it('should handle zero stock as insufficient', () => {
      const recipe: MockPrepRecipe = {
        id: 'recipe-1',
        restaurant_id: 'rest-1',
        name: 'Test Recipe',
        default_yield: 1,
        default_yield_unit: 'batch',
        ingredients: [
          {
            id: 'ing-1',
            prep_recipe_id: 'recipe-1',
            product_id: 'item-1',
            quantity: 1,
            unit: 'each',
            product: {
              id: 'item-1',
              name: 'Zero Stock Item',
              current_stock: 0,
            },
          },
        ],
      };

      const preview = generateQuickCookPreview(recipe);

      expect(preview.ingredients_to_deduct[0].is_sufficient).toBe(false);
      expect(preview.has_insufficient_stock).toBe(true);
    });

    it('should handle null stock as zero (insufficient)', () => {
      const recipe: MockPrepRecipe = {
        id: 'recipe-1',
        restaurant_id: 'rest-1',
        name: 'Test Recipe',
        default_yield: 1,
        default_yield_unit: 'batch',
        ingredients: [
          {
            id: 'ing-1',
            prep_recipe_id: 'recipe-1',
            product_id: 'item-1',
            quantity: 1,
            unit: 'each',
            product: {
              id: 'item-1',
              name: 'No Stock Info',
              current_stock: undefined, // null/undefined stock
            },
          },
        ],
      };

      const preview = generateQuickCookPreview(recipe);

      expect(preview.ingredients_to_deduct[0].current_stock).toBe(0);
      expect(preview.ingredients_to_deduct[0].is_sufficient).toBe(false);
    });

    it('should detect insufficient stock even if only one ingredient is low', () => {
      const recipe: MockPrepRecipe = {
        id: 'recipe-1',
        restaurant_id: 'rest-1',
        name: 'Multi-Ingredient Recipe',
        default_yield: 1,
        default_yield_unit: 'batch',
        ingredients: [
          {
            id: 'ing-1',
            prep_recipe_id: 'recipe-1',
            product_id: 'item-1',
            quantity: 2,
            unit: 'lb',
            product: { id: 'item-1', name: 'Item 1', current_stock: 10 }, // Plenty
          },
          {
            id: 'ing-2',
            prep_recipe_id: 'recipe-1',
            product_id: 'item-2',
            quantity: 3,
            unit: 'lb',
            product: { id: 'item-2', name: 'Item 2', current_stock: 1 }, // Not enough!
          },
          {
            id: 'ing-3',
            prep_recipe_id: 'recipe-1',
            product_id: 'item-3',
            quantity: 1,
            unit: 'each',
            product: { id: 'item-3', name: 'Item 3', current_stock: 50 }, // Plenty
          },
        ],
      };

      const preview = generateQuickCookPreview(recipe);

      expect(preview.has_insufficient_stock).toBe(true);
      expect(preview.ingredients_to_deduct[0].is_sufficient).toBe(true);
      expect(preview.ingredients_to_deduct[1].is_sufficient).toBe(false);
      expect(preview.ingredients_to_deduct[2].is_sufficient).toBe(true);
    });
  });

  describe('Cost Calculations', () => {
    it('should calculate total cost from all ingredients', () => {
      const recipe: MockPrepRecipe = {
        id: 'recipe-1',
        restaurant_id: 'rest-1',
        name: 'Costed Recipe',
        default_yield: 4,
        default_yield_unit: 'qt',
        ingredients: [
          {
            id: 'ing-1',
            prep_recipe_id: 'recipe-1',
            product_id: 'tomato-1',
            quantity: 2,
            unit: 'can',
            product: {
              id: 'tomato-1',
              name: 'Crushed Tomatoes',
              cost_per_unit: 3.50,
              current_stock: 10,
              uom_purchase: 'can',
              size_value: 1,
              size_unit: 'can',
            },
          },
          {
            id: 'ing-2',
            prep_recipe_id: 'recipe-1',
            product_id: 'onion-1',
            quantity: 1,
            unit: 'lb',
            product: {
              id: 'onion-1',
              name: 'Onions',
              cost_per_unit: 1.50,
              current_stock: 20,
              uom_purchase: 'lb',
              size_value: 1,
              size_unit: 'lb',
            },
          },
        ],
      };

      const preview = generateQuickCookPreview(recipe);

      // 2 cans × $3.50 = $7.00
      // 1 lb × $1.50 = $1.50
      // Total = $8.50
      expect(preview.total_cost).toBeCloseTo(8.50, 2);
    });

    it('should calculate cost per output unit', () => {
      const recipe: MockPrepRecipe = {
        id: 'recipe-1',
        restaurant_id: 'rest-1',
        name: 'Costed Recipe',
        default_yield: 4, // 4 quarts
        default_yield_unit: 'qt',
        ingredients: [
          {
            id: 'ing-1',
            prep_recipe_id: 'recipe-1',
            product_id: 'tomato-1',
            quantity: 2,
            unit: 'can',
            product: {
              id: 'tomato-1',
              name: 'Crushed Tomatoes',
              cost_per_unit: 4,
              current_stock: 10,
              uom_purchase: 'can',
              size_value: 1,
              size_unit: 'can',
            },
          },
        ],
      };

      const preview = generateQuickCookPreview(recipe);

      // Total cost: 2 × $4 = $8
      // Cost per qt: $8 / 4 = $2
      expect(preview.total_cost).toBeCloseTo(8, 2);
      const costPerUnit = computeCostPerOutputUnit(preview.total_cost, recipe.default_yield);
      expect(costPerUnit).toBeCloseTo(2, 2);
    });

    it('should handle unit conversions in cost calculation', () => {
      const recipe: MockPrepRecipe = {
        id: 'recipe-1',
        restaurant_id: 'rest-1',
        name: 'Conversion Recipe',
        default_yield: 1,
        default_yield_unit: 'batch',
        ingredients: [
          {
            id: 'ing-1',
            prep_recipe_id: 'recipe-1',
            product_id: 'flour-1',
            quantity: 4, // 4 oz in recipe
            unit: 'oz',
            product: {
              id: 'flour-1',
              name: 'Flour',
              cost_per_unit: 5, // $5 per lb
              current_stock: 10,
              uom_purchase: 'lb',
              size_value: 1,
              size_unit: 'lb',
            },
          },
        ],
      };

      const preview = generateQuickCookPreview(recipe);

      // 4 oz = 0.25 lb
      // 0.25 lb × $5/lb = $1.25
      expect(preview.total_cost).toBeCloseTo(1.25, 2);
    });

    it('should handle zero cost ingredients gracefully', () => {
      const recipe: MockPrepRecipe = {
        id: 'recipe-1',
        restaurant_id: 'rest-1',
        name: 'Free Ingredient Recipe',
        default_yield: 1,
        default_yield_unit: 'batch',
        ingredients: [
          {
            id: 'ing-1',
            prep_recipe_id: 'recipe-1',
            product_id: 'water-1',
            quantity: 2,
            unit: 'cup',
            product: {
              id: 'water-1',
              name: 'Water',
              cost_per_unit: 0, // Free
              current_stock: 999,
              uom_purchase: 'gal',
            },
          },
          {
            id: 'ing-2',
            prep_recipe_id: 'recipe-1',
            product_id: 'salt-1',
            quantity: 1,
            unit: 'lb', // Use matching unit
            product: {
              id: 'salt-1',
              name: 'Salt',
              cost_per_unit: 2,
              current_stock: 50,
              uom_purchase: 'lb',
              size_value: 1,
              size_unit: 'lb',
            },
          },
        ],
      };

      const preview = generateQuickCookPreview(recipe);

      // Water should contribute $0 to total, salt should contribute $2
      expect(preview.total_cost).toBe(2);
    });
  });

  describe('Output Details', () => {
    it('should use recipe default yield for output quantity', () => {
      const recipe: MockPrepRecipe = {
        id: 'recipe-1',
        restaurant_id: 'rest-1',
        name: 'Yield Test',
        default_yield: 12,
        default_yield_unit: 'each',
        ingredients: [],
      };

      const preview = generateQuickCookPreview(recipe);

      expect(preview.output_quantity).toBe(12);
      expect(preview.output_unit).toBe('each');
    });

    it('should use output product name if available', () => {
      const recipe: MockPrepRecipe = {
        id: 'recipe-1',
        restaurant_id: 'rest-1',
        name: 'House Marinara',
        default_yield: 4,
        default_yield_unit: 'qt',
        output_product_id: 'output-1',
        output_product: {
          id: 'output-1',
          name: 'Marinara Sauce (House)',
          current_stock: 2,
        },
        ingredients: [],
      };

      const preview = generateQuickCookPreview(recipe);

      expect(preview.output_product_name).toBe('Marinara Sauce (House)');
      expect(preview.output_product_id).toBe('output-1');
    });

    it('should fall back to recipe name if no output product', () => {
      const recipe: MockPrepRecipe = {
        id: 'recipe-1',
        restaurant_id: 'rest-1',
        name: 'House Marinara',
        default_yield: 4,
        default_yield_unit: 'qt',
        output_product_id: null,
        output_product: null,
        ingredients: [],
      };

      const preview = generateQuickCookPreview(recipe);

      expect(preview.output_product_name).toBe('House Marinara');
      expect(preview.output_product_id).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    it('should handle recipe with no ingredients', () => {
      const recipe: MockPrepRecipe = {
        id: 'recipe-1',
        restaurant_id: 'rest-1',
        name: 'Empty Recipe',
        default_yield: 1,
        default_yield_unit: 'batch',
        ingredients: [],
      };

      const preview = generateQuickCookPreview(recipe);

      expect(preview.ingredients_to_deduct).toHaveLength(0);
      expect(preview.has_insufficient_stock).toBe(false);
      expect(preview.total_cost).toBe(0);
    });

    it('should handle very small quantities (precision)', () => {
      const recipe: MockPrepRecipe = {
        id: 'recipe-1',
        restaurant_id: 'rest-1',
        name: 'Precise Recipe',
        default_yield: 1,
        default_yield_unit: 'batch',
        ingredients: [
          {
            id: 'ing-1',
            prep_recipe_id: 'recipe-1',
            product_id: 'spice-1',
            quantity: 0.125,
            unit: 'oz', // Use matching unit for reliable cost calculation
            product: {
              id: 'spice-1',
              name: 'Saffron',
              cost_per_unit: 100, // $100 per oz
              current_stock: 1,
              uom_purchase: 'oz',
              size_value: 1,
              size_unit: 'oz',
            },
          },
        ],
      };

      const preview = generateQuickCookPreview(recipe);

      expect(preview.ingredients_to_deduct[0].quantity).toBe(0.125);
      // 0.125 oz × $100/oz = $12.50
      expect(preview.total_cost).toBeCloseTo(12.5, 2);
    });

    it('should handle missing product info gracefully', () => {
      const recipe: MockPrepRecipe = {
        id: 'recipe-1',
        restaurant_id: 'rest-1',
        name: 'Missing Product Recipe',
        default_yield: 1,
        default_yield_unit: 'batch',
        ingredients: [
          {
            id: 'ing-1',
            prep_recipe_id: 'recipe-1',
            product_id: 'unknown-1',
            quantity: 1,
            unit: 'each',
            product: undefined, // Missing product data
          },
        ],
      };

      const preview = generateQuickCookPreview(recipe);

      expect(preview.ingredients_to_deduct[0].product_name).toBe('Unknown');
      expect(preview.ingredients_to_deduct[0].current_stock).toBe(0);
      expect(preview.ingredients_to_deduct[0].is_sufficient).toBe(false);
    });
  });
});

describe('Quick Cook - Product Auto-Creation', () => {
  describe('SKU Generation', () => {
    it('should generate valid SKU from recipe name', () => {
      const sku = generateProductSku('House Marinara');

      expect(sku).toMatch(/^PREP-HOUSE-MARINARA-[A-Z0-9]{4}$/);
    });

    it('should handle special characters in recipe name', () => {
      const sku = generateProductSku("Chef's Special (Spicy!)");

      // SKU gets truncated to 24 chars before suffix, so "SPICY" becomes "SPIC"
      expect(sku).toMatch(/^PREP-CHEF-S-SPECIAL-SPIC-[A-Z0-9]{4}$/);
    });

    it('should truncate long recipe names', () => {
      const longName = 'This Is A Very Long Recipe Name That Exceeds Our Limit';
      const sku = generateProductSku(longName);

      // Should be max 24 chars + hyphen + 4 char suffix = 29 max
      expect(sku.length).toBeLessThanOrEqual(29);
      expect(sku).toMatch(/^PREP-.+-[A-Z0-9]{4}$/);
    });

    it('should handle empty or whitespace recipe names', () => {
      const sku = generateProductSku('   ');

      // Empty name results in 'PREP' slug, so SKU is "PREP-PREP-xxxx"
      expect(sku).toMatch(/^PREP-PREP-[A-Z0-9]{4}$/);
    });

    it('should generate unique SKUs for same recipe (different timestamps)', () => {
      // Mock Date.now to return different values for deterministic testing
      const mockNow = vi.spyOn(Date, 'now');

      // First call returns timestamp that produces one suffix
      mockNow.mockReturnValueOnce(1706900000000); // Results in suffix based on this timestamp
      const sku1 = generateProductSku('Same Recipe');

      // Second call returns different timestamp
      mockNow.mockReturnValueOnce(1706900001000); // Results in different suffix
      const sku2 = generateProductSku('Same Recipe');

      mockNow.mockRestore();

      // The base should be the same, but suffix different
      expect(sku1.slice(0, -5)).toBe(sku2.slice(0, -5)); // Same base prefix
      expect(sku1).not.toBe(sku2); // Different overall due to timestamp suffix
    });

    it('should generate SKU with expected timestamp-based suffix format', () => {
      const sku = generateProductSku('Test Recipe');

      // Verify SKU matches expected pattern: PREP-{SLUG}-{4-char suffix}
      expect(sku).toMatch(/^PREP-TEST-RECIPE-[A-Z0-9]{4}$/);
    });
  });
});

describe('Quick Cook - Inventory Impact Validation', () => {
  describe('Deduction Amounts', () => {
    it('should deduct exact 1X quantities for each ingredient', () => {
      const recipe: MockPrepRecipe = {
        id: 'recipe-1',
        restaurant_id: 'rest-1',
        name: 'Standard Recipe',
        default_yield: 10,
        default_yield_unit: 'lb',
        ingredients: [
          {
            id: 'ing-1',
            prep_recipe_id: 'recipe-1',
            product_id: 'item-1',
            quantity: 2.5,
            unit: 'lb',
            product: {
              id: 'item-1',
              name: 'Ingredient 1',
              current_stock: 50,
              cost_per_unit: 5,
              uom_purchase: 'lb',
            },
          },
          {
            id: 'ing-2',
            prep_recipe_id: 'recipe-1',
            product_id: 'item-2',
            quantity: 0.75,
            unit: 'cup',
            product: {
              id: 'item-2',
              name: 'Ingredient 2',
              current_stock: 10,
              cost_per_unit: 8,
              uom_purchase: 'cup',
            },
          },
        ],
      };

      const preview = generateQuickCookPreview(recipe);

      // Verify deduction quantities match recipe exactly
      expect(preview.ingredients_to_deduct[0].quantity).toBe(2.5);
      expect(preview.ingredients_to_deduct[1].quantity).toBe(0.75);
    });
  });

  describe('Addition Amounts', () => {
    it('should add output equal to default_yield', () => {
      const recipe: MockPrepRecipe = {
        id: 'recipe-1',
        restaurant_id: 'rest-1',
        name: 'Output Test',
        default_yield: 5,
        default_yield_unit: 'qt',
        output_product_id: 'output-1',
        output_product: {
          id: 'output-1',
          name: 'Output Product',
          current_stock: 2,
        },
        ingredients: [],
      };

      const preview = generateQuickCookPreview(recipe);

      expect(preview.output_quantity).toBe(5);
      expect(preview.output_unit).toBe('qt');
    });

    it('should correctly identify output product for existing products', () => {
      const recipe: MockPrepRecipe = {
        id: 'recipe-1',
        restaurant_id: 'rest-1',
        name: 'Linked Output Recipe',
        default_yield: 8,
        default_yield_unit: 'each',
        output_product_id: 'prod-123',
        output_product: {
          id: 'prod-123',
          name: 'Prepared Item',
          current_stock: 15,
        },
        ingredients: [],
      };

      const preview = generateQuickCookPreview(recipe);

      expect(preview.output_product_id).toBe('prod-123');
      expect(preview.output_product_name).toBe('Prepared Item');
    });
  });

  describe('Cost-Based Pricing', () => {
    it('should calculate correct cost per unit for output product', () => {
      const recipe: MockPrepRecipe = {
        id: 'recipe-1',
        restaurant_id: 'rest-1',
        name: 'Priced Recipe',
        default_yield: 10, // 10 units output
        default_yield_unit: 'each',
        ingredients: [
          {
            id: 'ing-1',
            prep_recipe_id: 'recipe-1',
            product_id: 'item-1',
            quantity: 5,
            unit: 'lb',
            product: {
              id: 'item-1',
              name: 'Main Ingredient',
              current_stock: 100,
              cost_per_unit: 4, // $4/lb
              uom_purchase: 'lb',
              size_value: 1,
              size_unit: 'lb',
            },
          },
        ],
      };

      const preview = generateQuickCookPreview(recipe);

      // Total cost: 5 lb × $4/lb = $20
      // Cost per unit: $20 / 10 = $2
      expect(preview.total_cost).toBeCloseTo(20, 2);
      const costPerUnit = computeCostPerOutputUnit(preview.total_cost, recipe.default_yield);
      expect(costPerUnit).toBeCloseTo(2, 2);
    });

    it('should handle complex multi-ingredient cost calculation', () => {
      const recipe: MockPrepRecipe = {
        id: 'recipe-1',
        restaurant_id: 'rest-1',
        name: 'Complex Recipe',
        default_yield: 4,
        default_yield_unit: 'qt',
        ingredients: [
          {
            id: 'ing-1',
            prep_recipe_id: 'recipe-1',
            product_id: 'tomatoes',
            quantity: 2,
            unit: 'can',
            product: {
              id: 'tomatoes',
              name: 'Crushed Tomatoes',
              cost_per_unit: 2.50,
              current_stock: 20,
              uom_purchase: 'can',
              size_value: 28,
              size_unit: 'oz',
            },
          },
          {
            id: 'ing-2',
            prep_recipe_id: 'recipe-1',
            product_id: 'olive-oil',
            quantity: 4,
            unit: 'tbsp',
            product: {
              id: 'olive-oil',
              name: 'Olive Oil',
              cost_per_unit: 12,
              current_stock: 5,
              uom_purchase: 'bottle',
              size_value: 500,
              size_unit: 'ml',
            },
          },
          {
            id: 'ing-3',
            prep_recipe_id: 'recipe-1',
            product_id: 'garlic',
            quantity: 3,
            unit: 'each',
            product: {
              id: 'garlic',
              name: 'Garlic Cloves',
              cost_per_unit: 0.10,
              current_stock: 100,
              uom_purchase: 'each',
              size_value: 1,
              size_unit: 'each',
            },
          },
        ],
      };

      const preview = generateQuickCookPreview(recipe);

      // Verify total cost is sum of all ingredients
      expect(preview.total_cost).toBeGreaterThan(0);

      // Cost per qt should be total / 4
      const costPerUnit = computeCostPerOutputUnit(preview.total_cost, recipe.default_yield);
      expect(costPerUnit).toBeCloseTo(preview.total_cost / 4, 2);
    });
  });
});

describe('Quick Cook - Complete Flow Simulation', () => {
  it('should correctly preview a full marinara recipe cook', () => {
    const recipe: MockPrepRecipe = {
      id: 'marinara-recipe',
      restaurant_id: 'rest-1',
      name: 'House Marinara',
      description: 'Classic tomato sauce',
      default_yield: 4,
      default_yield_unit: 'qt',
      output_product_id: 'marinara-product',
      output_product: {
        id: 'marinara-product',
        name: 'House Marinara Sauce',
        current_stock: 2,
      },
      shelf_life_days: 5,
      ingredients: [
        {
          id: 'ing-1',
          prep_recipe_id: 'marinara-recipe',
          product_id: 'crushed-tom',
          quantity: 2,
          unit: 'can',
          product: {
            id: 'crushed-tom',
            name: 'Crushed Tomatoes #10 Can',
            cost_per_unit: 4.50,
            current_stock: 12,
            uom_purchase: 'can',
            size_value: 102,
            size_unit: 'oz',
          },
        },
        {
          id: 'ing-2',
          prep_recipe_id: 'marinara-recipe',
          product_id: 'tomato-paste',
          quantity: 0.5,
          unit: 'can',
          product: {
            id: 'tomato-paste',
            name: 'Tomato Paste',
            cost_per_unit: 2.00,
            current_stock: 8,
            uom_purchase: 'can',
            size_value: 6,
            size_unit: 'oz',
          },
        },
        {
          id: 'ing-3',
          prep_recipe_id: 'marinara-recipe',
          product_id: 'garlic',
          quantity: 4,
          unit: 'each',
          product: {
            id: 'garlic',
            name: 'Garlic Cloves',
            cost_per_unit: 0.08,
            current_stock: 50,
            uom_purchase: 'each',
            size_value: 1,
            size_unit: 'each',
          },
        },
        {
          id: 'ing-4',
          prep_recipe_id: 'marinara-recipe',
          product_id: 'olive-oil',
          quantity: 2,
          unit: 'fl oz',
          product: {
            id: 'olive-oil',
            name: 'Extra Virgin Olive Oil',
            cost_per_unit: 18.00,
            current_stock: 3,
            uom_purchase: 'bottle',
            size_value: 750,
            size_unit: 'ml',
          },
        },
        {
          id: 'ing-5',
          prep_recipe_id: 'marinara-recipe',
          product_id: 'basil',
          quantity: 0.5,
          unit: 'oz',
          product: {
            id: 'basil',
            name: 'Fresh Basil',
            cost_per_unit: 3.00,
            current_stock: 2,
            uom_purchase: 'oz',
            size_value: 1,
            size_unit: 'oz',
          },
        },
      ],
    };

    const preview = generateQuickCookPreview(recipe);

    // Verify output details
    expect(preview.output_quantity).toBe(4);
    expect(preview.output_unit).toBe('qt');
    expect(preview.output_product_name).toBe('House Marinara Sauce');

    // Verify all ingredients are listed for deduction
    expect(preview.ingredients_to_deduct).toHaveLength(5);

    // Verify all ingredients have sufficient stock
    expect(preview.has_insufficient_stock).toBe(false);
    preview.ingredients_to_deduct.forEach((ing) => {
      expect(ing.is_sufficient).toBe(true);
    });

    // Verify cost is calculated
    expect(preview.total_cost).toBeGreaterThan(0);
    const costPerUnit = computeCostPerOutputUnit(preview.total_cost, recipe.default_yield);
    expect(costPerUnit).toBeGreaterThan(0);

    // Verify cost per qt is reasonable (should be a few dollars)
    expect(costPerUnit).toBeGreaterThan(1);
    expect(costPerUnit).toBeLessThan(10);
  });

  it('should correctly preview a recipe with low stock warning', () => {
    const recipe: MockPrepRecipe = {
      id: 'dough-recipe',
      restaurant_id: 'rest-1',
      name: 'Pizza Dough',
      default_yield: 10,
      default_yield_unit: 'lb',
      ingredients: [
        {
          id: 'ing-1',
          prep_recipe_id: 'dough-recipe',
          product_id: 'flour',
          quantity: 8,
          unit: 'lb',
          product: {
            id: 'flour',
            name: 'Bread Flour',
            cost_per_unit: 0.80,
            current_stock: 5, // Only 5 lb, need 8!
            uom_purchase: 'lb',
          },
        },
        {
          id: 'ing-2',
          prep_recipe_id: 'dough-recipe',
          product_id: 'yeast',
          quantity: 2,
          unit: 'oz',
          product: {
            id: 'yeast',
            name: 'Active Dry Yeast',
            cost_per_unit: 0.50,
            current_stock: 16, // Plenty
            uom_purchase: 'oz',
          },
        },
      ],
    };

    const preview = generateQuickCookPreview(recipe);

    // Should have insufficient stock warning
    expect(preview.has_insufficient_stock).toBe(true);

    // Flour should be marked insufficient
    const flourIngredient = preview.ingredients_to_deduct.find(
      (ing) => ing.product_id === 'flour'
    );
    expect(flourIngredient?.is_sufficient).toBe(false);
    expect(flourIngredient?.current_stock).toBe(5);
    expect(flourIngredient?.quantity).toBe(8);

    // Yeast should be sufficient
    const yeastIngredient = preview.ingredients_to_deduct.find(
      (ing) => ing.product_id === 'yeast'
    );
    expect(yeastIngredient?.is_sufficient).toBe(true);
  });
});
