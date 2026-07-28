import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// ---- Mocks -----------------------------------------------------------------
const toastMock = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

// Stable reference: a fresh object literal per call would give fetchRecipes'
// useCallback a new `user` dependency every render, cascading into a
// setLoading(true)->render->refetch loop that never settles.
const authUser = { id: 'user-1' };
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: authUser }),
}));

// Configurable per-test responses. Query shapes below mirror the bulk
// fetchRecipes implementation (design doc §3, Q1/Q2/Q3/Q4/Q5): every list
// query is paginated via a terminal `.range()`, and recipe_ingredients (Q3)
// is fetched with `.in('recipe_id', chunk)` rather than one query per recipe.
let recipesResponse: { data: unknown[] | null; error: unknown };
let prepLinksResponse: { data: unknown[] | null; error: unknown };
let prepLinkSingleResponse: { data: unknown | null; error: unknown };
let productsResponse: { data: unknown[] | null; error: unknown };
let ingredientsResponse: { data: unknown[] | null; error: unknown };
let salesStatsResponse: { data: unknown[] | null; error: unknown };
const recipesUpdateMock = vi.fn().mockReturnValue({
  eq: vi.fn().mockResolvedValue({ error: null }),
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'recipes') {
        return {
          // Q1: .select(cols).eq('restaurant_id').eq('is_active', true).order('name').order('id').range(from, to)
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  order: vi.fn().mockImplementation(() => ({
                    range: vi.fn().mockImplementation(() => Promise.resolve(recipesResponse)),
                  })),
                }),
              }),
            }),
          }),
          // deleteRecipe chain: .update({ is_active: false }).eq(id)
          update: recipesUpdateMock,
        };
      }
      if (table === 'prep_recipes') {
        return {
          select: vi.fn().mockReturnValue({
            // Routed by which column the first .eq() call targets, matching
            // the two real call sites: Q2's fetch chain starts with
            // .eq('restaurant_id', ...); deleteRecipe's guard chain starts
            // with .eq('recipe_id', ...).
            eq: vi.fn().mockImplementation((column: string) => {
              if (column === 'restaurant_id') {
                // Q2: .eq('restaurant_id', id).not('recipe_id', 'is', null).order('id').range(from, to)
                return {
                  not: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      range: vi.fn().mockImplementation(() => Promise.resolve(prepLinksResponse)),
                    }),
                  }),
                };
              }
              // deleteRecipe guard: .eq('recipe_id', id).eq('restaurant_id', restaurantId).limit(1).maybeSingle()
              return {
                eq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockImplementation(() => Promise.resolve(prepLinkSingleResponse)),
                  }),
                }),
              };
            }),
          }),
        };
      }
      if (table === 'products') {
        return {
          // Q4: .select(cols).eq('restaurant_id').order('id').range(from, to)
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
          // Q3: .select(cols).in('recipe_id', chunk).order('recipe_id').order('id').range(from, to)
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
      // Anything else: benign empty result
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              not: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      };
    }),
    // Q5: .rpc('get_recipe_sales_stats', { p_restaurant_id }).range(from, to)
    rpc: vi.fn().mockReturnValue({
      range: vi.fn().mockImplementation(() => Promise.resolve(salesStatsResponse)),
    }),
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    }),
    removeChannel: vi.fn(),
  },
}));

import { useRecipes } from '@/hooks/useRecipes';

const makeRecipe = (id: string, name: string) => ({
  id,
  restaurant_id: 'rest-1',
  name,
  serving_size: 1,
  estimated_cost: 0,
  is_active: true,
  created_at: '',
  updated_at: '',
});

beforeEach(() => {
  vi.clearAllMocks();
  recipesResponse = { data: [], error: null };
  prepLinksResponse = { data: [], error: null };
  prepLinkSingleResponse = { data: null, error: null };
  productsResponse = { data: [], error: null };
  ingredientsResponse = { data: [], error: null };
  salesStatsResponse = { data: [], error: null };
});

describe('useRecipes shadow-recipe filtering (fetchRecipes)', () => {
  it('excludes recipes whose ids appear in prep_recipes.recipe_id', async () => {
    recipesResponse = {
      data: [makeRecipe('r-menu', 'Menu Item'), makeRecipe('r-shadow', 'Sweet Cream - pans')],
      error: null,
    };
    prepLinksResponse = { data: [{ recipe_id: 'r-shadow' }], error: null };

    const { result } = renderHook(() => useRecipes('rest-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.recipes.map((r) => r.id)).toEqual(['r-menu']);
  });

  it('CRITICAL: fails closed: prep_recipes query error -> no recipes leak, error toast fires', async () => {
    recipesResponse = {
      data: [makeRecipe('r-menu', 'Menu Item'), makeRecipe('r-shadow', 'Sweet Cream - pans')],
      error: null,
    };
    prepLinksResponse = { data: null, error: { message: 'prep_recipes unavailable' } };

    const { result } = renderHook(() => useRecipes('rest-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.recipes).toEqual([]);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' })
    );
  });

  it('fails closed on a later refetch: stale recipes from a prior successful fetch are cleared, not left on screen', async () => {
    recipesResponse = {
      data: [makeRecipe('r-menu', 'Menu Item')],
      error: null,
    };
    prepLinksResponse = { data: [], error: null };

    const { result, rerender } = renderHook(
      ({ restaurantId }: { restaurantId: string }) => useRecipes(restaurantId),
      { initialProps: { restaurantId: 'rest-1' } }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.recipes.map((r) => r.id)).toEqual(['r-menu']);

    // Simulate switching restaurants (or a realtime refetch) where the new
    // prep_recipes query fails. Stale data from the prior successful fetch
    // must not remain visible.
    prepLinksResponse = { data: null, error: { message: 'prep_recipes unavailable' } };
    rerender({ restaurantId: 'rest-2' });

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' })
    ));
    expect(result.current.recipes).toEqual([]);
  });
});

describe('useRecipes shadow-recipe guard (deleteRecipe)', () => {
  it('CRITICAL: blocks deleting a prep-linked recipe: destructive toast, returns false, no update', async () => {
    prepLinkSingleResponse = { data: { name: 'Sweet Cream - pans' }, error: null };

    const { result } = renderHook(() => useRecipes('rest-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let deleted: boolean | undefined;
    await act(async () => {
      deleted = await result.current.deleteRecipe('r-shadow');
    });

    expect(deleted).toBe(false);
    expect(recipesUpdateMock).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
        description: expect.stringContaining('Sweet Cream - pans'),
      })
    );
  });

  it('still soft-deletes a normal recipe', async () => {
    prepLinkSingleResponse = { data: null, error: null };

    const { result } = renderHook(() => useRecipes('rest-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let deleted: boolean | undefined;
    await act(async () => {
      deleted = await result.current.deleteRecipe('r-menu');
    });

    expect(deleted).toBe(true);
    expect(recipesUpdateMock).toHaveBeenCalledWith({ is_active: false });
  });
});
