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
  mockFromChain.is.mockResolvedValue({ data, error });
}

beforeEach(() => {
  vi.clearAllMocks();

  mockFromChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn(),
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
