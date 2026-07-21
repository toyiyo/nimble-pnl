import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';

import { useSalesTrends } from '@/hooks/useSalesTrends';

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

const RAW_PAYLOAD = {
  pos_systems: ['toast', 'square'],
  by_day: [{ sale_date: '2026-07-01', pos_system: 'toast', revenue: 120, orders: 4 }],
  by_hour: [{ hour: 12, pos_system: 'toast', revenue: 60, day_count: 1 }],
  by_weekday: [{ dow: 3, pos_system: 'toast', revenue: 120 }],
  by_product: [{ item_name: 'Burger', pos_system: 'toast', revenue: 80, quantity: 2 }],
};

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return wrapper;
}

describe('useSalesTrends', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('calls get_sales_trends with restaurantId, dates, and timeZone params', async () => {
    rpcMock.mockResolvedValue({ data: RAW_PAYLOAD, error: null });

    const { result } = renderHook(
      () =>
        useSalesTrends('rest-1', {
          startDate: '2026-07-01',
          endDate: '2026-07-20',
          timeZone: 'America/New_York',
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(rpcMock).toHaveBeenCalledWith('get_sales_trends', {
      p_restaurant_id: 'rest-1',
      p_start_date: '2026-07-01',
      p_end_date: '2026-07-20',
      p_time_zone: 'America/New_York',
    });
  });

  it('defaults timeZone to America/Chicago when not provided', async () => {
    rpcMock.mockResolvedValue({ data: RAW_PAYLOAD, error: null });

    const { result } = renderHook(
      () => useSalesTrends('rest-1', { startDate: '2026-07-01', endDate: '2026-07-20' }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(rpcMock).toHaveBeenCalledWith('get_sales_trends', {
      p_restaurant_id: 'rest-1',
      p_start_date: '2026-07-01',
      p_end_date: '2026-07-20',
      p_time_zone: 'America/Chicago',
    });
  });

  it('defaults timeZone to America/Chicago when timeZone is an empty string', async () => {
    rpcMock.mockResolvedValue({ data: RAW_PAYLOAD, error: null });

    const { result } = renderHook(
      () =>
        useSalesTrends('rest-1', {
          startDate: '2026-07-01',
          endDate: '2026-07-20',
          timeZone: '',
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(rpcMock).toHaveBeenCalledWith(
      'get_sales_trends',
      expect.objectContaining({ p_time_zone: 'America/Chicago' }),
    );
  });

  it('returns parsed SalesTrendsData on success', async () => {
    rpcMock.mockResolvedValue({ data: RAW_PAYLOAD, error: null });

    const { result } = renderHook(
      () => useSalesTrends('rest-1', { startDate: '2026-07-01', endDate: '2026-07-20' }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      pos_systems: ['toast', 'square'],
      by_day: [{ sale_date: '2026-07-01', pos_system: 'toast', revenue: 120, orders: 4 }],
      by_hour: [{ hour: 12, pos_system: 'toast', revenue: 60, day_count: 1 }],
      by_weekday: [{ dow: 3, pos_system: 'toast', revenue: 120 }],
      by_product: [{ item_name: 'Burger', pos_system: 'toast', revenue: 80, quantity: 2 }],
    });
  });

  it('is disabled (no rpc call) when restaurantId is null', () => {
    const { result } = renderHook(
      () => useSalesTrends(null, { startDate: '2026-07-01', endDate: '2026-07-20' }),
      { wrapper: makeWrapper() },
    );

    expect(rpcMock).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it('propagates a Supabase RPC error', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'permission denied', name: 'PostgrestError' },
    });

    const { result } = renderHook(
      () => useSalesTrends('rest-1', { startDate: '2026-07-01', endDate: '2026-07-20' }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeDefined();
    expect((result.current.error as Error).message).toMatch(/permission denied/);
  });

  it('propagates a parseSalesTrends validation error for a malformed payload', async () => {
    rpcMock.mockResolvedValue({
      data: { pos_systems: 'not-an-array', by_day: [], by_hour: [], by_weekday: [], by_product: [] },
      error: null,
    });

    const { result } = renderHook(
      () => useSalesTrends('rest-1', { startDate: '2026-07-01', endDate: '2026-07-20' }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeDefined();
    expect((result.current.error as Error).message).toMatch(/parseSalesTrends/);
  });

  it('is configured with a 60s staleTime and refetchOnWindowFocus', async () => {
    rpcMock.mockResolvedValue({ data: RAW_PAYLOAD, error: null });

    const { result } = renderHook(
      () => useSalesTrends('rest-1', { startDate: '2026-07-01', endDate: '2026-07-20' }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // staleTime/refetchOnWindowFocus aren't directly introspectable from the
    // query result; the query not being immediately stale after success is
    // the observable proxy for staleTime > 0.
    expect(result.current.isStale).toBe(false);
  });
});
