import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// ---- Mocks -----------------------------------------------------------------
const toastMock = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

// The user object must be referentially stable across renders: `fetchRecipes`
// is a useCallback keyed on `user`, so a fresh object per render would churn its
// identity and re-fire the fetch effect forever.
vi.mock('@/hooks/useAuth', () => {
  const user = { id: 'user-1' };
  return { useAuth: () => ({ user }) };
});

let recipesResponse: { data: unknown[] | null; error: unknown };
let productsResponse: { data: unknown[] | null; error: unknown };
let ingredientsResponse: { data: unknown[] | null; error: unknown };
let upsertResponse: { data: unknown[] | null; error: unknown };

/** Every payload handed to `recipes.upsert()` during a run. Length is the
 * write count -- the heal must issue at most ONE write per load, and zero
 * once costs have converged. */
let upsertCalls: unknown[][] = [];

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
                    range: vi.fn().mockImplementation(() => Promise.resolve(recipesResponse)),
                  }),
                }),
              }),
            }),
          }),
          upsert: vi.fn().mockImplementation((rows: unknown[]) => {
            upsertCalls.push(rows);
            return Promise.resolve(upsertResponse);
          }),
        };
      }
      if (table === 'prep_recipes') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              not: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  range: vi.fn().mockImplementation(() => Promise.resolve({ data: [], error: null })),
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
                range: vi.fn().mockImplementation(() => Promise.resolve(productsResponse)),
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
                  range: vi.fn().mockImplementation(() => Promise.resolve(ingredientsResponse)),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    }),
    rpc: vi.fn().mockReturnValue({
      range: vi.fn().mockImplementation(() => Promise.resolve({ data: [], error: null })),
    }),
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    }),
    removeChannel: vi.fn(),
  },
}));

import { useRecipes, selectDriftedCostRows, buildEnhancedRecipes } from '@/hooks/useRecipes';

const makeRecipe = (id: string, name: string, estimatedCost: number) => ({
  id,
  restaurant_id: 'rest-1',
  name,
  description: null,
  pos_item_name: null,
  pos_item_id: null,
  serving_size: 1,
  estimated_cost: estimatedCost,
  is_active: true,
  created_at: '',
  updated_at: '',
  created_by: null,
});

// $5.00/lb chicken, 2 lb in the recipe -> a computed cost of exactly $10.00.
const PRODUCTS = [
  {
    id: 'p1',
    name: 'Chicken',
    cost_per_unit: 5,
    uom_purchase: 'lb',
    size_value: null,
    size_unit: null,
    package_qty: null,
  },
];
const INGREDIENTS = [{ id: 'i1', recipe_id: 'r1', product_id: 'p1', quantity: 2, unit: 'lb' }];

beforeEach(() => {
  vi.clearAllMocks();
  upsertCalls = [];
  recipesResponse = { data: [], error: null };
  productsResponse = { data: PRODUCTS, error: null };
  ingredientsResponse = { data: INGREDIENTS, error: null };
  upsertResponse = { data: null, error: null };
});

describe('selectDriftedCostRows -- rounded comparison', () => {
  it('treats a sub-half-cent difference as no drift (float noise, not a real change)', () => {
    const stored = [makeRecipe('r1', 'Burrito', 12.34)];
    const enhanced = [{ ...stored[0], estimated_cost: 12.340000000000002 } as never];

    expect(selectDriftedCostRows(stored, enhanced)).toEqual([]);
  });

  it('treats a difference just under half a cent as no drift', () => {
    const stored = [makeRecipe('r1', 'Burrito', 12.34)];
    const enhanced = [{ ...stored[0], estimated_cost: 12.3449 } as never];

    expect(selectDriftedCostRows(stored, enhanced)).toEqual([]);
  });

  it('treats a half-cent-or-larger difference as real drift', () => {
    const stored = [makeRecipe('r1', 'Burrito', 12.34)];
    const enhanced = [{ ...stored[0], estimated_cost: 12.35 } as never];

    expect(selectDriftedCostRows(stored, enhanced)).toEqual([
      { id: 'r1', restaurant_id: 'rest-1', name: 'Burrito', estimated_cost: 12.35 },
    ]);
  });

  it('returns only the drifted rows, not every recipe', () => {
    const stored = [
      makeRecipe('r1', 'Burrito', 12.34),
      makeRecipe('r2', 'Taco', 4.0),
      makeRecipe('r3', 'Nachos', 7.5),
    ];
    const enhanced = [
      { ...stored[0], estimated_cost: 12.34 },
      { ...stored[1], estimated_cost: 4.75 },
      { ...stored[2], estimated_cost: 7.5 },
    ] as never[];

    expect(selectDriftedCostRows(stored, enhanced).map((row) => row.id)).toEqual(['r2']);
  });

  it('a recipe whose stored cost is NULL and whose computed cost is 0 is not drift', () => {
    const stored = [{ ...makeRecipe('r1', 'Burrito', 0), estimated_cost: null }];
    const enhanced = [{ ...stored[0], estimated_cost: 0 } as never];

    expect(selectDriftedCostRows(stored as never[], enhanced)).toEqual([]);
  });
});

describe('useRecipes cost heal -- batched, convergent', () => {
  it('issues exactly ONE upsert containing only the drifted rows', async () => {
    // r1 computes to $10.00 but is stored at $3.00 -> drift.
    // r2 has no ingredients, so it keeps its stored cost -> no drift.
    recipesResponse = {
      data: [makeRecipe('r1', 'Burrito', 3), makeRecipe('r2', 'Taco', 4)],
      error: null,
    };

    const { result } = renderHook(() => useRecipes('rest-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(upsertCalls.length).toBe(1));

    expect(upsertCalls[0]).toEqual([
      { id: 'r1', restaurant_id: 'rest-1', name: 'Burrito', estimated_cost: 10 },
    ]);
  });

  it('issues ZERO writes once costs have converged (stored cost already matches)', async () => {
    recipesResponse = { data: [makeRecipe('r1', 'Burrito', 10)], error: null };

    const { result } = renderHook(() => useRecipes('rest-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(upsertCalls).toEqual([]);
  });

  it('does not block the render: recipes are exposed with the freshly computed cost', async () => {
    recipesResponse = { data: [makeRecipe('r1', 'Burrito', 3)], error: null };

    const { result } = renderHook(() => useRecipes('rest-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.recipes).toHaveLength(1);
    expect(result.current.recipes[0].estimated_cost).toBe(10);
  });

  it('a heal rejected by RLS (view-only role) silently no-ops -- no error toast, recipes still render', async () => {
    recipesResponse = { data: [makeRecipe('r1', 'Burrito', 3)], error: null };
    upsertResponse = { data: null, error: { message: 'new row violates row-level security policy' } };

    const { result } = renderHook(() => useRecipes('rest-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(upsertCalls.length).toBe(1));

    expect(result.current.recipes).toHaveLength(1);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('healed costs match what buildEnhancedRecipes computed (heal writes the displayed value)', async () => {
    const stored = [makeRecipe('r1', 'Burrito', 3)];
    recipesResponse = { data: stored, error: null };
    const [expected] = buildEnhancedRecipes(stored, INGREDIENTS, PRODUCTS, []);

    const { result } = renderHook(() => useRecipes('rest-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(upsertCalls.length).toBe(1));

    expect((upsertCalls[0][0] as { estimated_cost: number }).estimated_cost).toBe(
      expected.estimated_cost
    );
  });
});
