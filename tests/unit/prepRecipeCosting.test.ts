import { describe, it, expect } from 'vitest';
import { calculatePrepIngredientCost, summarizePrepRecipeCosts } from '@/lib/prepRecipeCosting';

const baseProduct = {
  id: 'p1',
  name: 'Onion White',
  cost_per_unit: 6.46,
  uom_purchase: 'lb',
  size_value: null,
  size_unit: null,
};

const containerProduct = {
  id: 'p2',
  name: 'Spice Jar',
  cost_per_unit: 4.0,
  uom_purchase: 'jar',
  size_value: null,
  size_unit: null,
};

describe('prepRecipeCosting', () => {
  it('computes cost with conversion', () => {
    const result = calculatePrepIngredientCost({
      product: baseProduct,
      quantity: 3,
      unit: 'oz',
    });

    expect(result.status).toBe('ok');
    expect(result.cost).toBeCloseTo(1.21, 2);
  });

  it('flags missing cost', () => {
    const result = calculatePrepIngredientCost({
      product: { ...baseProduct, cost_per_unit: null },
      quantity: 3,
      unit: 'oz',
    });

    expect(result.status).toBe('missing_cost');
    expect(result.cost).toBeNull();
  });

  it('flags missing size for container units', () => {
    const result = calculatePrepIngredientCost({
      product: containerProduct,
      quantity: 1,
      unit: 'oz',
    });

    expect(result.status).toBe('missing_size');
  });

  it('summarizes missing ingredients', () => {
    const summary = summarizePrepRecipeCosts(
      [
        { product_id: 'p1', quantity: 3, unit: 'oz' },
        { product_id: 'p2', quantity: 1, unit: 'oz' },
      ],
      new Map([
        ['p1', baseProduct],
        ['p2', containerProduct],
      ])
    );

    expect(summary.missingCount).toBe(1);
    expect(summary.estimatedTotal).toBeCloseTo(1.21, 2);
  });
});
