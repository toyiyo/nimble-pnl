import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { format } from 'date-fns';

const {
  mockUseRestaurantContext,
  mockUseStaffingSettings,
  mockUseLaborSalesAnalytics,
  mockUseLaborCostsFromTimeTracking,
} = vi.hoisted(() => ({
  mockUseRestaurantContext: vi.fn(),
  mockUseStaffingSettings: vi.fn(),
  mockUseLaborSalesAnalytics: vi.fn(),
  mockUseLaborCostsFromTimeTracking: vi.fn(),
}));

vi.mock('@/contexts/RestaurantContext', () => ({ useRestaurantContext: mockUseRestaurantContext }));
vi.mock('@/hooks/useStaffingSettings', () => ({ useStaffingSettings: mockUseStaffingSettings }));
vi.mock('@/hooks/useLaborSalesAnalytics', () => ({ useLaborSalesAnalytics: mockUseLaborSalesAnalytics }));
vi.mock('@/hooks/useLaborCostsFromTimeTracking', () => ({ useLaborCostsFromTimeTracking: mockUseLaborCostsFromTimeTracking }));

import { useLaborPnlCore } from '@/hooks/useLaborPnlCore';

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
];

function setup(overrides: {
  timezone?: string;
  target_labor_pct?: number;
  data?: typeof RPC;
  dailyCosts?: typeof DAILY_LABOR;
  noData?: boolean;
  isLoading?: boolean;
  isError?: boolean;
  salesError?: Error | null;
  laborLoading?: boolean;
  laborError?: Error | null;
  laborCapped?: boolean;
} = {}) {
  mockUseRestaurantContext.mockReturnValue({
    selectedRestaurant: { restaurant: { timezone: overrides.timezone ?? 'UTC' } },
  });
  mockUseStaffingSettings.mockReturnValue({
    effectiveSettings: { target_labor_pct: overrides.target_labor_pct ?? 22 },
    updateSettings: vi.fn(),
    isSaving: false,
  });
  mockUseLaborSalesAnalytics.mockReturnValue({
    data: overrides.noData ? undefined : (overrides.data ?? RPC),
    isLoading: overrides.isLoading ?? false,
    isError: overrides.isError ?? false,
    error: overrides.salesError ?? null,
    refetch: vi.fn(),
  });
  mockUseLaborCostsFromTimeTracking.mockReturnValue({
    dailyCosts: overrides.noData ? [] : (overrides.dailyCosts ?? DAILY_LABOR),
    totalCost: 50,
    isLoading: overrides.laborLoading ?? false,
    error: overrides.laborError ?? null,
    refetch: vi.fn(),
    capped: overrides.laborCapped ?? false,
  });
}

const createWrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useLaborPnlCore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('derives dailySales via dailySalesFromRpc and passes through tz/targetPct/dailyLabor', async () => {
    setup();
    const { result } = renderHook(() => useLaborPnlCore('rest-1', 4), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.tz).toBe('UTC');
    expect(result.current.targetPct).toBe(22);
    expect(result.current.dailySales).toEqual([
      { bucketStart: '2026-07-06', label: '2026-07-06', totalSales: 400, totalHours: 0, splh: null },
      { bucketStart: '2026-07-07', label: '2026-07-07', totalSales: 200, totalHours: 0, splh: null },
    ]);
    expect(result.current.dailyLabor).toEqual(DAILY_LABOR);
    expect(result.current.hasData).toBe(true);
  });

  it('exposes the RPC grid, by_weekday, and has_hourly for the busy-hours heatmap', () => {
    setup();
    const { result } = renderHook(() => useLaborPnlCore('rest-1', 4), { wrapper: createWrapper() });
    expect(result.current.grid).toEqual(RPC.grid);
    expect(result.current.byWeekday).toEqual(RPC.by_weekday);
    expect(result.current.hasHourly).toBe(true);
  });

  it('passes restaurantId, validated tz, and the given `weeks` window to useLaborSalesAnalytics', () => {
    setup({ timezone: 'Not/AValidZone' });
    renderHook(() => useLaborPnlCore('rest-1', 12), { wrapper: createWrapper() });
    // safeTz falls back to the restaurant default (America/Chicago), not UTC.
    expect(mockUseLaborSalesAnalytics).toHaveBeenCalledWith('rest-1', 'America/Chicago', 12);
  });

  it('derives the labor-cost window from the restaurant-local date, not the host/UTC date', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-14T05:00:00Z'));
    setup({ timezone: 'Pacific/Honolulu' });
    renderHook(() => useLaborPnlCore('rest-1', 4), { wrapper: createWrapper() });

    expect(mockUseLaborCostsFromTimeTracking).toHaveBeenCalledTimes(1);
    const [restaurantIdArg, dateFromArg, dateToArg] = mockUseLaborCostsFromTimeTracking.mock.calls[0];
    expect(restaurantIdArg).toBe('rest-1');
    expect(format(dateToArg as Date, 'yyyy-MM-dd')).toBe('2026-07-13');
    expect(format(dateFromArg as Date, 'yyyy-MM-dd')).toBe('2026-06-15');
  });

  it('CRITICAL: windowEnd is end-of-day so today\'s evening punches are not silently excluded', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-14T05:00:00Z'));
    setup({ timezone: 'UTC' });
    renderHook(() => useLaborPnlCore('rest-1', 4), { wrapper: createWrapper() });

    const [, , dateToArg] = mockUseLaborCostsFromTimeTracking.mock.calls[0];
    const windowEnd = dateToArg as Date;
    expect(format(windowEnd, 'yyyy-MM-dd')).toBe('2026-07-14');
    expect(windowEnd.getHours()).toBe(23);
    expect(windowEnd.getMinutes()).toBe(59);
    expect(windowEnd.getSeconds()).toBe(59);
  });

  it('returns empty dailySales/dailyLabor and hasData:false when the RPC data is undefined (loading)', () => {
    setup({ noData: true, isLoading: true });
    const { result } = renderHook(() => useLaborPnlCore('rest-1', 4), { wrapper: createWrapper() });
    expect(result.current.dailySales).toEqual([]);
    expect(result.current.dailyLabor).toEqual([]);
    expect(result.current.hasData).toBe(false);
    expect(result.current.isLoading).toBe(true);
  });

  it('CRITICAL: hasData is false when sales exist but zero labor days were recorded (time tracking not set up)', () => {
    setup({ data: RPC, dailyCosts: [] });
    const { result } = renderHook(() => useLaborPnlCore('rest-1', 4), { wrapper: createWrapper() });
    expect(result.current.hasData).toBe(false);
  });

  it('capped reflects the labor-cost fetch (the SQL sales aggregate never truncates)', () => {
    setup({ laborCapped: true });
    const { result } = renderHook(() => useLaborPnlCore('rest-1', 4), { wrapper: createWrapper() });
    expect(result.current.capped).toBe(true);
  });

  it('combines isLoading/isError/error from both source hooks', () => {
    setup({ isLoading: false, laborLoading: true, laborError: new Error('boom') });
    const { result } = renderHook(() => useLaborPnlCore('rest-1', 4), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isError).toBe(true);
    expect(result.current.error).toEqual(new Error('boom'));
  });

  it('surfaces refetch that calls both source hooks', () => {
    const refetchSales = vi.fn();
    const refetchLabor = vi.fn();
    setup();
    mockUseLaborSalesAnalytics.mockReturnValue({
      data: RPC, isLoading: false, isError: false, error: null, refetch: refetchSales,
    });
    mockUseLaborCostsFromTimeTracking.mockReturnValue({
      dailyCosts: DAILY_LABOR, totalCost: 50, isLoading: false, error: null, refetch: refetchLabor, capped: false,
    });
    const { result } = renderHook(() => useLaborPnlCore('rest-1', 4), { wrapper: createWrapper() });
    result.current.refetch();
    expect(refetchSales).toHaveBeenCalledTimes(1);
    expect(refetchLabor).toHaveBeenCalledTimes(1);
  });
});
