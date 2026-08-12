import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: rpcMock } }));

import { useLaborSalesAnalytics } from '@/hooks/useLaborSalesAnalytics';

const RPC = {
  daily: [{ sale_date: '2026-07-06', revenue: 400 }],
  grid: [{ dow: 1, hour: 17, revenue: 400 }],
  by_weekday: [{ dow: 1, revenue: 400 }],
  has_hourly: true,
};

const createWrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useLaborSalesAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-14T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls the RPC with the restaurant-local window and returns the aggregate', async () => {
    rpcMock.mockResolvedValue({ data: RPC, error: null });
    const { result } = renderHook(() => useLaborSalesAnalytics('rest-1', 'UTC', 18), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith('get_labor_sales_analytics', {
      p_restaurant_id: 'rest-1',
      p_start_date: '2026-03-10',
      p_end_date: '2026-07-14',
      p_time_zone: 'UTC',
    });
    expect(result.current.data).toEqual(RPC);
  });

  it('does not fetch when restaurantId is null', () => {
    rpcMock.mockResolvedValue({ data: RPC, error: null });
    const { result } = renderHook(() => useLaborSalesAnalytics(null, 'UTC', 18), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('throws when the RPC returns an error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error('rpc failed') });
    const { result } = renderHook(() => useLaborSalesAnalytics('rest-1', 'UTC', 18), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual(new Error('rpc failed'));
  });
});
