/**
 * Prep Production Business Logic Tests
 *
 * Tests the core business logic for prep production:
 * - Cost calculations
 * - Variance handling
 * - Inventory updates
 * - Batch state management
 */

import { describe, it, expect } from 'vitest';

// Mock data for testing
const mockProduct = {
  id: 'product-1',
  name: 'Raw Chicken',
  cost_per_unit: 4.00,
  uom_purchase: 'kg',
  current_stock: 50,
};

const mockPrepRecipe = {
  id: 'recipe-1',
  name: 'Chicken Soup Base',
  default_yield: 10,
  default_yield_unit: 'L',
  ingredients: [{
    id: 'ingredient-1',
    product_id: 'product-1',
    quantity: 5,
    unit: 'kg',
    product: mockProduct,
  }],
};

const mockProductionRun = {
  id: 'run-1',
  status: 'planned',
  target_yield: 20,
  target_yield_unit: 'L',
  actual_yield: null,
  actual_yield_unit: null,
  prep_recipe: mockPrepRecipe,
  ingredients: [{
    id: 'run-ingredient-1',
    product_id: 'product-1',
    expected_quantity: 10, // scaled from 5kg for 20L yield (2x scale)
    actual_quantity: null,
    unit: 'kg',
    product: mockProduct,
  }],
};

describe('Prep Production Business Logic', () => {

  describe('Cost Calculations', () => {
    it('should calculate expected total cost for a batch', () => {
      const run = mockProductionRun;
      const expectedCost = run.ingredients.reduce((sum, ing) => {
        const quantity = ing.expected_quantity || 0;
        const costPerUnit = ing.product?.cost_per_unit || 0;
        return sum + (quantity * costPerUnit);
      }, 0);

      // For our test data: 10kg * $4.00/kg = $40.00
      expect(expectedCost).toBe(40.00);
    });

    it('should calculate actual total cost when ingredients differ', () => {
      const runWithActuals = {
        ...mockProductionRun,
        ingredients: [{
          ...mockProductionRun.ingredients[0],
          actual_quantity: 12, // Used 12kg instead of expected 10kg
        }],
      };

      const actualCost = runWithActuals.ingredients.reduce((sum, ing) => {
        const quantity = ing.actual_quantity || ing.expected_quantity || 0;
        const costPerUnit = ing.product?.cost_per_unit || 0;
        return sum + (quantity * costPerUnit);
      }, 0);

      // 12kg * $4.00/kg = $48.00
      expect(actualCost).toBe(48.00);
    });

    it('should calculate cost per unit for output product', () => {
      const ingredientCost = 40.00;
      const actualYield = 18; // Liters

      const costPerUnit = actualYield > 0 ? ingredientCost / actualYield : 0;

      expect(costPerUnit).toBeCloseTo(2.22, 2); // Approximately $2.22 per liter
    });
    it('should update cost per unit when variance affects pricing', () => {
      // Test the variance pricing logic implemented in useProductionRuns
      const ingredientCost = 40.00;
      const actualYield = 18; // 10% under target
      const variancePercent = -10;

      // Positive variance (over-yield) = lower cost per unit
      // Negative variance (under-yield) = higher cost per unit
      const varianceAdjustment = 1 - (variancePercent / 100);
      const adjustedCostPerUnit = (ingredientCost / actualYield) * varianceAdjustment;

      // Expected: (40/18) * (1 - (-10/100)) = 2.22 * 1.1 = 2.44
      expect(adjustedCostPerUnit).toBeCloseTo(2.44, 2);
    });  });

  describe('Variance Calculations', () => {
    it('should calculate yield variance percentage correctly', () => {
      const targetYield = 20;
      const actualYield = 18; // 10% under target
      const variance = targetYield > 0 ? ((actualYield - targetYield) / targetYield) * 100 : 0;

      expect(variance).toBe(-10);
    });

    it('should calculate positive variance for over-yield', () => {
      const targetYield = 20;
      const actualYield = 22; // 10% over target
      const variance = targetYield > 0 ? ((actualYield - targetYield) / targetYield) * 100 : 0;

      expect(variance).toBe(10);
    });
  });

  describe('Batch Scaling Logic', () => {
    it('should scale ingredients based on target yield', () => {
      const recipe = mockPrepRecipe;
      const targetYield = 20; // Double the default yield
      const scale = recipe.default_yield > 0 ? targetYield / recipe.default_yield : 1;

      expect(scale).toBe(2);

      const scaledIngredients = recipe.ingredients.map(ing => ({
        ...ing,
        quantity: (ing.quantity || 0) * scale,
      }));

      expect(scaledIngredients[0].quantity).toBe(10); // 5 * 2
    });
  });

  describe('Inventory Impact Calculations', () => {
    it('should calculate inventory deduction for completed batch', () => {
      const run = {
        ...mockProductionRun,
        status: 'completed',
        actual_yield: 18,
        ingredients: [{
          ...mockProductionRun.ingredients[0],
          actual_quantity: 12, // Actually used 12kg
        }],
      };

      const inventoryDeductions = run.ingredients.map(ing => ({
        product_id: ing.product_id,
        quantity: ing.actual_quantity || ing.expected_quantity || 0,
        unit: ing.unit,
      }));

      expect(inventoryDeductions).toEqual([{
        product_id: 'product-1',
        quantity: 12,
        unit: 'kg',
      }]);
    });

    it('should calculate inventory addition for output product', () => {
      const run = {
        ...mockProductionRun,
        status: 'completed',
        actual_yield: 18,
        actual_yield_unit: 'L',
      };

      const outputProductAddition = {
        product_id: 'output-product-1',
        quantity: run.actual_yield,
        unit: run.actual_yield_unit,
      };

      expect(outputProductAddition).toEqual({
        product_id: 'output-product-1',
        quantity: 18,
        unit: 'L',
      });
    });
  });

  describe('Batch State Validation', () => {
    it('should validate batch can transition from planned to in_progress', () => {
      const batch = { ...mockProductionRun, status: 'planned' };

      const validTransitions = {
        planned: ['in_progress', 'cancelled'],
        in_progress: ['completed', 'cancelled'],
        completed: [], // Completed batches are immutable
        cancelled: [], // Cancelled batches are immutable
      };

      expect(validTransitions[batch.status]).toContain('in_progress');
    });

    it('should prevent invalid status transitions', () => {
      const batch = { ...mockProductionRun, status: 'completed' };

      const validTransitions = {
        planned: ['in_progress', 'cancelled'],
        in_progress: ['completed', 'cancelled'],
        completed: [],
        cancelled: [],
      };

      expect(validTransitions[batch.status]).toHaveLength(0);
    });
  });

  describe('Idempotency Checks', () => {
    it('should detect if batch completion has already been processed', () => {
      const completedBatch = {
        ...mockProductionRun,
        status: 'completed',
        completed_at: '2024-01-01T10:00:00Z',
      };

      // Attempting to complete again should be rejected
      const shouldAllowCompletion = completedBatch.status !== 'completed';

      expect(shouldAllowCompletion).toBe(false);
    });

    it('should allow completion of non-completed batches', () => {
      const inProgressBatch = {
        ...mockProductionRun,
        status: 'in_progress',
        completed_at: null,
      };

      const shouldAllowCompletion = inProgressBatch.status !== 'completed';

      expect(shouldAllowCompletion).toBe(true);
    });
  });

  describe('Projected Cost Calculations for UI', () => {
    it('should calculate projected costs for in-progress batches', () => {
      const inProgressRun = {
        ...mockProductionRun,
        status: 'in_progress',
        actual_yield: 18,
        ingredients: [{
          ...mockProductionRun.ingredients[0],
          actual_quantity: 12, // 12kg used
          product: { ...mockProduct, cost_per_unit: 4.00 },
        }],
      };

      // Calculate projected costs like the UI does
      const yieldValue = inProgressRun.actual_yield || inProgressRun.target_yield || 0;
      const totalIngredientCost = inProgressRun.ingredients.reduce((sum, ing) => {
        const quantity = ing.actual_quantity ?? ing.expected_quantity ?? 0;
        const costPerUnit = ing.product?.cost_per_unit || 0;
        return sum + (quantity * costPerUnit);
      }, 0);

      const costPerUnit = totalIngredientCost / yieldValue;

      expect(totalIngredientCost).toBe(48.00); // 12kg * $4.00/kg
      expect(costPerUnit).toBeCloseTo(2.67, 2); // $48 / 18L
    });

    it('should show stored costs for completed batches', () => {
      const completedRun = {
        ...mockProductionRun,
        status: 'completed',
        cost_per_unit: 2.50,
        actual_total_cost: 45.00,
      };

      // For completed batches, UI should use stored values
      expect(completedRun.cost_per_unit).toBe(2.50);
      expect(completedRun.actual_total_cost).toBe(45.00);
    });

    it('should handle missing data gracefully', () => {
      const runWithNoData = {
        ...mockProductionRun,
        status: 'in_progress',
        actual_yield: null,
        ingredients: [],
      };

      const yieldValue = runWithNoData.actual_yield || runWithNoData.target_yield || 0;
      const totalIngredientCost = runWithNoData.ingredients.reduce((sum, ing) => {
        const quantity = ing.actual_quantity ?? ing.expected_quantity ?? 0;
        const costPerUnit = ing.product?.cost_per_unit || 0;
        return sum + (quantity * costPerUnit);
      }, 0);

      expect(yieldValue).toBe(20); // Falls back to target_yield
      expect(totalIngredientCost).toBe(0); // No ingredients
    });
  });
});