import { describe, it, expect } from 'vitest';
import {
  YIELD_MIN,
  YIELD_MAX,
  resolveYieldPct,
  loadedQuantity,
  computeLineCost,
} from '@/lib/recipeYield';

describe('resolveYieldPct', () => {
  it('defaults to 100 when the product and the override are both null', () => {
    expect(resolveYieldPct(null, null)).toEqual({ yieldPct: 100, source: 'product' });
  });

  it('defaults to 100 when the product and the override are both undefined', () => {
    expect(resolveYieldPct(undefined, undefined)).toEqual({ yieldPct: 100, source: 'product' });
  });

  it('uses the product yield when there is no override', () => {
    expect(resolveYieldPct(90, null)).toEqual({ yieldPct: 90, source: 'product' });
  });

  it('uses the override when the override is set', () => {
    expect(resolveYieldPct(90, 80)).toEqual({ yieldPct: 80, source: 'override' });
  });

  it('clamps a value above YIELD_MAX down to YIELD_MAX', () => {
    expect(resolveYieldPct(150, null)).toEqual({ yieldPct: YIELD_MAX, source: 'product' });
  });

  it('clamps a value below YIELD_MIN up to YIELD_MIN', () => {
    expect(resolveYieldPct(10, null)).toEqual({ yieldPct: YIELD_MIN, source: 'product' });
  });

  it('clamps an override below YIELD_MIN up to YIELD_MIN', () => {
    expect(resolveYieldPct(90, 1)).toEqual({ yieldPct: YIELD_MIN, source: 'override' });
  });
});

describe('loadedQuantity', () => {
  it('returns the portion quantity unchanged at 100% yield', () => {
    expect(loadedQuantity(5, 100)).toBeCloseTo(5, 6);
  });

  it('divides the portion quantity by the yield fraction', () => {
    expect(loadedQuantity(5, 90)).toBeCloseTo(5.5556, 4);
  });

  it('divides by the minimum yield without a divide-by-zero error', () => {
    expect(loadedQuantity(1, YIELD_MIN)).toBeCloseTo(2, 6);
  });
});

describe('computeLineCost', () => {
  const product = {
    name: 'Chicken Breast',
    cost_per_unit: 10,
    uom_purchase: 'lb',
    size_value: null,
    size_unit: null,
    yield_pct: 90,
  };

  it('scales the loaded cost by the effective yield from the product', () => {
    const result = computeLineCost({ quantity: 1, unit: 'lb' }, product);
    expect(result.yieldPct).toBe(90);
    expect(result.source).toBe('product');
    expect(result.portionCost).toBeCloseTo(10, 6);
    expect(result.loadedQty).toBeCloseTo(1.1111, 4);
    expect(result.loadedCost).toBeCloseTo(11.1111, 4);
    expect(result.wasteCost).toBeCloseTo(1.1111, 4);
  });

  it('prefers a line override over the product yield', () => {
    const result = computeLineCost({ quantity: 1, unit: 'lb', yield_pct_override: 80 }, product);
    expect(result.yieldPct).toBe(80);
    expect(result.source).toBe('override');
    expect(result.loadedCost).toBeCloseTo(12.5, 6);
    expect(result.wasteCost).toBeCloseTo(2.5, 6);
  });

  it('has zero waste cost at 100% yield', () => {
    const fullYieldProduct = { ...product, yield_pct: 100 };
    const result = computeLineCost({ quantity: 2, unit: 'lb' }, fullYieldProduct);
    expect(result.yieldPct).toBe(100);
    expect(result.loadedCost).toBeCloseTo(result.portionCost, 6);
    expect(result.wasteCost).toBeCloseTo(0, 6);
  });
});
