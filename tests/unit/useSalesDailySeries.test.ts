import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';

import { useSalesDailySeries } from '@/hooks/useSalesDailySeries';
import { parseSalesDailySeries, toTrendsData, computeKpis } from '@/lib/salesTrends';

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
  by_day: [
    { sale_date: '2026-07-01', pos_system: 'toast', revenue: 120, orders: 4 },
    { sale_date: '2026-07-01', pos_system: 'square', revenue: 30, orders: 1 },
  ],
};

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return wrapper;
}

describe('parseSalesDailySeries', () => {
  it('returns pos_systems and by_day', () => {
    expect(parseSalesDailySeries(RAW_PAYLOAD)).toEqual(RAW_PAYLOAD);
  });

  it('ignores keys other than pos_systems and by_day', () => {
    const parsed = parseSalesDailySeries({ ...RAW_PAYLOAD, by_hour: [{ bad: true }] });
    expect(Object.keys(parsed).sort()).toEqual(['by_day', 'pos_systems']);
  });

  it('throws on a payload that is not an object', () => {
    expect(() => parseSalesDailySeries([])).toThrow(/expected an object, got array/);
    expect(() => parseSalesDailySeries(null)).toThrow(/expected an object/);
  });

  it('throws on a bad day row', () => {
    expect(() =>
      parseSalesDailySeries({
        pos_systems: ['toast'],
        by_day: [{ sale_date: '2026-07-01', pos_system: 'toast', revenue: '120', orders: 4 }],
      }),
    ).toThrow(/\$\.by_day\[0\]\.revenue/);
  });

  it('throws when by_day is missing', () => {
    expect(() => parseSalesDailySeries({ pos_systems: [] })).toThrow(/\$\.by_day/);
  });
});

describe('toTrendsData', () => {
  it('adds empty hour, weekday, and product arrays', () => {
    const data = toTrendsData(parseSalesDailySeries(RAW_PAYLOAD));
    expect(data).toEqual({ ...RAW_PAYLOAD, by_hour: [], by_weekday: [], by_product: [] });
  });

  it('gives the same net sales and orders KPIs as the by_day rows', () => {
    const kpis = computeKpis(toTrendsData(parseSalesDailySeries(RAW_PAYLOAD)));
    expect(kpis.netSales).toBe(150);
    expect(kpis.orders).toBe(5);
  });
});

describe('useSalesDailySeries', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('calls get_sales_daily_series with the restaurant and the two dates', async () => {
    rpcMock.mockResolvedValue({ data: RAW_PAYLOAD, error: null });

    const { result } = renderHook(
      () => useSalesDailySeries('rest-1', { startDate: '2026-06-01', endDate: '2026-06-30' }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('get_sales_daily_series', {
      p_restaurant_id: 'rest-1',
      p_start_date: '2026-06-01',
      p_end_date: '2026-06-30',
    });
    expect(result.current.data).toEqual(RAW_PAYLOAD);
  });

  it.each([
    ['no restaurant', null, { startDate: '2026-06-01', endDate: '2026-06-30' }],
    ['enabled is false', 'rest-1', { startDate: '2026-06-01', endDate: '2026-06-30', enabled: false }],
    ['no start date', 'rest-1', { startDate: null, endDate: '2026-06-30' }],
    ['a blank end date', 'rest-1', { startDate: '2026-06-01', endDate: '' }],
  ])('does not call the RPC when %s', async (_label, restaurantId, options) => {
    const { result } = renderHook(() => useSalesDailySeries(restaurantId, options), {
      wrapper: makeWrapper(),
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(rpcMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('retries a transient error one time', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: '57014', message: 'timeout' } });

    const { result } = renderHook(
      () => useSalesDailySeries('rest-1', { startDate: '2026-06-01', endDate: '2026-06-30' }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 3000 });
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(result.current.error).toMatchObject({ code: '57014' });
  });

  it('does not retry a 22023 error (invalid parameter)', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'p_start_date and p_end_date are required' },
    });

    const { result } = renderHook(
      () => useSalesDailySeries('rest-1', { startDate: '2020-01-01', endDate: '2026-06-30' }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces a parse error for a bad payload', async () => {
    rpcMock.mockResolvedValue({ data: { pos_systems: 'toast' }, error: null });

    const { result } = renderHook(
      () => useSalesDailySeries('rest-1', { startDate: '2026-06-01', endDate: '2026-06-30' }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 3000 });
    expect((result.current.error as Error).message).toMatch(/parseSalesTrends/);
  });
});
