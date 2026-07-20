import React, { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// --- Mock every collaborator hook `useLaborPnlCore` composes so we test only
// `useLaborPnlAnalytics`'s wiring (`buildFinancialSeries`/`buildSplhGrid`/
// `buildSalesVolumeGrid`/`summarizeLaborPnl` are exercised for real, using
// their own unit tests in laborPnlAnalytics.test.ts / splhAnalytics.test.ts)
// — mirrors useSplhAnalytics.test.ts's pattern of mocking useSplhCore's
// collaborators rather than useSplhCore itself. ---
const {
  mockUseRestaurantContext,
  mockUseStaffingSettings,
  mockUseSplhData,
  mockUseLaborCostsFromTimeTracking,
  mockUseEmployees,
  mockGetToday,
} = vi.hoisted(() => ({
  mockUseRestaurantContext: vi.fn(),
  mockUseStaffingSettings: vi.fn(),
  mockUseSplhData: vi.fn(),
  mockUseLaborCostsFromTimeTracking: vi.fn(),
  mockUseEmployees: vi.fn(),
  mockGetToday: vi.fn(() => '2026-07-07'),
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
vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: mockUseEmployees,
}));
// Pin the restaurant-tz "today" so the Day/Week/Month period windows are
// deterministic relative to the fixtures below (Mon 2026-07-06 / Tue 2026-07-07).
// "today" = Tue 2026-07-07: Day → 07-07 only; Week → 07-06..07-07; Month → 07-01..07-07.
vi.mock('@/lib/timezone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/timezone')>()),
  getTodayInTimezone: mockGetToday,
}));

import { useLaborPnlAnalytics } from '@/hooks/useLaborPnlAnalytics';

// Monday 2026-07-06, 17:00 UTC and Tuesday 2026-07-07, 12:00 UTC — two
// distinct days so day/week granularity produce different bucket counts.
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
  { date: '2026-07-07', total_labor_cost: 30, hourly_wages: 30, salary_wages: 0, contractor_payments: 0, total_hours: 0.5 },
];

function setup(overrides: {
  timezone?: string;
  target_labor_pct?: number;
  data?: { sales: typeof SALES; punches: typeof PUNCHES; capped: boolean };
  dailyLabor?: typeof DAILY_LABOR;
  isLoading?: boolean;
  isError?: boolean;
  updateSettings?: ReturnType<typeof vi.fn>;
} = {}) {
  mockUseRestaurantContext.mockReturnValue({
    selectedRestaurant: { restaurant: { timezone: overrides.timezone ?? 'UTC' } },
  });
  mockUseStaffingSettings.mockReturnValue({
    effectiveSettings: { target_labor_pct: overrides.target_labor_pct ?? 22 },
    updateSettings: overrides.updateSettings ?? vi.fn().mockResolvedValue(undefined),
    isSaving: false,
  });
  mockUseSplhData.mockReturnValue({
    data: overrides.data ?? { sales: SALES, punches: PUNCHES, capped: false },
    isLoading: overrides.isLoading ?? false,
    isError: overrides.isError ?? false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseLaborCostsFromTimeTracking.mockReturnValue({
    dailyCosts: overrides.dailyLabor ?? DAILY_LABOR,
    totalCost: 80,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseEmployees.mockReturnValue({ employees: [] });
}

const createWrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useLaborPnlAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetToday.mockReturnValue('2026-07-07');
  });

  it('Day view: intraday (hour-of-day) chart series + a full 7x24 sales-volume grid', async () => {
    setup();

    const { result } = renderHook(() => useLaborPnlAnalytics('rest-1', 'day'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // "today" = 07-07, whose only sale is at 12:00Z → one intraday bucket (hour labels, not dates).
    expect(result.current.series).toHaveLength(1);
    expect(result.current.series[0].label).toBe('12 PM');
    expect(result.current.series[0].sales).toBe(200);
    expect(result.current.seriesIsShapeEstimate).toBe(true);

    // Grid spans the FULL window (a pattern read), independent of the toggle.
    expect(result.current.grid).toHaveLength(7 * 24);
    const hour17 = result.current.grid.find((c) => c.dow === 1 && c.hour === 17);
    expect(hour17?.totalSales).toBe(400);
    expect(hour17?.estimated).toBe(false);
    expect(result.current.targetPct).toBe(22);
  });

  it('CRITICAL: the toggle selects the PERIOD — KPI summary differs by granularity (finding #2)', async () => {
    setup();

    // Day = today (07-07) only → sales 200, labor 30.
    const { result: day } = renderHook(() => useLaborPnlAnalytics('rest-1', 'day'), { wrapper: createWrapper() });
    await waitFor(() => expect(day.current.isLoading).toBe(false));
    expect(day.current.summary.sales).toBe(200);
    expect(day.current.summary.laborCost).toBe(30);

    // Month = 07-01..07-07 → both fixture days → sales 600, labor 80.
    const { result: month } = renderHook(() => useLaborPnlAnalytics('rest-1', 'month'), { wrapper: createWrapper() });
    await waitFor(() => expect(month.current.isLoading).toBe(false));
    expect(month.current.summary.sales).toBe(600);
    expect(month.current.summary.laborCost).toBe(80);
  });

  it('CRITICAL: granularity switch rebuilds the chart series (day intraday / week daily / month weekly)', async () => {
    setup();

    const { result: dayResult } = renderHook(() => useLaborPnlAnalytics('rest-1', 'day'), { wrapper: createWrapper() });
    await waitFor(() => expect(dayResult.current.isLoading).toBe(false));
    expect(dayResult.current.series).toHaveLength(1); // intraday: today's single active hour

    const { result: weekResult } = renderHook(() => useLaborPnlAnalytics('rest-1', 'week'), { wrapper: createWrapper() });
    await waitFor(() => expect(weekResult.current.isLoading).toBe(false));
    // Week 07-06..07-07: by-day → 2 date buckets (payroll-grade).
    expect(weekResult.current.series.map((p) => p.bucketStart)).toEqual(['2026-07-06', '2026-07-07']);
    expect(weekResult.current.seriesIsShapeEstimate).toBe(false);

    const { result: monthResult } = renderHook(() => useLaborPnlAnalytics('rest-1', 'month'), { wrapper: createWrapper() });
    await waitFor(() => expect(monthResult.current.isLoading).toBe(false));
    // Month by-week → both days collapse into the one Monday-start bucket.
    expect(monthResult.current.series).toHaveLength(1);
    expect(monthResult.current.series[0].bucketStart).toBe('2026-07-06');
  });

  it('MIDNIGHT ROLLOVER: refreshes the period when the restaurant-tz date advances', async () => {
    vi.useFakeTimers();
    try {
      setup(); // "today" = 07-07 → Day period has the 200 sale
      const { result } = renderHook(() => useLaborPnlAnalytics('rest-1', 'day'), { wrapper: createWrapper() });
      expect(result.current.summary.sales).toBe(200);

      // Clock rolls over to 07-08 (no fixture data that day).
      mockGetToday.mockReturnValue('2026-07-08');
      act(() => {
        vi.advanceTimersByTime(60_000); // the 1-min poll fires → period recomputes
      });

      expect(result.current.summary.sales).toBe(0);
      expect(result.current.series).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT flag estimated when sales carry sale_time but no sold_at (real hour via sale_time)', async () => {
    setup({
      data: {
        sales: [{ sale_date: '2026-07-07', sale_time: '12:00:00', sold_at: null, total_price: 150 }],
        punches: PUNCHES,
        capped: false,
      },
    });

    const { result } = renderHook(() => useLaborPnlAnalytics('rest-1', 'day'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // hourOfSale derives noon from sale_time → buildSplhGrid buckets by real hour,
    // so the heatmap must not be labelled "Estimated" (CodeRabbit finding).
    expect(result.current.grid.every((c) => c.estimated === false)).toBe(true);
  });

  it('flags grid cells estimated:true when no sale row carries a derivable hour (daily-spread fallback)', async () => {
    setup({
      data: {
        sales: [{ sale_date: '2026-07-06', sale_time: null, sold_at: null, total_price: 100 }],
        punches: PUNCHES,
        capped: false,
      },
    });

    const { result } = renderHook(() => useLaborPnlAnalytics('rest-1', 'day'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.grid.every((c) => c.estimated === true)).toBe(true);
  });

  it('CRITICAL: updateTarget calls updateSettings({ target_labor_pct }) only when the value actually changed', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    setup({ target_labor_pct: 22, updateSettings });

    const { result } = renderHook(() => useLaborPnlAnalytics('rest-1', 'day'), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.updateTarget(22); // unchanged — no-op
    });
    expect(updateSettings).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.updateTarget(25); // changed — writes once
    });
    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith({ target_labor_pct: 25 });
  });

  it('propagates capped, hasData, isLoading/isError/error, and refetch from the core hook', () => {
    setup({ data: { sales: SALES, punches: PUNCHES, capped: true }, isError: true });

    const { result } = renderHook(() => useLaborPnlAnalytics('rest-1', 'day'), { wrapper: createWrapper() });

    expect(result.current.capped).toBe(true);
    expect(result.current.hasData).toBe(true);
    expect(result.current.isError).toBe(true);
    expect(typeof result.current.refetch).toBe('function');
  });

  it('returns an empty series and an all-zero grid when there is no sales/labor data (loading)', () => {
    setup({ data: { sales: [], punches: [], capped: false }, dailyLabor: [], isLoading: true });

    const { result } = renderHook(() => useLaborPnlAnalytics('rest-1', 'day'), { wrapper: createWrapper() });

    expect(result.current.series).toEqual([]);
    // `buildSplhGrid` always shapes the full 7x24 grid (every cell "closed"
    // when there's no sales/labor data) rather than an empty array — the
    // page gates rendering on `isLoading`/`hasData`, not the grid's length.
    expect(result.current.grid).toHaveLength(7 * 24);
    expect(result.current.grid.every((c) => c.totalSales === 0)).toBe(true);
    expect(result.current.hasData).toBe(false);
    expect(result.current.isLoading).toBe(true);
  });
});
