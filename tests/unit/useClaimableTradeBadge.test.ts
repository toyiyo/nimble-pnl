import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useClaimableTradeBadge } from '@/hooks/useClaimableTradeBadge';

const mocks = vi.hoisted(() => ({
  selectedRestaurant: { restaurant_id: 'rest-1' } as { restaurant_id: string } | null,
  currentEmployee: { id: 'emp-1' } as { id: string } | null,
  useClaimableTrades: vi.fn(),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({ selectedRestaurant: mocks.selectedRestaurant }),
}));

vi.mock('@/hooks/useCurrentEmployee', () => ({
  useCurrentEmployee: () => ({ currentEmployee: mocks.currentEmployee, loading: false, error: null }),
}));

vi.mock('@/hooks/useClaimableTrades', () => ({
  useClaimableTrades: mocks.useClaimableTrades,
}));

function claimable(urgentFlags: boolean[], extra: Record<string, unknown> = {}) {
  return {
    trades: urgentFlags.map((urgent) => ({ urgent })),
    count: urgentFlags.length,
    loading: false,
    error: null,
    refetch: vi.fn(),
    ...extra,
  };
}

describe('useClaimableTradeBadge', () => {
  beforeEach(() => {
    mocks.selectedRestaurant = { restaurant_id: 'rest-1' };
    mocks.currentEmployee = { id: 'emp-1' };
    mocks.useClaimableTrades.mockReset();
    mocks.useClaimableTrades.mockReturnValue(claimable([]));
  });

  it('passes the restaurant and the employee to useClaimableTrades', () => {
    renderHook(() => useClaimableTradeBadge());
    expect(mocks.useClaimableTrades).toHaveBeenCalledWith('rest-1', 'emp-1');
  });

  it('passes null ids with no restaurant or no employee row', () => {
    mocks.selectedRestaurant = null;
    mocks.currentEmployee = null;
    renderHook(() => useClaimableTradeBadge());
    expect(mocks.useClaimableTrades).toHaveBeenCalledWith(null, null);
  });

  it('returns the count, and hasUrgentTrade when one trade is urgent', () => {
    mocks.useClaimableTrades.mockReturnValue(claimable([false, true]));
    const { result } = renderHook(() => useClaimableTradeBadge());
    expect(result.current).toEqual({ count: 2, hasUrgentTrade: true });
  });

  it('returns hasUrgentTrade false when no trade is urgent', () => {
    mocks.useClaimableTrades.mockReturnValue(claimable([false]));
    const { result } = renderHook(() => useClaimableTradeBadge());
    expect(result.current).toEqual({ count: 1, hasUrgentTrade: false });
  });

  it('returns 0 while the data loads', () => {
    mocks.useClaimableTrades.mockReturnValue(claimable([true], { loading: true }));
    const { result } = renderHook(() => useClaimableTradeBadge());
    expect(result.current).toEqual({ count: 0, hasUrgentTrade: false });
  });

  it('returns 0 on an error', () => {
    mocks.useClaimableTrades.mockReturnValue(claimable([true], { error: new Error('boom') }));
    const { result } = renderHook(() => useClaimableTradeBadge());
    expect(result.current).toEqual({ count: 0, hasUrgentTrade: false });
  });
});
