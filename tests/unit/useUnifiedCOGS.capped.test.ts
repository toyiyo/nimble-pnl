import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

let cogsMethod: 'inventory' | 'financials' | 'combined' = 'combined';

vi.mock('@/hooks/useFoodCosts', () => ({
  useFoodCosts: () => ({
    dailyCosts: [],
    totalCost: 0,
    capped: false,
    isLoading: false,
    error: null,
    refetch: () => {},
  }),
}));

vi.mock('@/hooks/useCOGSFromFinancials', () => ({
  useCOGSFromFinancials: () => ({
    dailyCosts: [],
    totalCost: 0,
    capped: true,
    isLoading: false,
    error: null,
    refetch: () => {},
  }),
}));

vi.mock('@/hooks/useFinancialSettings', () => ({
  useFinancialSettings: () => ({ cogsMethod, isLoading: false }),
}));

describe('useUnifiedCOGS capped flag', () => {
  it('reports capped for the combined method when either source is capped', async () => {
    cogsMethod = 'combined';
    const { useUnifiedCOGS } = await import('@/hooks/useUnifiedCOGS');
    const { result } = renderHook(() => useUnifiedCOGS('rest-1', new Date(), new Date()));
    expect(result.current.capped).toBe(true);
  });

  it('reports not capped for the inventory method when only financials is capped', async () => {
    cogsMethod = 'inventory';
    const { useUnifiedCOGS } = await import('@/hooks/useUnifiedCOGS');
    const { result } = renderHook(() => useUnifiedCOGS('rest-1', new Date(), new Date()));
    expect(result.current.capped).toBe(false);
  });

  it('reports capped for the financials method', async () => {
    cogsMethod = 'financials';
    const { useUnifiedCOGS } = await import('@/hooks/useUnifiedCOGS');
    const { result } = renderHook(() => useUnifiedCOGS('rest-1', new Date(), new Date()));
    expect(result.current.capped).toBe(true);
  });
});
