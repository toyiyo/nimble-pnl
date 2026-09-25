import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useAvailableShifts } from '@/hooks/useAvailableShifts';

const mocks = vi.hoisted(() => ({
  useOpenShifts: vi.fn(),
  useMarketplaceTrades: vi.fn(),
}));

vi.mock('@/hooks/useOpenShifts', () => ({
  useOpenShifts: mocks.useOpenShifts,
}));

vi.mock('@/hooks/useShiftTrades', () => ({
  useMarketplaceTrades: mocks.useMarketplaceTrades,
}));

const START = new Date(2026, 8, 21);
const END = new Date(2026, 9, 4);

describe('useAvailableShifts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useOpenShifts.mockReturnValue({ openShifts: [], loading: false, error: null, refetch: vi.fn() });
    mocks.useMarketplaceTrades.mockReturnValue({ trades: [], loading: false, error: null, refetch: vi.fn() });
  });

  it('holds the trades query until the employee is known', () => {
    renderHook(() => useAvailableShifts('rest-1', null, START, END));
    expect(mocks.useMarketplaceTrades).toHaveBeenCalledWith('rest-1', null, { enabled: false });
  });

  it('enables the trades query with an employee', () => {
    renderHook(() => useAvailableShifts('rest-1', 'emp-1', START, END));
    expect(mocks.useMarketplaceTrades).toHaveBeenCalledWith('rest-1', 'emp-1', { enabled: true });
  });
});
