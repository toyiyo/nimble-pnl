import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
let productsResponse: { data: unknown[] | null; error: unknown };
let ingredientsResponse: { data: unknown[] | null; error: unknown };

/** One entry per terminal `.range()` on the recipes list -- i.e. per real
 * network fetch of the recipe list. */
let recipeFetches = 0;

/** Realtime handlers registered by the hook, keyed by the table they watch. */
let realtimeHandlers: Array<{ table: string; cb: (payload: unknown) => void }> = [];

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
                      recipeFetches += 1;
                      return Promise.resolve(recipesResponse);
                    }),
                  }),
                }),
              }),
            }),
          }),
          upsert: vi.fn().mockImplementation(() => Promise.resolve({ data: null, error: null })),
        };
      }
      if (table === 'prep_recipes') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              not: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  range: vi.fn().mockImplementation(() =>
                    Promise.resolve({ data: [], error: null })
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
    channel: vi.fn(() => {
      const chan = {
        on: vi.fn(
          (
            _event: string,
            config: { table: string },
            cb: (payload: unknown) => void
          ) => {
            realtimeHandlers.push({ table: config.table, cb });
            return chan;
          }
        ),
        subscribe: vi.fn(() => chan),
      };
      return chan;
    }),
    removeChannel: vi.fn(),
  },
}));

import { supabase } from '@/integrations/supabase/client';
import {
  useRecipes,
  RECIPES_QUERY_KEY,
  recordHealEchoes,
  isHealEcho,
  resetHealEchoes,
} from '@/hooks/useRecipes';
import { createQueryWrapper } from './helpers/queryWrapper';

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

// $5.00/lb chicken x 2 lb -> a computed cost of exactly $10.00.
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

const fire = (table: string, payload: unknown) => {
  for (const handler of realtimeHandlers) {
    if (handler.table === table) handler.cb(payload);
  }
};

let queryClient: QueryClient;
let wrapper: ReturnType<typeof createQueryWrapper>['wrapper'];

beforeEach(() => {
  vi.clearAllMocks();
  resetHealEchoes();
  recipeFetches = 0;
  realtimeHandlers = [];
  // Converged by default so the heal stays out of the way unless a test wants it.
  recipesResponse = { data: [makeRecipe('r1', 'Burrito', 10)], error: null };
  productsResponse = { data: PRODUCTS, error: null };
  ingredientsResponse = { data: INGREDIENTS, error: null };
  ({ wrapper, queryClient } = createQueryWrapper());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isHealEcho -- consume-once with a TTL', () => {
  it('recognises a recorded id exactly once', () => {
    recordHealEchoes(['r1']);

    expect(isHealEcho('r1')).toBe(true);
    // A genuine edit to the same recipe moments later must still count.
    expect(isHealEcho('r1')).toBe(false);
  });

  it('does not recognise an id no heal wrote', () => {
    expect(isHealEcho('r-never-healed')).toBe(false);
  });

  it('does not recognise a missing id', () => {
    expect(isHealEcho(undefined)).toBe(false);
    expect(isHealEcho(null)).toBe(false);
  });

  it('stops recognising an id once the echo window has passed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T00:00:00Z'));
    recordHealEchoes(['r1']);

    // The echo never arrived; a real edit 30s later must not be swallowed.
    vi.setSystemTime(new Date('2026-07-27T00:00:30Z'));
    expect(isHealEcho('r1')).toBe(false);
  });
});

describe('useRecipes realtime -- invalidate, do not refetch directly', () => {
  it('a recipes change invalidates the shared cache key', async () => {
    const { result } = renderHook(() => useRecipes('rest-1'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    fire('recipes', { new: { id: 'r-other' }, old: {} });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: [RECIPES_QUERY_KEY, 'rest-1'],
    });
  });

  it('a prep_recipes change invalidates too (shadow links gate what is visible)', async () => {
    const { result } = renderHook(() => useRecipes('rest-1'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    fire('prep_recipes', { new: { id: 'pr-1' }, old: {} });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: [RECIPES_QUERY_KEY, 'rest-1'],
    });
  });

  it('one invalidation serves every mount point instead of one fetch each', async () => {
    const first = renderHook(() => useRecipes('rest-1'), { wrapper });
    const second = renderHook(() => useRecipes('rest-1'), { wrapper });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(recipeFetches).toBe(1);

    fire('recipes', { new: { id: 'r-other' }, old: {} });

    // Both mounts refresh off a single refetch, not one per mount.
    await waitFor(() => expect(recipeFetches).toBe(2));
    expect(recipeFetches).toBe(2);
  });

  it('CRITICAL: the echo of our own cost heal does not trigger a refetch', async () => {
    // r1 computes to $10.00 but is stored at $3.00, so the load heals it and
    // the heal UPDATE echoes straight back over realtime. Refetching on that
    // echo re-runs the heal -> write -> echo -> refetch stampede.
    recipesResponse = { data: [makeRecipe('r1', 'Burrito', 3)], error: null };

    const { result } = renderHook(() => useRecipes('rest-1'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(recipeFetches).toBe(1));

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    fire('recipes', { new: { id: 'r1' }, old: {} });

    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(recipeFetches).toBe(1);
  });

  it('a genuine change to a recipe healed earlier still refetches', async () => {
    recipesResponse = { data: [makeRecipe('r1', 'Burrito', 3)], error: null };

    const { result } = renderHook(() => useRecipes('rest-1'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(recipeFetches).toBe(1));

    fire('recipes', { new: { id: 'r1' }, old: {} }); // the heal's own echo
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    fire('recipes', { new: { id: 'r1' }, old: {} }); // a real edit after it

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: [RECIPES_QUERY_KEY, 'rest-1'],
    });
  });

  it('six mount points share ONE channel, not one subscription each', async () => {
    const first = renderHook(() => useRecipes('rest-1'), { wrapper });
    renderHook(() => useRecipes('rest-1'), { wrapper });
    await waitFor(() => expect(first.result.current.loading).toBe(false));

    expect(supabase.channel).toHaveBeenCalledTimes(1);
  });

  it('the channel closes only when the LAST mount point unmounts', async () => {
    const first = renderHook(() => useRecipes('rest-1'), { wrapper });
    const second = renderHook(() => useRecipes('rest-1'), { wrapper });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    await waitFor(() => expect(second.result.current.loading).toBe(false));

    first.unmount();
    expect(supabase.removeChannel).not.toHaveBeenCalled();

    second.unmount();
    expect(supabase.removeChannel).toHaveBeenCalledTimes(1);
  });

  it('a DELETE, which carries only `old`, still invalidates', async () => {
    const { result } = renderHook(() => useRecipes('rest-1'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    fire('recipes', { new: {}, old: { id: 'r-deleted' } });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: [RECIPES_QUERY_KEY, 'rest-1'],
    });
  });
});
