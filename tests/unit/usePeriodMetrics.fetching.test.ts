import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// usePeriodMetrics must report isFetching:true while EITHER side still
// fetches. A prior bug read only the revenue query's isFetching flag, so
// the dashboard cleared its dim overlay while the cost queries (COGS +
// labor) still ran and showed stale numbers.

const mockUseRevenueBreakdown = vi.fn();
const mockUseCostsFromSource = vi.fn();

vi.mock('@/hooks/useRevenueBreakdown', () => ({
  useRevenueBreakdown: mockUseRevenueBreakdown,
}));

vi.mock('@/hooks/useCostsFromSource', () => ({
  useCostsFromSource: mockUseCostsFromSource,
}));

function revenueResult(isFetching: boolean) {
  return {
    data: null,
    isLoading: false,
    isFetching,
    error: null,
    refetch: () => {},
  };
}

function costsResult(isFetching: boolean) {
  return {
    dailyCosts: [],
    totalFoodCost: 0,
    totalLaborCost: 0,
    pendingLaborCost: 0,
    actualLaborCost: 0,
    laborBasis: 'accrued',
    totalCost: 0,
    capped: false,
    isLoading: false,
    isFetching,
    error: null,
    refetch: () => {},
  };
}

describe('usePeriodMetrics isFetching signal', () => {
  it('reports isFetching:true when only the cost side still fetches', async () => {
    mockUseRevenueBreakdown.mockReturnValue(revenueResult(false));
    mockUseCostsFromSource.mockReturnValue(costsResult(true));

    const { usePeriodMetrics } = await import('@/hooks/usePeriodMetrics');
    const { result } = renderHook(() => usePeriodMetrics('rest-1', new Date(), new Date()));

    expect(result.current.isFetching).toBe(true);
  });

  it('reports isFetching:false when neither side fetches', async () => {
    mockUseRevenueBreakdown.mockReturnValue(revenueResult(false));
    mockUseCostsFromSource.mockReturnValue(costsResult(false));

    const { usePeriodMetrics } = await import('@/hooks/usePeriodMetrics');
    const { result } = renderHook(() => usePeriodMetrics('rest-1', new Date(), new Date()));

    expect(result.current.isFetching).toBe(false);
  });
});
