import React, { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const {
  mockUseRestaurantContext,
  mockUseStaffingSettings,
  mockUseLaborSalesAnalytics,
  mockUseLaborCostsFromTimeTracking,
  mockUseLaborIntradaySeries,
  mockGetToday,
} = vi.hoisted(() => ({
  mockUseRestaurantContext: vi.fn(),
  mockUseStaffingSettings: vi.fn(),
  mockUseLaborSalesAnalytics: vi.fn(),
  mockUseLaborCostsFromTimeTracking: vi.fn(),
  mockUseLaborIntradaySeries: vi.fn(),
  mockGetToday: vi.fn(() => '2026-07-10'),
}));

vi.mock('@/contexts/RestaurantContext', () => ({ useRestaurantContext: mockUseRestaurantContext }));
vi.mock('@/hooks/useStaffingSettings', () => ({ useStaffingSettings: mockUseStaffingSettings }));
vi.mock('@/hooks/useLaborSalesAnalytics', () => ({ useLaborSalesAnalytics: mockUseLaborSalesAnalytics }));
vi.mock('@/hooks/useLaborCostsFromTimeTracking', () => ({ useLaborCostsFromTimeTracking: mockUseLaborCostsFromTimeTracking }));
vi.mock('@/hooks/useLaborIntradaySeries', () => ({ useLaborIntradaySeries: mockUseLaborIntradaySeries }));
vi.mock('@/lib/timezone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/timezone')>()),
  getTodayInTimezone: mockGetToday,
}));

import { useLaborPnlAnalytics } from '@/hooks/useLaborPnlAnalytics';

const RPC = {
  daily: [
    { sale_date: '2026-07-06', revenue: 400 },
    { sale_date: '2026-07-07', revenue: 200 },
  ],
  grid: [
    { dow: 1, hour: 17, revenue: 400 },
    { dow: 2, hour: 12, revenue: 200 },
  ],
  by_weekday: [
    { dow: 1, revenue: 400 },
    { dow: 2, revenue: 200 },
  ],
  has_hourly: true,
};

const DAILY_LABOR = [
  { date: '2026-07-06', total_labor_cost: 50, hourly_wages: 50, salary_wages: 0, contractor_payments: 0, total_hours: 1 },
  { date: '2026-07-07', total_labor_cost: 30, hourly_wages: 30, salary_wages: 0, contractor_payments: 0, total_hours: 0.5 },
];

const INTRADAY_SERIES = [
  { bucketStart: '2026-07-07T12', label: '12 PM', sales: 200, laborCost: 20, laborHours: 1, laborPct: 10, balanceState: 'under' as const },
];

function setup(overrides: {
  timezone?: string;
  target_labor_pct?: number;
  data?: typeof RPC;
  dailyCosts?: typeof DAILY_LABOR;
  laborCapped?: boolean;
  isLoading?: boolean;
  isError?: boolean;
  updateSettings?: ReturnType<typeof vi.fn>;
  intraday?: { series: typeof INTRADAY_SERIES; isLoading: boolean };
} = {}) {
  mockUseRestaurantContext.mockReturnValue({
    selectedRestaurant: { restaurant: { timezone: overrides.timezone ?? 'UTC' } },
  });
  mockUseStaffingSettings.mockReturnValue({
    effectiveSettings: { target_labor_pct: overrides.target_labor_pct ?? 22 },
    updateSettings: overrides.updateSettings ?? vi.fn().mockResolvedValue(undefined),
    isSaving: false,
  });
  mockUseLaborSalesAnalytics.mockReturnValue({
    data: overrides.data ?? RPC,
    isLoading: overrides.isLoading ?? false,
    isError: overrides.isError ?? false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseLaborCostsFromTimeTracking.mockReturnValue({
    dailyCosts: overrides.dailyCosts ?? DAILY_LABOR,
    totalCost: 80,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    capped: overrides.laborCapped ?? false,
  });
  mockUseLaborIntradaySeries.mockReturnValue(
    overrides.intraday ?? { series: INTRADAY_SERIES, isLoading: false },
  );
}

const createWrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

const CUSTOM = (start: string, end: string) => ({ preset: 'custom' as const, customStart: start, customEnd: end });

describe('useLaborPnlAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetToday.mockReturnValue('2026-07-10');
  });

  it('single-day range → intraday series (from useLaborIntradaySeries) + a full 7x24 grid', async () => {
    setup();
    const { result } = renderHook(() => useLaborPnlAnalytics('rest-1', CUSTOM('2026-07-07', '2026-07-07')), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.granularity).toBe('intraday');
    expect(result.current.series).toEqual(INTRADAY_SERIES);
    expect(result.current.seriesIsShapeEstimate).toBe(true);
    expect(mockUseLaborIntradaySeries).toHaveBeenCalledWith('rest-1', 'UTC', '2026-07-07', 22, true);

    expect(result.current.grid).toHaveLength(7 * 24);
    const hour17 = result.current.grid.find((c) => c.dow === 1 && c.hour === 17);
    expect(hour17?.totalSales).toBe(400);
    expect(hour17?.estimated).toBe(false);
    expect(result.current.targetPct).toBe(22);
  });

  it('CRITICAL: the range selects the PERIOD — KPI summary differs by range', async () => {
    setup();
    const { result: day } = renderHook(() => useLaborPnlAnalytics('rest-1', CUSTOM('2026-07-07', '2026-07-07')), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(day.current.isLoading).toBe(false));
    expect(day.current.summary.sales).toBe(200);
    expect(day.current.summary.laborCost).toBe(30);

    const { result: month } = renderHook(() => useLaborPnlAnalytics('rest-1', { preset: 'this_month' }), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(month.current.isLoading).toBe(false));
    expect(month.current.summary.sales).toBe(600);
    expect(month.current.summary.laborCost).toBe(80);
  });

  it('CRITICAL: range span picks the chart granularity (intraday / day / week)', async () => {
    setup();
    const { result: dayResult } = renderHook(() => useLaborPnlAnalytics('rest-1', CUSTOM('2026-07-07', '2026-07-07')), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(dayResult.current.isLoading).toBe(false));
    expect(dayResult.current.granularity).toBe('intraday');
    expect(dayResult.current.series).toEqual(INTRADAY_SERIES);

    const { result: weekResult } = renderHook(() => useLaborPnlAnalytics('rest-1', CUSTOM('2026-07-06', '2026-07-07')), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(weekResult.current.isLoading).toBe(false));
    expect(weekResult.current.granularity).toBe('day');
    expect(weekResult.current.series.map((p) => p.bucketStart)).toEqual(['2026-07-06', '2026-07-07']);
    expect(weekResult.current.seriesIsShapeEstimate).toBe(false);

    const { result: monthResult } = renderHook(() => useLaborPnlAnalytics('rest-1', CUSTOM('2026-07-06', '2026-07-25')), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(monthResult.current.isLoading).toBe(false));
    expect(monthResult.current.granularity).toBe('week');
    expect(monthResult.current.series).toHaveLength(1);
    expect(monthResult.current.series[0].bucketStart).toBe('2026-07-06');
  });

  it('MIDNIGHT ROLLOVER: refreshes "Today" when the restaurant-tz date advances', async () => {
    vi.useFakeTimers();
    try {
      mockGetToday.mockReturnValue('2026-07-07');
      setup();
      const { result } = renderHook(() => useLaborPnlAnalytics('rest-1', { preset: 'today' }), {
        wrapper: createWrapper(),
      });
      expect(result.current.summary.sales).toBe(200);

      mockGetToday.mockReturnValue('2026-07-08');
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(result.current.summary.sales).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('grid is NOT flagged estimated when the RPC reports hourly data (has_hourly true)', async () => {
    setup({ data: { ...RPC, has_hourly: true } });
    const { result } = renderHook(() => useLaborPnlAnalytics('rest-1', { preset: 'today' }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.grid.every((c) => c.estimated === false)).toBe(true);
  });

  it('flags grid cells estimated:true when the RPC reports no hourly data (daily-spread fallback)', async () => {
    setup({
      data: {
        daily: [{ sale_date: '2026-07-06', revenue: 100 }],
        grid: [],
        by_weekday: [{ dow: 1, revenue: 100 }],
        has_hourly: false,
      },
    });
    const { result } = renderHook(() => useLaborPnlAnalytics('rest-1', { preset: 'today' }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.grid.every((c) => c.estimated === true)).toBe(true);
  });

  it('CRITICAL: updateTarget calls updateSettings only when the value actually changed', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    setup({ target_labor_pct: 22, updateSettings });
    const { result } = renderHook(() => useLaborPnlAnalytics('rest-1', { preset: 'today' }), { wrapper: createWrapper() });

    await act(async () => { await result.current.updateTarget(22); });
    expect(updateSettings).not.toHaveBeenCalled();

    await act(async () => { await result.current.updateTarget(25); });
    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith({ target_labor_pct: 25 });
  });

  it('propagates capped (from labor fetch), hasData, isError, and refetch from the core hook', () => {
    setup({ laborCapped: true, isError: true });
    const { result } = renderHook(() => useLaborPnlAnalytics('rest-1', { preset: 'today' }), { wrapper: createWrapper() });
    expect(result.current.capped).toBe(true);
    expect(result.current.hasData).toBe(true);
    expect(result.current.isError).toBe(true);
    expect(typeof result.current.refetch).toBe('function');
  });

  it('ORs the intraday hook loading state into isLoading for a single-day range', () => {
    setup({ intraday: { series: [], isLoading: true } });
    const { result } = renderHook(() => useLaborPnlAnalytics('rest-1', { preset: 'today' }), { wrapper: createWrapper() });
    // today = 2026-07-10 → single day → intraday; its loading must surface.
    expect(result.current.isLoading).toBe(true);
  });

  it('returns an empty series and an all-zero grid when there is no data (loading)', () => {
    setup({
      data: { daily: [], grid: [], by_weekday: [], has_hourly: false },
      dailyCosts: [],
      isLoading: true,
      intraday: { series: [], isLoading: true },
    });
    const { result } = renderHook(() => useLaborPnlAnalytics('rest-1', { preset: 'today' }), { wrapper: createWrapper() });
    expect(result.current.series).toEqual([]);
    expect(result.current.grid).toHaveLength(7 * 24);
    expect(result.current.grid.every((c) => c.totalSales === 0)).toBe(true);
    expect(result.current.hasData).toBe(false);
    expect(result.current.isLoading).toBe(true);
  });
});
