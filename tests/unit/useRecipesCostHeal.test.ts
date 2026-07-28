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

/** When set, `recipes.upsert()` REJECTS with this instead of resolving. */
 
let upsertRejection: Error | null = null;

/** Every payload handed to `recipes.upsert()` during a run. Length is the
 * write count -- the heal must issue at most ONE write per load, and zero
 * once costs have converged. */
let upsertCalls: unknown[][] = [];

/** Called synchronously inside the `recipes.upsert()` mock, before the write's
 * promise resolves — the seam a test needs to observe state *at write time*
 * rather than after the round trip. */
 
let observeUpsert: ((rows: { id: string }[]) => void) | null = null;

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
          upsert: vi.fn().mockImplementation((rows: { id: string }[]) => {
            upsertCalls.push(rows);
            observeUpsert?.(rows);
            // A PostgREST error resolves as `{ error }`; a dropped connection
            // rejects instead. Both are real, and only the second one can
            // escape as an unhandled rejection, so both need a seam.
            if (upsertRejection) return Promise.reject(upsertRejection);
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

import {
  useRecipes,
  selectDriftedCostRows,
  buildEnhancedRecipes,
  isHealEcho,
  resetHealEchoes,
  pendingHealEchoCount,
  recordHealEchoes,
  HEAL_ECHO_TTL_MS,
} from '@/hooks/useRecipes';
import { SUPABASE_MAX_ROWS } from '@/utils/fetchAllRows';
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

let wrapper: ReturnType<typeof createQueryWrapper>['wrapper'];

/** A page that is exactly `SUPABASE_MAX_ROWS` long looks "full" to
 * `fetchAllRows`, so it keeps paging; the mock hands back the same full page
 * every time, so the loop runs out at `DEFAULT_MAX_PAGES` and reports
 * `capped: true`. That is the truncated-input condition under test. */
const fullPageOf = <T>(row: T): T[] => Array.from({ length: SUPABASE_MAX_ROWS }, () => row);

beforeEach(() => {
  ({ wrapper } = createQueryWrapper());
  vi.clearAllMocks();
  resetHealEchoes();
  upsertCalls = [];
  observeUpsert = null;
  recipesResponse = { data: [], error: null };
  productsResponse = { data: PRODUCTS, error: null };
  ingredientsResponse = { data: INGREDIENTS, error: null };
  upsertResponse = { data: null, error: null };
  upsertRejection = null;
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

  // `estimated_cost` on an enhanced recipe is the *display* value, which falls
  // back to the stored cost when the computed sum is 0 (no ingredient carries a
  // price yet). Drift must be measured against the raw computed sum instead, or
  // a recipe that has genuinely fallen to zero compares equal to its own stale
  // stored value and can never heal -- the stale cost then feeds profit_margin
  // and profit_per_serving forever.
  it('heals a genuine zero: computed 0 against a stored 12.34 is drift', () => {
    const stored = [makeRecipe('r1', 'Burrito', 12.34)];
    const enhanced = [{ ...stored[0], estimated_cost: 12.34, computed_cost: 0 } as never];

    expect(selectDriftedCostRows(stored, enhanced)).toEqual([
      { id: 'r1', restaurant_id: 'rest-1', name: 'Burrito', estimated_cost: 0 },
    ]);
  });

  it('heals against the computed cost, not the display fallback', () => {
    const stored = [makeRecipe('r1', 'Burrito', 12.34)];
    const enhanced = [{ ...stored[0], estimated_cost: 12.34, computed_cost: 9.5 } as never];

    expect(selectDriftedCostRows(stored, enhanced)).toEqual([
      { id: 'r1', restaurant_id: 'rest-1', name: 'Burrito', estimated_cost: 9.5 },
    ]);
  });
});

describe('useRecipes cost heal -- batched, convergent', () => {
  it('issues exactly ONE upsert containing only the drifted rows', async () => {
    // r1 computes to $10.00 but is stored at $3.00 -> drift.
    // r3 computes to $10.00 and is stored at $10.00 -> converged, no drift.
    recipesResponse = {
      data: [makeRecipe('r1', 'Burrito', 3), makeRecipe('r3', 'Nachos', 10)],
      error: null,
    };
    ingredientsResponse = {
      data: [...INGREDIENTS, { id: 'i3', recipe_id: 'r3', product_id: 'p1', quantity: 2, unit: 'lb' }],
      error: null,
    };

    const { result } = renderHook(() => useRecipes('rest-1'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(upsertCalls.length).toBe(1));

    expect(upsertCalls[0]).toEqual([
      { id: 'r1', restaurant_id: 'rest-1', name: 'Burrito', estimated_cost: 10 },
    ]);
  });

  // Pre-refactor `main` returned 0 from calculateRecipeCost for an
  // ingredient-less recipe and wrote that 0 back (`updatedCost !== stored`).
  // The heal has to do the same, or a recipe whose ingredients were all removed
  // keeps billing against a stale cost forever.
  it('heals an ingredient-less recipe down to 0, matching the pre-refactor write', async () => {
    recipesResponse = { data: [makeRecipe('r2', 'Taco', 4)], error: null };
    ingredientsResponse = { data: [], error: null };

    const { result } = renderHook(() => useRecipes('rest-1'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(upsertCalls.length).toBe(1));

    expect(upsertCalls[0]).toEqual([
      { id: 'r2', restaurant_id: 'rest-1', name: 'Taco', estimated_cost: 0 },
    ]);
  });

  it('issues ZERO writes once costs have converged (stored cost already matches)', async () => {
    recipesResponse = { data: [makeRecipe('r1', 'Burrito', 10)], error: null };

    const { result } = renderHook(() => useRecipes('rest-1'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(upsertCalls).toEqual([]);
  });

  // End-to-end counterpart of the `selectDriftedCostRows` zero case: an
  // unpriced product makes the computed sum 0, and pre-refactor `main` wrote
  // that 0 back (its write used the raw cost, only its *display* used the
  // fallback). The screen still shows the last-known 12.34 on this load, then
  // reads 0 on the next -- exactly `main`'s sequence.
  it('writes back a computed zero when every ingredient product is unpriced', async () => {
    recipesResponse = { data: [makeRecipe('r1', 'Burrito', 12.34)], error: null };
    productsResponse = { data: [{ ...PRODUCTS[0], cost_per_unit: null }], error: null };

    const { result } = renderHook(() => useRecipes('rest-1'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(upsertCalls.length).toBe(1));

    expect(upsertCalls[0]).toEqual([
      { id: 'r1', restaurant_id: 'rest-1', name: 'Burrito', estimated_cost: 0 },
    ]);
    // Display keeps the last-known cost rather than flashing $0.00.
    expect(result.current.recipes[0].estimated_cost).toBe(12.34);
  });

  it('does not block the render: recipes are exposed with the freshly computed cost', async () => {
    recipesResponse = { data: [makeRecipe('r1', 'Burrito', 3)], error: null };

    const { result } = renderHook(() => useRecipes('rest-1'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.recipes).toHaveLength(1);
    expect(result.current.recipes[0].estimated_cost).toBe(10);
  });

  it('a heal rejected by RLS (view-only role) silently no-ops -- no error toast, recipes still render', async () => {
    recipesResponse = { data: [makeRecipe('r1', 'Burrito', 3)], error: null };
    upsertResponse = { data: null, error: { message: 'new row violates row-level security policy' } };

    const { result } = renderHook(() => useRecipes('rest-1'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(upsertCalls.length).toBe(1));

    expect(result.current.recipes).toHaveLength(1);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('arms the realtime echo guard BEFORE issuing the write, not after it resolves', async () => {
    // Postgres broadcasts the UPDATE at commit, so the realtime frame can beat
    // the upsert's HTTP promise. Standing in for that frame: ask the guard the
    // same question the subscription would, at the moment the write goes out.
    let echoRecognisedAtWriteTime: boolean | null = null;
    recipesResponse = { data: [makeRecipe('r1', 'Burrito', 3)], error: null };
    observeUpsert = (rows) => {
      echoRecognisedAtWriteTime = isHealEcho(rows[0].id);
    };

    const { result } = renderHook(() => useRecipes('rest-1'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(echoRecognisedAtWriteTime).not.toBeNull());

    expect(echoRecognisedAtWriteTime).toBe(true);
  });

  it('forgets the echo when the write fails, so the next genuine edit still refetches', async () => {
    recipesResponse = { data: [makeRecipe('r1', 'Burrito', 3)], error: null };
    upsertResponse = { data: null, error: { message: 'row-level security' } };

    const { result } = renderHook(() => useRecipes('rest-1'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(upsertCalls.length).toBe(1));

    // Nothing was written, so nothing will echo. A leftover armed id would
    // swallow the next real UPDATE to this recipe.
    expect(isHealEcho('r1')).toBe(false);
  });

  it('forgets the echo when the write REJECTS, and does not surface an unhandled rejection', async () => {
    // The offline case: PostgREST never answers, so the promise rejects rather
    // than resolving with `{ error }`. Same consequence -- nothing was written
    // -- but a different code path, and the only one that can escape the
    // fire-and-forget call site as an unhandled rejection.
    recipesResponse = { data: [makeRecipe('r1', 'Burrito', 3)], error: null };
    upsertRejection = new Error('Failed to fetch');

    const unhandled: unknown[] = [];
    const onUnhandled = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      unhandled.push(event.reason);
    };
    window.addEventListener('unhandledrejection', onUnhandled);
    try {
      const { result } = renderHook(() => useRecipes('rest-1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));
      await waitFor(() => expect(upsertCalls.length).toBe(1));

      // The heal is background work; a failed one must not take the page down.
      expect(result.current.recipes).toHaveLength(1);
      expect(isHealEcho('r1')).toBe(false);

      // Give a rejection a full macrotask to surface before declaring none did.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      window.removeEventListener('unhandledrejection', onUnhandled);
    }
  });

  it('writes NOTHING when recipe_ingredients came back truncated', async () => {
    // A capped ingredients page means lines are missing, so the computed cost
    // is understated. Displaying a wrong number is recoverable; writing it to
    // the database is not -- every later load would read it back as truth.
    recipesResponse = { data: [makeRecipe('r1', 'Burrito', 3)], error: null };
    ingredientsResponse = { data: fullPageOf(INGREDIENTS[0]), error: null };

    const { result } = renderHook(() => useRecipes('rest-1'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(upsertCalls).toEqual([]);
  });

  it('writes NOTHING when products came back truncated', async () => {
    // Same hazard from the other input: a missing product means its
    // ingredient contributes $0, silently understating the recipe.
    recipesResponse = { data: [makeRecipe('r1', 'Burrito', 3)], error: null };
    productsResponse = { data: fullPageOf(PRODUCTS[0]), error: null };

    const { result } = renderHook(() => useRecipes('rest-1'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(upsertCalls).toEqual([]);
  });

  it('still renders the recipes when an input was truncated -- degraded, not broken', async () => {
    recipesResponse = { data: [makeRecipe('r1', 'Burrito', 3)], error: null };
    ingredientsResponse = { data: fullPageOf(INGREDIENTS[0]), error: null };

    const { result } = renderHook(() => useRecipes('rest-1'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.recipes).toHaveLength(1);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('healed costs match the cost buildEnhancedRecipes computed', async () => {
    const stored = [makeRecipe('r1', 'Burrito', 3)];
    recipesResponse = { data: stored, error: null };
    const [expected] = buildEnhancedRecipes(stored, INGREDIENTS, PRODUCTS, []);

    const { result } = renderHook(() => useRecipes('rest-1'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(upsertCalls.length).toBe(1));

    // `computed_cost`, not `estimated_cost`: the two agree here (the computed
    // sum is non-zero, so no fallback applies) but only the former is what the
    // heal is contracted to persist.
    expect((upsertCalls[0][0] as { estimated_cost: number }).estimated_cost).toBe(
      expected.computed_cost
    );
  });
});

describe('heal echo bookkeeping -- the map does not grow without bound', () => {
  // `isHealEcho` is the only consumer that deletes, and it only runs when the
  // matching realtime frame actually arrives. If the channel is down (or the
  // row is filtered out before the handler sees it), the armed id is never
  // collected and parks for the life of the tab. Every later heal adds more.
  it('drops entries whose TTL has lapsed when the next heal arms', () => {
    vi.useFakeTimers();
    try {
      recordHealEchoes(['stale-1', 'stale-2']);
      expect(pendingHealEchoCount()).toBe(2);

      // Past the TTL: these two can never be recognised as echoes again.
      vi.advanceTimersByTime(HEAL_ECHO_TTL_MS + 1);
      recordHealEchoes(['fresh-1']);

      expect(pendingHealEchoCount()).toBe(1);
      expect(isHealEcho('fresh-1')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps entries that are still within their TTL', () => {
    vi.useFakeTimers();
    try {
      recordHealEchoes(['recent-1']);
      vi.advanceTimersByTime(HEAL_ECHO_TTL_MS - 1);
      recordHealEchoes(['recent-2']);

      expect(pendingHealEchoCount()).toBe(2);
      expect(isHealEcho('recent-1')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
