import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// --- Mock every collaborator hook so we test only useSplhCore's wiring
// (buildSplhGrid/summarizeSplh/identifyWorkSessions are exercised for real,
// using their own unit tests in splhAnalytics.test.ts). Same pattern as
// useSplhAnalytics.test.ts / useSplhSummary.test.ts, which extract their
// setup logic from this shared hook. ---
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

import { useSplhCore } from '@/hooks/useSplhCore';

const SALES = [
  // Monday 2026-07-06, 17:00 UTC — lands in the same hour/dow bucket as the
  // work session below so the grid cell resolves to a real (non-null) SPLH.
  { sale_date: '2026-07-06', sale_time: '17:00:00', sold_at: '2026-07-06T17:00:00Z', total_price: 400 },
];

const PUNCHES = [
  { id: 'p1', restaurant_id: 'rest-1', employee_id: 'emp-1', punch_type: 'clock_in', punch_time: '2026-07-06T17:00:00Z' },
  { id: 'p2', restaurant_id: 'rest-1', employee_id: 'emp-1', punch_type: 'clock_out', punch_time: '2026-07-06T18:00:00Z' },
];

const EMPLOYEES = [
  { id: 'emp-1', compensation_type: 'hourly', is_active: true, hourly_rate: 20 },
];

function setup(overrides: {
  timezone?: string;
  target_splh?: number;
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

describe('useSplhCore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds a non-empty grid and a matching summary from sales+punches', async () => {
    setup();

    const { result } = renderHook(() => useSplhCore('rest-1', 4), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.grid).toHaveLength(7 * 24);
    const cell = result.current.grid.find((c) => c.dow === 1 && c.hour === 17);
    expect(cell?.splh).toBe(400);
    expect(result.current.summary.actualSplh).toBe(400);
    expect(result.current.target).toBe(60);
    expect(result.current.tz).toBe('UTC');
    expect(result.current.hasData).toBe(true);
  });

  it('passes restaurantId, validated tz, and the given `weeks` window through to useSplhData', () => {
    setup({ timezone: 'Not/AValidZone' });

    renderHook(() => useSplhCore('rest-1', 12), { wrapper: createWrapper() });

    expect(mockUseSplhData).toHaveBeenCalledWith('rest-1', 'UTC', 12);
  });

  it('returns empty grid, null summary.actualSplh, and hasData:false when data is undefined (loading)', () => {
    setup({ noData: true, isLoading: true });

    const { result } = renderHook(() => useSplhCore('rest-1', 4), { wrapper: createWrapper() });

    expect(result.current.grid).toEqual([]);
    expect(result.current.summary.actualSplh).toBeNull();
    expect(result.current.hasData).toBe(false);
    expect(result.current.isLoading).toBe(true);
  });

  it('CRITICAL: hasData is false when sales exist but zero punches were recorded (time-tracking not set up)', () => {
    // Per design §6: "empty (no sales or no punches) -> EmptyState inviting
    // POS connect / time-tracking enable." Sales present + zero punches
    // anywhere in the window must route to the setup-invite empty state, not
    // silently render an all-"no-labor" heatmap.
    setup({ data: { sales: SALES, punches: [], capped: false } });

    const { result } = renderHook(() => useSplhCore('rest-1', 4), { wrapper: createWrapper() });

    expect(result.current.hasData).toBe(false);
  });

  it('surfaces isError/refetch from useSplhData', () => {
    setup({ isError: true });

    const { result } = renderHook(() => useSplhCore('rest-1', 4), { wrapper: createWrapper() });

    expect(result.current.isError).toBe(true);
    expect(typeof result.current.refetch).toBe('function');
  });
});
