import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useProductRecipeUsageCount } from '../../src/hooks/useProductRecipeUsageCount';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

let mockFromChain: Record<string, ReturnType<typeof vi.fn>>;

function setupChain(data: unknown[] | null, error: Error | null = null) {
  mockFromChain.range.mockResolvedValue({ data, error });
}

/** Queues one response per call to `.range()`, for a multi-page fetch. */
function setupPages(...pages: unknown[][]) {
  for (const page of pages) {
    mockFromChain.range.mockResolvedValueOnce({ data: page, error: null });
  }
}

beforeEach(() => {
  vi.clearAllMocks();

  mockFromChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn(),
  };

  mockSupabase.from.mockReturnValue(mockFromChain);

  setupChain([]);
});

describe('useProductRecipeUsageCount', () => {
  it('counts distinct recipes, not ingredient lines, for the product', async () => {
    // The same recipe appears twice (two ingredient lines) and must count once.
    setupChain([
      { recipe_id: 'recipe-1' },
      { recipe_id: 'recipe-1' },
      { recipe_id: 'recipe-2' },
    ]);

    const { result } = renderHook(() => useProductRecipeUsageCount('rest-123', 'product-456'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.count).toBe(2);
    expect(mockSupabase.from).toHaveBeenCalledWith('recipe_ingredients');
    expect(mockFromChain.select).toHaveBeenCalledWith('recipe_id, recipe:recipes!inner(restaurant_id)');
    expect(mockFromChain.eq).toHaveBeenCalledWith('product_id', 'product-456');
    expect(mockFromChain.eq).toHaveBeenCalledWith('recipe.restaurant_id', 'rest-123');
    expect(mockFromChain.is).toHaveBeenCalledWith('yield_pct_override', null);
    expect(mockFromChain.order).toHaveBeenCalledWith('id', { ascending: true });
  });

  it('counts each recipe once when duplicate ingredient lines span pages', async () => {
    // recipe-1 appears on page one and again on page two (two ingredient
    // lines for the same recipe, split across the 1000-row page boundary).
    const pageOne = Array.from({ length: 1000 }, () => ({ recipe_id: 'recipe-1' }));
    const pageTwo = [{ recipe_id: 'recipe-1' }, { recipe_id: 'recipe-2' }];
    setupPages(pageOne, pageTwo);

    const { result } = renderHook(() => useProductRecipeUsageCount('rest-123', 'product-456'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.count).toBe(2);
    expect(mockFromChain.range).toHaveBeenCalledTimes(2);
  });

  it('returns zero when the product is used in no recipe', async () => {
    setupChain([]);

    const { result } = renderHook(() => useProductRecipeUsageCount('rest-123', 'product-456'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.count).toBe(0);
  });

  it('does not query when restaurantId is null', async () => {
    const { result } = renderHook(() => useProductRecipeUsageCount(null, 'product-456'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(result.current.count).toBe(0);
  });

  it('does not query when productId is null', async () => {
    const { result } = renderHook(() => useProductRecipeUsageCount('rest-123', null), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(result.current.count).toBe(0);
  });

  it('surfaces query errors', async () => {
    setupChain(null, new Error('Database error'));

    const { result } = renderHook(() => useProductRecipeUsageCount('rest-123', 'product-456'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.count).toBe(0);
  });
});
