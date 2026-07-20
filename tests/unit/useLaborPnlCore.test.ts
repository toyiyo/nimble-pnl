import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { format } from 'date-fns';

// --- Mock every collaborator hook so we test only useLaborPnlCore's wiring
// (buildSplhTimeseries/identifyWorkSessions/normalizePunches are exercised
// for real, using their own unit tests elsewhere). Same pattern as
// useSplhCore.test.ts, which this hook mirrors for the financial surface. ---
const {
  mockUseRestaurantContext,
  mockUseStaffingSettings,
  mockUseSplhData,
  mockUseLaborCostsFromTimeTracking,
} = vi.hoisted(() => ({
  mockUseRestaurantContext: vi.fn(),
  mockUseStaffingSettings: vi.fn(),
  mockUseSplhData: vi.fn(),
  mockUseLaborCostsFromTimeTracking: vi.fn(),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: mockUseRestaurantContext,
}));
vi.mock('@/hooks/useStaffingSettings', () => ({
  useStaffingSettings: mockUseStaffingSettings,
}));
vi.mock('@/hooks/useSplhData', () => ({
  useSplhData: mockUseSplhData,
}));
vi.mock('@/hooks/useLaborCostsFromTimeTracking', () => ({
  useLaborCostsFromTimeTracking: mockUseLaborCostsFromTimeTracking,
}));

import { useLaborPnlCore } from '@/hooks/useLaborPnlCore';

const SALES = [
  { sale_date: '2026-07-06', sale_time: '17:00:00', sold_at: '2026-07-06T17:00:00Z', total_price: 400 },
  { sale_date: '2026-07-07', sale_time: '12:00:00', sold_at: '2026-07-07T12:00:00Z', total_price: 200 },
];

const PUNCHES = [
  { id: 'p1', restaurant_id: 'rest-1', employee_id: 'emp-1', punch_type: 'clock_in', punch_time: '2026-07-06T17:00:00Z' },
  { id: 'p2', restaurant_id: 'rest-1', employee_id: 'emp-1', punch_type: 'clock_out', punch_time: '2026-07-06T18:00:00Z' },
];

const DAILY_LABOR = [
  { date: '2026-07-06', total_labor_cost: 50, hourly_wages: 50, salary_wages: 0, contractor_payments: 0, total_hours: 1 },
];

function setup(overrides: {
  timezone?: string;
  target_labor_pct?: number;
  data?: { sales: typeof SALES; punches: typeof PUNCHES; capped: boolean };
  noData?: boolean;
  isLoading?: boolean;
  isError?: boolean;
  laborLoading?: boolean;
  laborError?: Error | null;
} = {}) {
  mockUseRestaurantContext.mockReturnValue({
    selectedRestaurant: { restaurant: { timezone: overrides.timezone ?? 'UTC' } },
  });
  mockUseStaffingSettings.mockReturnValue({
    effectiveSettings: { target_labor_pct: overrides.target_labor_pct ?? 22 },
  });
  mockUseSplhData.mockReturnValue({
    data: overrides.noData
      ? undefined
      : (overrides.data ?? { sales: SALES, punches: PUNCHES, capped: false }),
    isLoading: overrides.isLoading ?? false,
    isError: overrides.isError ?? false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseLaborCostsFromTimeTracking.mockReturnValue({
    dailyCosts: overrides.noData ? [] : DAILY_LABOR,
    totalCost: overrides.noData ? 0 : 50,
    isLoading: overrides.laborLoading ?? false,
    error: overrides.laborError ?? null,
    refetch: vi.fn(),
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

  it('derives dailySales via buildSplhTimeseries and passes through tz/targetPct/dailyLabor', async () => {
    setup();

    const { result } = renderHook(() => useLaborPnlCore('rest-1', 4), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.tz).toBe('UTC');
    expect(result.current.targetPct).toBe(22);
    expect(result.current.dailySales).toEqual([
      expect.objectContaining({ bucketStart: '2026-07-06', totalSales: 400 }),
      expect.objectContaining({ bucketStart: '2026-07-07', totalSales: 200 }),
    ]);
    expect(result.current.dailyLabor).toEqual(DAILY_LABOR);
    expect(result.current.hasData).toBe(true);
  });

  it('passes restaurantId, validated tz, and the given `weeks` window through to useSplhData', () => {
    setup({ timezone: 'Not/AValidZone' });

    renderHook(() => useLaborPnlCore('rest-1', 12), { wrapper: createWrapper() });

    expect(mockUseSplhData).toHaveBeenCalledWith('rest-1', 'UTC', 12);
  });

  it('derives the labor-cost window from the restaurant-local date, not the host/UTC date', () => {
    // 2026-07-14T05:00:00Z is already July 14 in UTC, but still July 13 in
    // Honolulu (UTC-10, no DST) — a tz that gets this wrong sends the wrong
    // end-of-window date to useLaborCostsFromTimeTracking, mirroring the
    // useSplhData §5 S-min1 lesson this hook must not regress.
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

  it('CRITICAL: windowEnd is end-of-day (not midnight-start), so today\'s evening punches are not silently excluded from the fetch', () => {
    // useLaborCostsFromTimeTracking feeds windowEnd straight into
    // lookaheadPunchFetchRange(dateFrom, dateTo), which widens only the END
    // of the time_punches fetch by OVERNIGHT_BUFFER_HOURS (18h). If windowEnd
    // were anchored at today's midnight-START, the fetch would cut off at
    // 6pm today, dropping every clock-in/clock-out later than that (and any
    // shift whose clock_out falls after 6pm would read as an incomplete
    // shift and be dropped entirely) — undercounting "today" labor relative
    // to sales, which have no such cutoff (see useLaborPnlCore.ts's
    // laborCostWindow doc comment).
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

  it('returns empty dailySales, empty dailyLabor, and hasData:false when data is undefined (loading)', () => {
    setup({ noData: true, isLoading: true });

    const { result } = renderHook(() => useLaborPnlCore('rest-1', 4), { wrapper: createWrapper() });

    expect(result.current.dailySales).toEqual([]);
    expect(result.current.dailyLabor).toEqual([]);
    expect(result.current.hasData).toBe(false);
    expect(result.current.isLoading).toBe(true);
  });

  it('CRITICAL: hasData is false when sales exist but zero punches were recorded (time-tracking not set up)', () => {
    // Per design §6: same "empty" invitation state as useSplhCore — sales
    // present + zero punches anywhere in window is a setup-invite case, not
    // a silent all-zero labor read.
    setup({ data: { sales: SALES, punches: [], capped: false } });

    const { result } = renderHook(() => useLaborPnlCore('rest-1', 4), { wrapper: createWrapper() });

    expect(result.current.hasData).toBe(false);
  });

  it('propagates capped from useSplhData', () => {
    setup({ data: { sales: SALES, punches: PUNCHES, capped: true } });

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
    mockUseSplhData.mockReturnValue({
      data: { sales: SALES, punches: PUNCHES, capped: false },
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchSales,
    });
    mockUseLaborCostsFromTimeTracking.mockReturnValue({
      dailyCosts: DAILY_LABOR,
      totalCost: 50,
      isLoading: false,
      error: null,
      refetch: refetchLabor,
    });

    const { result } = renderHook(() => useLaborPnlCore('rest-1', 4), { wrapper: createWrapper() });
    result.current.refetch();

    expect(refetchSales).toHaveBeenCalledTimes(1);
    expect(refetchLabor).toHaveBeenCalledTimes(1);
  });
});
