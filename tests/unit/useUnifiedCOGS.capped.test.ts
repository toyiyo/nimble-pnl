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
  // The mocks above cap financials only. The flag must follow the active
  // method: inventory ignores the financial cap, the other two report it.
  it.each([
    { method: 'combined', expected: true },
    { method: 'inventory', expected: false },
    { method: 'financials', expected: true },
  ] as const)('reports capped=$expected for the $method method', async ({ method, expected }) => {
    cogsMethod = method;
    const { useUnifiedCOGS } = await import('@/hooks/useUnifiedCOGS');
    const { result } = renderHook(() => useUnifiedCOGS('rest-1', new Date(), new Date()));
    expect(result.current.capped).toBe(expected);
  });
});
