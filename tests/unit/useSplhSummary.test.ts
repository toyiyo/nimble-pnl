import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// --- Mock every collaborator hook so we test only useSplhSummary's wiring
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

import { useSplhSummary } from '@/hooks/useSplhSummary';

const SALES = [
  { sale_date: '2026-07-06', sale_time: '17:00:00', sold_at: '2026-07-06T17:00:00Z', total_price: 400 },
  { sale_date: '2026-07-06', sale_time: '18:00:00', sold_at: '2026-07-06T18:00:00Z', total_price: 200 },
  { sale_date: '2026-07-07', sale_time: '17:00:00', sold_at: '2026-07-07T17:00:00Z', total_price: 300 },
];

const PUNCHES = [
  { id: 'p1', restaurant_id: 'rest-1', employee_id: 'emp-1', punch_type: 'clock_in', punch_time: '2026-07-06T17:00:00Z' },
  { id: 'p2', restaurant_id: 'rest-1', employee_id: 'emp-1', punch_type: 'clock_out', punch_time: '2026-07-06T19:00:00Z' },
  { id: 'p3', restaurant_id: 'rest-1', employee_id: 'emp-1', punch_type: 'clock_in', punch_time: '2026-07-07T17:00:00Z' },
  { id: 'p4', restaurant_id: 'rest-1', employee_id: 'emp-1', punch_type: 'clock_out', punch_time: '2026-07-07T18:00:00Z' },
];

const EMPLOYEES = [
  { id: 'emp-1', compensation_type: 'hourly', is_active: true, hourly_rate: 20 },
];

function setup(overrides: {
  target_splh?: number;
  data?: { sales: typeof SALES; punches: typeof PUNCHES; capped: boolean };
  noData?: boolean;
  isLoading?: boolean;
  isError?: boolean;
} = {}) {
  mockUseRestaurantContext.mockReturnValue({
    selectedRestaurant: { restaurant: { timezone: 'UTC' } },
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

describe('useSplhSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computes summary + a daily sparkline (no grid/weekly — dashboard is lighter than the planner)', async () => {
    setup();

    const { result } = renderHook(() => useSplhSummary('rest-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // $900 total sales / 3h total worked = 300 SPLH.
    expect(result.current.summary.actualSplh).toBe(300);
    expect(result.current.target).toBe(60);
    expect(result.current.hasData).toBe(true);

    // One point per sale day.
    expect(result.current.sparkline).toHaveLength(2);
    expect(result.current.sparkline.map((p) => p.bucketStart)).toEqual(['2026-07-06', '2026-07-07']);

    // Dashboard variant exposes no grid/weekly/hasHourlyBreakdown fields.
    expect(result.current).not.toHaveProperty('grid');
    expect(result.current).not.toHaveProperty('weekly');
  });

  it('passes restaurantId + validated tz + the 4-week window through to useSplhData', () => {
    setup();

    renderHook(() => useSplhSummary('rest-1'), { wrapper: createWrapper() });

    expect(mockUseSplhData).toHaveBeenCalledWith('rest-1', 'UTC', 4);
  });

  it('reports hasData:false and a null actualSplh with no sales', () => {
    setup({ data: { sales: [], punches: [], capped: false } });

    const { result } = renderHook(() => useSplhSummary('rest-1'), { wrapper: createWrapper() });

    expect(result.current.hasData).toBe(false);
    expect(result.current.summary.actualSplh).toBeNull();
    expect(result.current.sparkline).toEqual([]);
  });

  it('surfaces isLoading/isError from useSplhData before data resolves', () => {
    setup({ noData: true, isLoading: true, isError: false });

    const { result } = renderHook(() => useSplhSummary('rest-1'), { wrapper: createWrapper() });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isError).toBe(false);
    expect(result.current.hasData).toBe(false);
    expect(result.current.sparkline).toEqual([]);
  });

  it('forwards useSplhData\'s refetch for the card\'s error-state retry button', () => {
    setup();

    const { result } = renderHook(() => useSplhSummary('rest-1'), { wrapper: createWrapper() });

    expect(typeof result.current.refetch).toBe('function');
  });
});
