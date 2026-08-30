import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/hooks/useRevenueBreakdown', () => ({
  useRevenueBreakdown: () => ({
    data: null,
    isLoading: false,
    error: null,
    refetch: () => {},
  }),
}));

vi.mock('@/hooks/useCostsFromSource', () => ({
  useCostsFromSource: () => ({
    dailyCosts: [],
    totalFoodCost: 0,
    totalLaborCost: 0,
    pendingLaborCost: 0,
    actualLaborCost: 0,
    laborBasis: 'accrued',
    totalCost: 0,
    capped: true,
    isLoading: false,
    error: null,
    refetch: () => {},
  }),
}));

describe('usePeriodMetrics capped flag', () => {
  it('passes the costs capped flag through', async () => {
    const { usePeriodMetrics } = await import('@/hooks/usePeriodMetrics');
    const { result } = renderHook(() => usePeriodMetrics('rest-1', new Date(), new Date()));
    expect(result.current.capped).toBe(true);
  });
});
