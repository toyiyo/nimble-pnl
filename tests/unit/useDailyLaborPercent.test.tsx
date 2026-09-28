import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { mockQueryFn, mockSettings } = vi.hoisted(() => ({
  mockQueryFn: vi.fn(),
  mockSettings: vi.fn(),
}));

vi.mock('@/hooks/useRestaurantClock', () => ({
  useRestaurantClock: () => ({ tz: 'America/Chicago', today: '2026-09-28' }),
}));
vi.mock('@/hooks/useStaffingSettings', () => ({
  useStaffingSettings: () => mockSettings(),
}));
vi.mock('@/hooks/useWeekStaffingSuggestions', () => ({
  LOOKBACK_SALES_ROW_CAP: 3,
  lookbackSalesQueryOptions: (restaurantId: string | null, lookbackWeeks: number, tz: string) => ({
    queryKey: ['hourly-sales-all', restaurantId, lookbackWeeks, tz],
    queryFn: () => mockQueryFn(restaurantId, lookbackWeeks, tz),
    enabled: !!restaurantId,
  }),
}));

import { useDailyLaborPercent } from '@/hooks/useDailyLaborPercent';

// 2026-09-21 is a Monday; 2026-09-22 is a Tuesday.
const WEEK = ['2026-09-28', '2026-09-29'];
const SALES = [
  { sale_date: '2026-09-21', sale_time: null, sold_at: null, total_price: 1000 },
  // Today (a Monday) has partial sales and must not count.
  { sale_date: '2026-09-28', sale_time: null, sold_at: null, total_price: 50 },
];

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const COSTS = [{ date: '2026-09-28', total_labor_cost: 250 }];

describe('useDailyLaborPercent', () => {
  beforeEach(() => {
    mockQueryFn.mockReset();
    mockSettings.mockReturnValue({
      effectiveSettings: { target_labor_pct: 20, lookback_weeks: 8 },
      isLoading: false,
    });
  });

  it('divides scheduled cost by the projected daily sales from the lookback query', async () => {
    mockQueryFn.mockResolvedValue(SALES);
    const { result } = renderHook(
      () => useDailyLaborPercent('r1', WEEK, { dailyCosts: COSTS, costsLoading: false, enabled: true }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockQueryFn).toHaveBeenCalledWith('r1', 8, 'America/Chicago');
    expect(result.current.byDay.get('2026-09-28')).toEqual({
      laborCost: 250,
      projectedSales: 1000,
      percent: 25,
      overTarget: true,
    });
    expect(result.current.byDay.get('2026-09-29')?.percent).toBeNull();
    expect(result.current.targetLaborPct).toBe(20);
    expect(result.current.lookbackWeeks).toBe(8);
    expect(result.current.hasError).toBe(false);
  });

  it('stays loading while the shift costs load', async () => {
    mockQueryFn.mockResolvedValue(SALES);
    const { result } = renderHook(
      () => useDailyLaborPercent('r1', WEEK, { dailyCosts: [], costsLoading: true, enabled: true }),
      { wrapper },
    );

    await waitFor(() => expect(mockQueryFn).toHaveBeenCalled());
    expect(result.current.isLoading).toBe(true);
  });

  it('reports an error when the sales query fails', async () => {
    mockQueryFn.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(
      () => useDailyLaborPercent('r1', WEEK, { dailyCosts: COSTS, costsLoading: false, enabled: true }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.hasError).toBe(true));
    expect(result.current.isLoading).toBe(false);
  });

  it('waits for the saved settings before the sales query runs', () => {
    mockSettings.mockReturnValue({
      effectiveSettings: { target_labor_pct: 22, lookback_weeks: 4 },
      isLoading: true,
    });
    const { result } = renderHook(
      () => useDailyLaborPercent('r1', WEEK, { dailyCosts: COSTS, costsLoading: false, enabled: true }),
      { wrapper },
    );

    expect(mockQueryFn).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(true);
  });

  it('drops the partial last date when the result reaches the row cap', async () => {
    // The mocked cap is 3 rows: the 2026-09-21 total (only part of the day) must not count.
    mockQueryFn.mockResolvedValue([
      { sale_date: '2026-09-14', sale_time: null, sold_at: null, total_price: 800 },
      { sale_date: '2026-09-14', sale_time: null, sold_at: null, total_price: 200 },
      { sale_date: '2026-09-21', sale_time: null, sold_at: null, total_price: 10 },
    ]);
    const { result } = renderHook(
      () => useDailyLaborPercent('r1', WEEK, { dailyCosts: COSTS, costsLoading: false, enabled: true }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.byDay.get('2026-09-28')?.projectedSales).toBe(1000);
  });

  it('does not query sales when disabled', () => {
    const { result } = renderHook(
      () => useDailyLaborPercent('r1', WEEK, { dailyCosts: COSTS, costsLoading: false, enabled: false }),
      { wrapper },
    );

    expect(mockQueryFn).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });

  it('returns the same object when nothing changes', async () => {
    mockQueryFn.mockResolvedValue(SALES);
    const { result, rerender } = renderHook(
      () => useDailyLaborPercent('r1', WEEK, { dailyCosts: COSTS, costsLoading: false, enabled: true }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
