import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// --- Mock every collaborator hook so we test only useSplhAnalytics's wiring
// (buildSplhGrid/buildSplhTimeseries/summarizeSplh/identifyWorkSessions are
// exercised for real, using their own unit tests in splhAnalytics.test.ts). ---
const { mockUseRestaurantContext, mockUseStaffingSettings, mockUseEmployees, mockUseSplhData } = vi.hoisted(() => ({
  mockUseRestaurantContext: vi.fn(),
  mockUseStaffingSettings: vi.fn(),
  mockUseEmployees: vi.fn(),
  mockUseSplhData: vi.fn(),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: mockUseRestaurantContext,
}));
vi.mock('@/hooks/useStaffingSettings', () => ({
  useStaffingSettings: mockUseStaffingSettings,
}));
vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: mockUseEmployees,
}));
vi.mock('@/hooks/useSplhData', () => ({
  useSplhData: mockUseSplhData,
}));

import { useSplhAnalytics } from '@/hooks/useSplhAnalytics';

const SALES = [
  // Monday 2026-07-06, 17:00 UTC — lands in the same hour/dow bucket as the
  // work session below so the grid cell resolves to a real (non-null) SPLH.
  { sale_date: '2026-07-06', sale_time: '17:00:00', sold_at: '2026-07-06T17:00:00Z', total_price: 400 },
  { sale_date: '2026-07-06', sale_time: '18:00:00', sold_at: '2026-07-06T18:00:00Z', total_price: 200 },
];

const PUNCHES = [
  { id: 'p1', restaurant_id: 'rest-1', employee_id: 'emp-1', punch_type: 'clock_in', punch_time: '2026-07-06T17:00:00Z' },
  { id: 'p2', restaurant_id: 'rest-1', employee_id: 'emp-1', punch_type: 'clock_out', punch_time: '2026-07-06T19:00:00Z' },
];

const EMPLOYEES = [
  { id: 'emp-1', compensation_type: 'hourly', is_active: true, hourly_rate: 20 },
];

function setup(overrides: {
  timezone?: string;
  target_splh?: number;
  /** Omit to use the default fixture; pass `noData: true` to simulate the
   * pre-fetch/loading state where `useSplhData` hasn't resolved yet. */
  data?: { sales: typeof SALES; punches: typeof PUNCHES; capped: boolean };
  noData?: boolean;
  isLoading?: boolean;
  isError?: boolean;
} = {}) {
  mockUseRestaurantContext.mockReturnValue({
    selectedRestaurant: { restaurant: { timezone: overrides.timezone ?? 'UTC' } },
  });
  mockUseStaffingSettings.mockReturnValue({
    effectiveSettings: { target_splh: overrides.target_splh ?? 60 },
  });
  mockUseEmployees.mockReturnValue({ employees: EMPLOYEES });
  mockUseSplhData.mockReturnValue({
    data: overrides.noData
      ? undefined
      : (overrides.data ?? { sales: SALES, punches: PUNCHES, capped: false }),
    isLoading: overrides.isLoading ?? false,
    isError: overrides.isError ?? false,
    error: null,
    refetch: vi.fn(),
  });
}

const createWrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useSplhAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds a non-empty grid, daily/weekly timelines, and a matching summary from sales+punches', async () => {
    setup();

    const { result } = renderHook(() => useSplhAnalytics('rest-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // 7*24 grid; the 2h work session (17:00-19:00 UTC) splits across the
    // Mon 17:00 ($400/1h) and Mon 18:00 ($200/1h) cells.
    expect(result.current.grid).toHaveLength(7 * 24);
    const hour17 = result.current.grid.find((c) => c.dow === 1 && c.hour === 17);
    const hour18 = result.current.grid.find((c) => c.dow === 1 && c.hour === 18);
    expect(hour17?.splh).toBe(400);
    expect(hour18?.splh).toBe(200);

    expect(result.current.daily).toHaveLength(1);
    expect(result.current.daily[0].bucketStart).toBe('2026-07-06');
    expect(result.current.weekly).toHaveLength(1);

    expect(result.current.summary.actualSplh).toBe(300);
    expect(result.current.target).toBe(60);

    expect(result.current.hasHourlyBreakdown).toBe(true);
    expect(result.current.hasData).toBe(true);
    expect(result.current.capped).toBe(false);
  });

  it('passes restaurantId, validated tz, and the fixed 12-week window through to useSplhData', () => {
    setup({ timezone: 'Not/AValidZone' });

    renderHook(() => useSplhAnalytics('rest-1'), { wrapper: createWrapper() });

    expect(mockUseSplhData).toHaveBeenCalledWith('rest-1', 'UTC', 12);
  });

  it('flags hasHourlyBreakdown false when no sale row has a sold_at timestamp (POS lacks per-sale time)', async () => {
    setup({
      data: {
        sales: [{ sale_date: '2026-07-06', sale_time: null, sold_at: null, total_price: 100 }],
        punches: PUNCHES,
        capped: false,
      },
    });

    const { result } = renderHook(() => useSplhAnalytics('rest-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasHourlyBreakdown).toBe(false);
  });

  it('surfaces capped:true and hasData:false through from useSplhData / empty sales', () => {
    setup({ data: { sales: [], punches: [], capped: true } });

    const { result } = renderHook(() => useSplhAnalytics('rest-1'), { wrapper: createWrapper() });

    expect(result.current.capped).toBe(true);
    expect(result.current.hasData).toBe(false);
    expect(result.current.summary.actualSplh).toBeNull();
  });

  it('returns empty grid/daily/weekly and default capped/hasData when data is still undefined (loading)', () => {
    setup({ noData: true, isLoading: true });

    const { result } = renderHook(() => useSplhAnalytics('rest-1'), { wrapper: createWrapper() });

    expect(result.current.grid).toEqual([]);
    expect(result.current.daily).toEqual([]);
    expect(result.current.weekly).toEqual([]);
    expect(result.current.capped).toBe(false);
    expect(result.current.hasData).toBe(false);
    expect(result.current.isLoading).toBe(true);
  });
});
