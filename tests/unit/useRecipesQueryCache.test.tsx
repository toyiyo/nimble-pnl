import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';

// ---- Mocks -----------------------------------------------------------------
const toastMock = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('@/hooks/useAuth', () => {
  const user = { id: 'user-1' };
  return { useAuth: () => ({ user }) };
});

let recipesResponse: { data: unknown[] | null; error: unknown };

/** Counts terminal `.range()` calls on the recipes query -- one per actual
 * network fetch of the recipe list. */
let recipeFetches = 0;

vi.mock('@/integrations/supabase/client', () => {
  const thenable = (get: () => unknown) => Promise.resolve(get());
  return {
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
                        recipeFetches += 1;
                        return thenable(() => recipesResponse);
                      }),
                    }),
                  }),
                }),
              }),
              single: vi.fn().mockImplementation(() =>
                thenable(() => ({
                  data: {
                    id: 'new-recipe',
                    restaurant_id: 'rest-1',
                    name: 'New Recipe',
                    serving_size: 1,
                    estimated_cost: 0,
                    is_active: true,
                    created_at: '',
                    updated_at: '',
                  },
                  error: null,
                }))
              ),
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockImplementation(() =>
                  thenable(() => ({
                    data: {
                      id: 'new-recipe',
                      restaurant_id: 'rest-1',
                      name: 'New Recipe',
                      serving_size: 1,
                      estimated_cost: 0,
                      is_active: true,
                      created_at: '',
                      updated_at: '',
                    },
                    error: null,
                  }))
                ),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockImplementation(() => thenable(() => ({ data: null, error: null }))),
            }),
            upsert: vi.fn().mockImplementation(() => thenable(() => ({ data: null, error: null }))),
          };
        }
        if (table === 'prep_recipes') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                not: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    range: vi.fn().mockImplementation(() =>
                      thenable(() => ({ data: [], error: null }))
                    ),
                  }),
                }),
                eq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockImplementation(() =>
                      thenable(() => ({ data: null, error: null }))
                    ),
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
                  range: vi.fn().mockImplementation(() => thenable(() => ({ data: [], error: null }))),
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
                    range: vi.fn().mockImplementation(() =>
                      thenable(() => ({ data: [], error: null }))
                    ),
                  }),
                }),
              }),
            }),
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockImplementation(() => thenable(() => ({ data: null, error: null }))),
            }),
            insert: vi.fn().mockImplementation(() => thenable(() => ({ data: null, error: null }))),
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
  };
});

import { useRecipes, RECIPES_QUERY_KEY } from '@/hooks/useRecipes';
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

let queryClient: QueryClient;
let wrapper: ReturnType<typeof createQueryWrapper>['wrapper'];

beforeEach(() => {
  vi.clearAllMocks();
  recipeFetches = 0;
  recipesResponse = { data: [makeRecipe('r1', 'Burrito')], error: null };
  ({ wrapper, queryClient } = createQueryWrapper());
});

describe('useRecipes -- React Query cache', () => {
  it('exposes recipes and settles loading', async () => {
    const { result } = renderHook(() => useRecipes('rest-1'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.recipes.map((r) => r.id)).toEqual(['r1']);
  });

  it('two mount points sharing a restaurant fetch ONCE, not twice', async () => {
    // useRecipes is mounted at six independent points (Recipes, POSSales,
    // POSSaleDialog, MapPOSItemDialog, RecipeDialog, DeleteRecipeDialog).
    // Before the query-cache conversion each one ran the whole fetch itself.
    const first = renderHook(() => useRecipes('rest-1'), { wrapper });
    const second = renderHook(() => useRecipes('rest-1'), { wrapper });

    await waitFor(() => expect(first.result.current.loading).toBe(false));
    await waitFor(() => expect(second.result.current.loading).toBe(false));

    expect(recipeFetches).toBe(1);
    expect(second.result.current.recipes.map((r) => r.id)).toEqual(['r1']);
  });

  it('does not fetch at all without a restaurant id', async () => {
    const { result } = renderHook(() => useRecipes(null), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(recipeFetches).toBe(0);
    expect(result.current.recipes).toEqual([]);
  });

  it('surfaces isError when the fetch fails (distinct from an empty list)', async () => {
    recipesResponse = { data: null, error: { message: 'boom' } };

    const { result } = renderHook(() => useRecipes('rest-1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.recipes).toEqual([]);
  });
});

describe('useRecipes mutations -- every write invalidates the shared cache', () => {
  const expectInvalidated = async (
    run: (hook: ReturnType<typeof useRecipes>) => Promise<unknown>
  ) => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useRecipes('rest-1'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await run(result.current);

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [RECIPES_QUERY_KEY, 'rest-1'] })
    );
  };

  it('createRecipe invalidates', async () => {
    await expectInvalidated((hook) =>
      hook.createRecipe({
        name: 'New Recipe',
        serving_size: 1,
        restaurant_id: 'rest-1',
        ingredients: [],
      })
    );
  });

  it('updateRecipe invalidates', async () => {
    await expectInvalidated((hook) => hook.updateRecipe('r1', { name: 'Renamed' }));
  });

  it('updateRecipeIngredients invalidates', async () => {
    await expectInvalidated((hook) => hook.updateRecipeIngredients('r1', []));
  });

  it('deleteRecipe invalidates', async () => {
    await expectInvalidated((hook) => hook.deleteRecipe('r1'));
  });
});
