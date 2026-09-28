import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUseWeekStaffingSuggestions } = vi.hoisted(() => ({
  mockUseWeekStaffingSuggestions: vi.fn(),
}));

vi.mock('@/hooks/useWeekStaffingSuggestions', () => ({
  useWeekStaffingSuggestions: (...args: unknown[]) => mockUseWeekStaffingSuggestions(...args),
}));

import { useDailyLaborPercent } from '@/hooks/useDailyLaborPercent';

const WEEK = ['2026-09-28', '2026-09-29'];

function mockSuggestions(overrides: Record<string, unknown> = {}) {
  mockUseWeekStaffingSuggestions.mockReturnValue({
    daySuggestions: new Map([
      ['2026-09-28', { totalProjectedSales: 1000 }],
      ['2026-09-29', { totalProjectedSales: 0 }],
    ]),
    activeSettings: { target_labor_pct: 20, lookback_weeks: 8 },
    isLoading: false,
    hasSalesData: true,
    ...overrides,
  });
}

describe('useDailyLaborPercent', () => {
  beforeEach(() => {
    mockUseWeekStaffingSuggestions.mockReset();
  });

  it('reads projected sales from the week staffing suggestions without overrides', () => {
    mockSuggestions();
    renderHook(() => useDailyLaborPercent('r1', WEEK, []));

    expect(mockUseWeekStaffingSuggestions).toHaveBeenCalledWith('r1', WEEK, null);
  });

  it('combines scheduled cost with projected sales and the target', () => {
    mockSuggestions();
    const { result } = renderHook(() =>
      useDailyLaborPercent('r1', WEEK, [{ date: '2026-09-28', total_labor_cost: 250 }]),
    );

    expect(result.current.byDay.get('2026-09-28')).toEqual({
      laborCost: 250,
      projectedSales: 1000,
      percent: 25,
      overTarget: true,
    });
    expect(result.current.byDay.get('2026-09-29')?.percent).toBeNull();
    expect(result.current.targetLaborPct).toBe(20);
    expect(result.current.lookbackWeeks).toBe(8);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.hasSalesData).toBe(true);
  });

  it('treats a day with no suggestion as zero projected sales', () => {
    mockSuggestions({ daySuggestions: new Map() });
    const { result } = renderHook(() =>
      useDailyLaborPercent('r1', WEEK, [{ date: '2026-09-28', total_labor_cost: 250 }]),
    );

    expect(result.current.byDay.get('2026-09-28')).toMatchObject({
      projectedSales: 0,
      percent: null,
    });
  });

  it('passes the loading state through', () => {
    mockSuggestions({ isLoading: true, hasSalesData: false });
    const { result } = renderHook(() => useDailyLaborPercent('r1', WEEK, []));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.hasSalesData).toBe(false);
  });
});
