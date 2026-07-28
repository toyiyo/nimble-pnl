import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { calculateInventoryImpact, getProductUnitInfo } from '@/lib/enhancedUnitConversion';

// ---- Mocks -----------------------------------------------------------------
const toastMock = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

const authUser = { id: 'user-1' };
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: authUser }),
}));

let recipesResponse: { data: unknown[] | null; error: unknown };
let prepLinksResponse: { data: unknown[] | null; error: unknown };
let productsResponse: { data: unknown[] | null; error: unknown };
let ingredientsResponse: { data: unknown[] | null; error: unknown };
let salesStatsResponse: { data: unknown[] | null; error: unknown };

// Total count of terminal `.range()` calls issued across every query in a
// single fetchRecipes() run -- this is the N+1 regression guard: the design
// (docs/superpowers/specs/2026-07-27-recipes-page-load-perf-design.md §5)
// commits to exactly 5 bounded requests (Q1 recipes, Q2 prep_recipes, Q3
// recipe_ingredients, Q4 products, Q5 sales stats RPC) regardless of how
// many recipes a tenant has, replacing what used to be ~1 + 1 + 3N requests.
let requestCount = 0;

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'recipes') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    range: vi.fn().mockImplementation(() => {
                      requestCount += 1;
                      return Promise.resolve(recipesResponse);
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'prep_recipes') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              not: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  range: vi.fn().mockImplementation(() => {
                    requestCount += 1;
                    return Promise.resolve(prepLinksResponse);
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'products') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                range: vi.fn().mockImplementation(() => {
                  requestCount += 1;
                  return Promise.resolve(productsResponse);
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'recipe_ingredients') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  range: vi.fn().mockImplementation(() => {
                    requestCount += 1;
                    return Promise.resolve(ingredientsResponse);
                  }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    }),
    rpc: vi.fn().mockReturnValue({
      range: vi.fn().mockImplementation(() => {
        requestCount += 1;
        return Promise.resolve(salesStatsResponse);
      }),
    }),
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    }),
    removeChannel: vi.fn(),
  },
}));

import { useRecipes, buildEnhancedRecipes } from '@/hooks/useRecipes';
import { createQueryWrapper } from './helpers/queryWrapper';

const makeRecipe = (id: string, name: string) => ({
  id,
  restaurant_id: 'rest-1',
  name,
  description: null,
  pos_item_name: null,
  pos_item_id: null,
  serving_size: 1,
  estimated_cost: 0,
  is_active: true,
  created_at: '',
  updated_at: '',
  created_by: null,
});

let wrapper: ReturnType<typeof createQueryWrapper>['wrapper'];

beforeEach(() => {
  ({ wrapper } = createQueryWrapper());
  vi.clearAllMocks();
  requestCount = 0;
  recipesResponse = { data: [], error: null };
  prepLinksResponse = { data: [], error: null };
  productsResponse = { data: [], error: null };
  ingredientsResponse = { data: [], error: null };
  salesStatsResponse = { data: [], error: null };
});

describe('useRecipes fetchRecipes -- N+1 regression guard', () => {
  it('issues exactly 5 requests for 3 recipes', async () => {
    recipesResponse = {
      data: [makeRecipe('r1', 'Taco'), makeRecipe('r2', 'Burrito'), makeRecipe('r3', 'Nachos')],
      error: null,
    };

    const { result } = renderHook(() => useRecipes('rest-1'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(requestCount).toBe(5);
  });

  it('issues exactly 5 requests for 133 recipes -- the same count as 3, not N+1', async () => {
    recipesResponse = {
      data: Array.from({ length: 133 }, (_, i) => makeRecipe(`r${i}`, `Recipe ${i}`)),
      error: null,
    };

    const { result } = renderHook(() => useRecipes('rest-1'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(requestCount).toBe(5);
  });
});

describe('buildEnhancedRecipes -- cost + profitability parity', () => {
  it('matches summing calculateInventoryImpact per ingredient (the old per-recipe loop), computed in memory instead', () => {
    const products = [
      { id: 'p1', name: 'Chicken', cost_per_unit: 5, uom_purchase: 'lb', size_value: null, size_unit: null, package_qty: null },
      { id: 'p2', name: 'Rice', cost_per_unit: 3, uom_purchase: 'lb', size_value: null, size_unit: null, package_qty: null },
    ];
    const ingredients = [
      { id: 'i1', recipe_id: 'r1', product_id: 'p1', quantity: 2, unit: 'lb' },
      { id: 'i2', recipe_id: 'r1', product_id: 'p2', quantity: 1, unit: 'lb' },
    ];
    const recipes = [
      {
        id: 'r1',
        restaurant_id: 'rest-1',
        name: 'Burrito Recipe',
        description: null,
        pos_item_name: 'Burrito',
        pos_item_id: null,
        serving_size: 1,
        estimated_cost: 0,
        is_active: true,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
        created_by: null,
      },
    ];
    const salesStats = [{ item_name: 'Burrito', avg_sale_price: 20 }];

    // Independently reproduce what the old per-recipe loop computed: sum
    // calculateInventoryImpact's costImpact across this recipe's ingredients.
    let expectedCost = 0;
    for (const ingredient of ingredients) {
      const product = products.find((p) => p.id === ingredient.product_id)!;
      const { purchaseUnit, quantityPerPurchaseUnit, sizeValue, sizeUnit } = getProductUnitInfo(product);
      const result = calculateInventoryImpact(
        ingredient.quantity,
        ingredient.unit,
        quantityPerPurchaseUnit,
        purchaseUnit,
        product.name,
        product.cost_per_unit,
        sizeValue,
        sizeUnit
      );
      expectedCost += result.costImpact;
    }
    const expectedProfitPerServing = 20 - expectedCost;
    const expectedProfitMargin = (expectedProfitPerServing / 20) * 100;

    const [enhanced] = buildEnhancedRecipes(recipes, ingredients, products, salesStats);

    expect(enhanced.estimated_cost).toBeCloseTo(expectedCost, 10);
    expect(enhanced.avg_sale_price).toBe(20);
    expect(enhanced.profit_per_serving).toBeCloseTo(expectedProfitPerServing, 10);
    expect(enhanced.profit_margin).toBeCloseTo(expectedProfitMargin, 10);
    expect(enhanced.ingredients).toEqual([
      { product_id: 'p1', quantity: 2, unit: 'lb' },
      { product_id: 'p2', quantity: 1, unit: 'lb' },
    ]);
  });

  it('a recipe with no ingredients keeps its last-known stored cost (mirrors the pre-existing `updatedCost || estimated_cost` fallback)', () => {
    const recipes = [
      {
        id: 'r2',
        restaurant_id: 'rest-1',
        name: 'No Ingredients Yet',
        description: null,
        pos_item_name: null,
        pos_item_id: null,
        serving_size: 1,
        estimated_cost: 8,
        is_active: true,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
        created_by: null,
      },
    ];

    const [enhanced] = buildEnhancedRecipes(recipes, [], [], []);

    expect(enhanced.estimated_cost).toBe(8);
    expect(enhanced.avg_sale_price).toBeUndefined();
    expect(enhanced.profit_margin).toBeUndefined();
    expect(enhanced.profit_per_serving).toBeUndefined();
  });
});
