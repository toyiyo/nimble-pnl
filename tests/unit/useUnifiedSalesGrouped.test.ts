import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { ReactNode } from 'react';

const { mockSupabase } = vi.hoisted(() => ({ mockSupabase: { rpc: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: mockSupabase }));

import { useUnifiedSalesGrouped } from '@/hooks/useUnifiedSalesGrouped';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useUnifiedSalesGrouped', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps options to RPC params and returns coerced groups', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [
        { item_name: 'Burger', total_quantity: '3', total_revenue: '20', sale_count: '2' },
      ],
      error: null,
    });

    const { result } = renderHook(
      () => useUnifiedSalesGrouped('rest-1', {
        startDate: '2024-08-01', endDate: '2024-08-01',
        searchTerm: 'bur', categorizationFilter: 'all',
        recipeFilter: 'with-recipe', sortBy: 'revenue', sortDirection: 'desc',
      }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_unified_sales_grouped_by_item', {
      p_restaurant_id: 'rest-1',
      p_start_date: '2024-08-01',
      p_end_date: '2024-08-01',
      p_search_term: 'bur',
      p_categorization_filter: 'all',
      p_recipe_filter: 'with-recipe',
      p_sort_by: 'revenue',
      p_sort_direction: 'desc',
    });
    expect(result.current.groups).toEqual([
      { item_name: 'Burger', total_quantity: 3, total_revenue: 20, sale_count: 2 },
    ]);
  });

  it('returns empty groups without calling RPC when restaurantId is null', async () => {
    const { result } = renderHook(() => useUnifiedSalesGrouped(null), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.groups).toEqual([]);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });
});
