import { describe, it, expect } from 'vitest';
import { validateRecipeConversions } from '@/utils/recipeConversionValidation';
import type { Product } from '@/hooks/useProducts';

const makeProduct = (id: string, overrides: Partial<Product> = {}): Product =>
  ({
    id,
    name: `Product ${id}`,
    cost_per_unit: 5,
    uom_purchase: 'lb',
    size_value: null,
    size_unit: null,
    package_qty: null,
    ...overrides,
  }) as unknown as Product;

describe('validateRecipeConversions -- product lookup', () => {
  it('resolves a product by id regardless of its position in the array', () => {
    const products = [makeProduct('p1'), makeProduct('p2'), makeProduct('p3')];
    const ingredients = [{ product_id: 'p3', quantity: 2, unit: 'lb' }];

    // 'lb' -> 'lb' needs no conversion, so a resolved product means no issues.
    expect(validateRecipeConversions(ingredients, products).hasIssues).toBe(false);
  });

  it('ignores an ingredient whose product is not in the catalogue', () => {
    const products = [makeProduct('p1')];
    const ingredients = [{ product_id: 'p-missing', quantity: 2, unit: 'lb' }];

    const result = validateRecipeConversions(ingredients, products);

    expect(result.hasIssues).toBe(false);
    expect(result.issues).toEqual([]);
  });

  it('CRITICAL: a new products array is re-indexed, never served from a stale cache', () => {
    // The index is cached per array identity. A replaced array (the only way
    // products change, since they come from React state) must be re-read, or
    // an edited cost silently keeps validating against the old catalogue.
    const ingredients = [{ product_id: 'p1', quantity: 2, unit: 'gal' }];

    // 'gal' against an 'each' purchase unit with no size info cannot convert.
    const before = [makeProduct('p1', { uom_purchase: 'each' })];
    expect(validateRecipeConversions(ingredients, before).hasIssues).toBe(true);

    // Same id, now purchased in gallons: no conversion needed.
    const after = [makeProduct('p1', { uom_purchase: 'gal' })];
    expect(validateRecipeConversions(ingredients, after).hasIssues).toBe(false);
  });

  it('reuses the same array across calls without changing the result', () => {
    const products = [makeProduct('p1', { uom_purchase: 'each' })];
    const ingredients = [{ product_id: 'p1', quantity: 2, unit: 'gal' }];

    const first = validateRecipeConversions(ingredients, products);
    const second = validateRecipeConversions(ingredients, products);

    expect(second).toEqual(first);
  });
});
