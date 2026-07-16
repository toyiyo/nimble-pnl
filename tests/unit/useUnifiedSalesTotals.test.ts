import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { ReactNode } from 'react';

const { mockSupabase } = vi.hoisted(() => ({
  mockSupabase: { rpc: vi.fn() },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

import { useUnifiedSalesTotals } from '@/hooks/useUnifiedSalesTotals';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useUnifiedSalesTotals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes uncategorizedCount and pendingReviewCount from the RPC row', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [
        {
          total_count: 50,
          revenue: 1234.56,
          discounts: 10,
          voids: 0,
          pass_through_amount: 78.9,
          unique_items: 12,
          collected_at_pos: 1323.46,
          uncategorized_count: 3,
          pending_review_count: 1,
        },
      ],
      error: null,
    });

    const { result } = renderHook(
      () => useUnifiedSalesTotals('rest-1', { startDate: '2024-07-01', endDate: '2024-07-31' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.totals.uncategorizedCount).toBe(3);
    expect(result.current.totals.pendingReviewCount).toBe(1);
    expect(result.current.totals.totalCount).toBe(50);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_unified_sales_totals', {
      p_restaurant_id: 'rest-1',
      p_start_date: '2024-07-01',
      p_end_date: '2024-07-31',
      p_search_term: null,
      p_pos_system: null,
    });
  });

  it('passes sourceFilter through to the RPC when provided', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [
        {
          total_count: 10,
          revenue: 100,
          discounts: 5,
          pass_through_amount: 2,
          unique_items: 4,
          collected_at_pos: 97,
          uncategorized_count: 1,
          pending_review_count: 0,
        },
      ],
      error: null,
    });

    const { result } = renderHook(
      () => useUnifiedSalesTotals('rest-1', { sourceFilter: 'toast' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_unified_sales_totals', {
      p_restaurant_id: 'rest-1',
      p_start_date: null,
      p_end_date: null,
      p_search_term: null,
      p_pos_system: 'toast',
    });
  });

  it('coerces missing categorization columns to 0', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [
        {
          total_count: 1,
          revenue: 10,
          discounts: 0,
          pass_through_amount: 0,
          unique_items: 1,
          collected_at_pos: 10,
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useUnifiedSalesTotals('rest-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.totals.uncategorizedCount).toBe(0);
    expect(result.current.totals.pendingReviewCount).toBe(0);
  });

  it('returns zero-default shape when restaurantId is null without calling RPC', async () => {
    const { result } = renderHook(() => useUnifiedSalesTotals(null), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.totals.uncategorizedCount).toBe(0);
    expect(result.current.totals.pendingReviewCount).toBe(0);
    expect(result.current.totals.totalCount).toBe(0);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });
});
