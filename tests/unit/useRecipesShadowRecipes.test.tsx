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

// Configurable per-test responses
let recipesResponse: { data: unknown[] | null; error: unknown };
let prepLinksResponse: { data: unknown[] | null; error: unknown };
let prepLinkSingleResponse: { data: unknown | null; error: unknown };
const recipesUpdateMock = vi.fn().mockReturnValue({
  eq: vi.fn().mockResolvedValue({ error: null }),
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'recipes') {
        return {
          // fetch chain: .select().eq().eq().order()
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockImplementation(() => Promise.resolve(recipesResponse)),
              }),
            }),
          }),
          // deleteRecipe chain: .update().eq()
          update: recipesUpdateMock,
        };
      }
      if (table === 'prep_recipes') {
        return {
          select: vi.fn().mockReturnValue({
            // fetch chain: .select('recipe_id').eq().not()
            // deleteRecipe guard chain: .select('name').eq('recipe_id', id).eq('restaurant_id', restaurantId).limit().maybeSingle()
            eq: vi.fn().mockReturnValue({
              not: vi.fn().mockImplementation(() => Promise.resolve(prepLinksResponse)),
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockImplementation(() => Promise.resolve(prepLinkSingleResponse)),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'recipe_ingredients') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      // unified_sales & anything else: benign empty result
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
  ingredients: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  recipesResponse = { data: [], error: null };
  prepLinksResponse = { data: [], error: null };
  prepLinkSingleResponse = { data: null, error: null };
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

  it('fails closed: prep_recipes query error -> no recipes leak, error toast fires', async () => {
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
  it('blocks deleting a prep-linked recipe: destructive toast, returns false, no update', async () => {
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
