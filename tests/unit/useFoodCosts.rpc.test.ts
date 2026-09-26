import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const rpcMock = vi.fn(() =>
  Promise.resolve({
    data: [
      { day: '2026-08-01', food_cost: 1000 },
      { day: '2026-08-02', food_cost: 5 },
    ],
    error: null,
  })
);

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

describe('useFoodCosts (RPC wrapper)', () => {
  beforeEach(() => {
    rpcMock.mockClear();
  });

  it('makes one RPC call, maps the rows, and never reports capped', async () => {
    const { useFoodCosts } = await import('@/hooks/useFoodCosts');

    const { result } = renderHook(
      () => useFoodCosts('rest-1', new Date(2026, 7, 1), new Date(2026, 7, 27)),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('get_inventory_usage_by_day', {
      p_restaurant_id: 'rest-1',
      p_start_date: '2026-08-01',
      p_end_date: '2026-08-27',
    });
    expect(result.current.dailyCosts).toEqual([
      { date: '2026-08-01', total_cost: 1000 },
      { date: '2026-08-02', total_cost: 5 },
    ]);
    expect(result.current.totalCost).toBe(1005);
    expect(result.current.capped).toBe(false);
  });
});
