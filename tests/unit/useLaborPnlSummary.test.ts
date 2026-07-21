import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// --- Mock every collaborator hook `useLaborPnlCore` composes so we test only
// `useLaborPnlSummary`'s wiring (`buildFinancialSeries`/`summarizeLaborPnl`
// are exercised for real, using their own unit tests in
// laborPnlAnalytics.test.ts) — mirrors useSplhSummary.test.ts's pattern of
// mocking useSplhCore's collaborators rather than useSplhCore itself, so the
// core+summary composition is covered end-to-end. ---
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

import { useLaborPnlSummary } from '@/hooks/useLaborPnlSummary';

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
    data: overrides.data ?? { sales: SALES, punches: PUNCHES, capped: false },
    isLoading: overrides.isLoading ?? false,
    isError: overrides.isError ?? false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseLaborCostsFromTimeTracking.mockReturnValue({
    dailyCosts: overrides.dailyLabor ?? DAILY_LABOR,
    totalCost: 80,
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

describe('useLaborPnlSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes restaurantId + validated tz + the 4-week window through to useSplhData', () => {
    setup({ timezone: 'Not/AValidZone' });

    renderHook(() => useLaborPnlSummary('rest-1'), { wrapper: createWrapper() });

    expect(mockUseSplhData).toHaveBeenCalledWith('rest-1', 'UTC', 4);
  });

  it('CRITICAL: reconciliation — summary totals equal the sum of the daily sparkline series', async () => {
    setup();

    const { result } = renderHook(() => useLaborPnlSummary('rest-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // One sparkline point per sale day, each a real FinancialPoint.
    expect(result.current.sparkline).toHaveLength(2);
    expect(result.current.sparkline.map((p) => p.bucketStart)).toEqual([
      '2026-07-06',
      '2026-07-07',
    ]);

    const summedSales = result.current.sparkline.reduce((sum, p) => sum + p.sales, 0);
    const summedLaborCost = result.current.sparkline.reduce((sum, p) => sum + p.laborCost, 0);
    expect(result.current.summary.sales).toBeCloseTo(summedSales, 2);
    expect(result.current.summary.laborCost).toBeCloseTo(summedLaborCost, 2);

    // $600 total sales, $80 total labor cost => 13.33%.
    expect(result.current.summary.sales).toBe(600);
    expect(result.current.summary.laborCost).toBe(80);
    expect(result.current.summary.laborPct).toBeCloseTo(13.33, 1);
    expect(result.current.targetPct).toBe(22);
  });

  it('labor% is null and verdictTone is "none" when the window has no sales', () => {
    setup({ data: { sales: [], punches: [], capped: false }, dailyLabor: [] });

    const { result } = renderHook(() => useLaborPnlSummary('rest-1'), { wrapper: createWrapper() });

    expect(result.current.sparkline).toEqual([]);
    expect(result.current.summary.laborPct).toBeNull();
    expect(result.current.summary.verdictTone).toBe('none');
  });

  it('CRITICAL: no hourly grid is built for the dashboard card', () => {
    setup();

    const { result } = renderHook(() => useLaborPnlSummary('rest-1'), { wrapper: createWrapper() });

    expect(result.current).not.toHaveProperty('grid');
  });

  it('propagates capped, hasData, isLoading/isError/error, and refetch from the core hook', () => {
    setup({ data: { sales: SALES, punches: PUNCHES, capped: true }, laborError: new Error('boom') });

    const { result } = renderHook(() => useLaborPnlSummary('rest-1'), { wrapper: createWrapper() });

    expect(result.current.capped).toBe(true);
    expect(result.current.hasData).toBe(true);
    expect(result.current.isError).toBe(true);
    expect(result.current.error).toEqual(new Error('boom'));
    expect(typeof result.current.refetch).toBe('function');
  });
});
