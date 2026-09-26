import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useClaimableTrades } from '@/hooks/useClaimableTrades';
import { SHIFT_PROTECTION_DEFAULTS } from '@/lib/shiftProtection';
import type { MarketplaceTrade } from '@/lib/claimableTrades';

const mocks = vi.hoisted(() => ({
  useMarketplaceTrades: vi.fn(),
  useShiftProtection: vi.fn(),
  usePermissions: vi.fn(),
}));

vi.mock('@/hooks/useShiftTrades', () => ({
  useMarketplaceTrades: mocks.useMarketplaceTrades,
}));
vi.mock('@/hooks/useShiftProtection', () => ({
  useShiftProtection: mocks.useShiftProtection,
}));
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: mocks.usePermissions,
}));

const NOW = new Date('2026-09-25T15:00:00Z');
const HOUR = 60 * 60 * 1000;

function trade(id: string, startOffsetMs: number, posterId = 'emp-poster'): MarketplaceTrade {
  const start = new Date(NOW.getTime() + startOffsetMs);
  return {
    id,
    restaurant_id: 'rest-1',
    offered_shift_id: `shift-${id}`,
    offered_by_employee_id: posterId,
    requested_shift_id: null,
    target_employee_id: null,
    accepted_by_employee_id: null,
    status: 'open',
    reason: null,
    manager_note: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: '2026-09-20T12:00:00Z',
    updated_at: '2026-09-20T12:00:00Z',
    offered_shift: {
      id: `shift-${id}`,
      start_time: start.toISOString(),
      end_time: new Date(start.getTime() + 6 * HOUR).toISOString(),
      position: 'Server',
      break_duration: 0,
      is_published: true,
    },
    offered_by: { id: posterId, name: 'Maria', email: null, position: 'Server', area: null },
    hasConflict: false,
  };
}

const refetch = vi.fn();

function marketplace(trades: MarketplaceTrade[], extra: Record<string, unknown> = {}) {
  return { trades, loading: false, error: null, refetch, ...extra };
}

describe('useClaimableTrades', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    mocks.useShiftProtection.mockReturnValue({
      protection: SHIFT_PROTECTION_DEFAULTS,
      isLoading: false,
      error: null,
      hasData: true,
    });
    mocks.usePermissions.mockReturnValue({ hasCapability: () => false, isResolved: true });
    mocks.useMarketplaceTrades.mockReturnValue(marketplace([]));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('disables the marketplace query and reports loading with no employee', () => {
    mocks.useMarketplaceTrades.mockReturnValue(marketplace([trade('a', HOUR)]));
    const { result } = renderHook(() => useClaimableTrades('rest-1', null));

    expect(mocks.useMarketplaceTrades).toHaveBeenCalledWith('rest-1', null, { enabled: false });
    expect(result.current.count).toBe(0);
    expect(result.current.trades).toEqual([]);
    expect(result.current.loading).toBe(true);
  });

  it('disables the marketplace query with no restaurant', () => {
    renderHook(() => useClaimableTrades(null, 'emp-me'));
    expect(mocks.useMarketplaceTrades).toHaveBeenCalledWith(null, 'emp-me', { enabled: false });
  });

  it('enables the query and counts the claimable trades', () => {
    mocks.useMarketplaceTrades.mockReturnValue(
      marketplace([trade('a', 3 * HOUR), trade('mine', 3 * HOUR, 'emp-me'), trade('b', 30 * HOUR)]),
    );
    const { result } = renderHook(() => useClaimableTrades('rest-1', 'emp-me'));

    expect(mocks.useMarketplaceTrades).toHaveBeenCalledWith('rest-1', 'emp-me', { enabled: true });
    expect(result.current.loading).toBe(false);
    expect(result.current.count).toBe(2);
    expect(result.current.trades.map((t) => t.trade.id)).toEqual(['a', 'b']);
  });

  it('passes the loading state, the error and refetch through', () => {
    const error = new Error('boom');
    mocks.useMarketplaceTrades.mockReturnValue(marketplace([], { loading: true, error }));
    const { result } = renderHook(() => useClaimableTrades('rest-1', 'emp-me'));

    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBe(error);
    result.current.refetch();
    expect(refetch).toHaveBeenCalled();
  });

  it('applies the block rule, and exempts a caller with edit:scheduling', () => {
    mocks.useShiftProtection.mockReturnValue({
      protection: { ...SHIFT_PROTECTION_DEFAULTS, trade_deadline_mode: 'block', trade_deadline_hours: 24 },
      isLoading: false,
      error: null,
    });
    mocks.useMarketplaceTrades.mockReturnValue(marketplace([trade('a', 3 * HOUR)]));

    const blocked = renderHook(() => useClaimableTrades('rest-1', 'emp-me'));
    expect(blocked.result.current.count).toBe(0);

    mocks.usePermissions.mockReturnValue({
      hasCapability: (cap: string) => cap === 'edit:scheduling',
      isResolved: true,
    });
    const exempt = renderHook(() => useClaimableTrades('rest-1', 'emp-me'));
    expect(exempt.result.current.count).toBe(1);
  });

  it('keeps the count at 0 while the protection settings load', () => {
    mocks.useShiftProtection.mockReturnValue({ protection: SHIFT_PROTECTION_DEFAULTS, isLoading: true, error: null });
    mocks.useMarketplaceTrades.mockReturnValue(marketplace([trade('a', 3 * HOUR)]));
    const { result } = renderHook(() => useClaimableTrades('rest-1', 'emp-me'));

    expect(result.current.loading).toBe(true);
    expect(result.current.count).toBe(0);
    expect(result.current.trades).toEqual([]);
  });

  it('keeps the count at 0 until the permissions resolve', () => {
    mocks.usePermissions.mockReturnValue({ hasCapability: () => false, isResolved: false });
    mocks.useMarketplaceTrades.mockReturnValue(marketplace([trade('a', 3 * HOUR)]));
    const { result } = renderHook(() => useClaimableTrades('rest-1', 'emp-me'));

    expect(result.current.loading).toBe(true);
    expect(result.current.count).toBe(0);
  });

  it('reads the protection settings only when the query is enabled', () => {
    renderHook(() => useClaimableTrades('rest-1', null));
    expect(mocks.useShiftProtection).toHaveBeenCalledWith(null);

    renderHook(() => useClaimableTrades('rest-1', 'emp-me'));
    expect(mocks.useShiftProtection).toHaveBeenLastCalledWith('rest-1');
  });

  it('returns no trades and shows the error on a protection error with no cached settings', () => {
    const protectionError = new Error('rpc failed');
    mocks.useShiftProtection.mockReturnValue({
      protection: SHIFT_PROTECTION_DEFAULTS,
      isLoading: false,
      error: protectionError,
      hasData: false,
    });
    mocks.useMarketplaceTrades.mockReturnValue(marketplace([trade('a', 3 * HOUR), trade('b', 48 * HOUR)]));

    const { result } = renderHook(() => useClaimableTrades('rest-1', 'emp-me'));
    expect(result.current.trades).toEqual([]);
    expect(result.current.count).toBe(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(protectionError);
  });

  it('uses the cached settings when a background refetch of the protection settings fails', () => {
    mocks.useShiftProtection.mockReturnValue({
      protection: { ...SHIFT_PROTECTION_DEFAULTS, trade_deadline_mode: 'off', trade_deadline_hours: 24 },
      isLoading: false,
      error: new Error('refetch failed'),
      hasData: true,
    });
    mocks.useMarketplaceTrades.mockReturnValue(marketplace([trade('a', 3 * HOUR), trade('b', 48 * HOUR)]));

    const off = renderHook(() => useClaimableTrades('rest-1', 'emp-me'));
    expect(off.result.current.loading).toBe(false);
    expect(off.result.current.trades.map((t) => t.trade.id)).toEqual(['a', 'b']);

    mocks.useShiftProtection.mockReturnValue({
      protection: { ...SHIFT_PROTECTION_DEFAULTS, trade_deadline_mode: 'block', trade_deadline_hours: 24 },
      isLoading: false,
      error: new Error('refetch failed'),
      hasData: true,
    });
    const block = renderHook(() => useClaimableTrades('rest-1', 'emp-me'));
    expect(block.result.current.trades.map((t) => t.trade.id)).toEqual(['b']);
  });

  it('drops a trade when the tick passes its start', () => {
    const trades = [trade('a', 90 * 1000), trade('b', 5 * HOUR)];
    mocks.useMarketplaceTrades.mockReturnValue(marketplace(trades));
    const { result } = renderHook(() => useClaimableTrades('rest-1', 'emp-me'));
    expect(result.current.count).toBe(2);

    act(() => {
      vi.setSystemTime(new Date(NOW.getTime() + 2 * 60 * 1000));
      vi.advanceTimersByTime(60_000);
    });

    expect(result.current.count).toBe(1);
    expect(result.current.trades[0].trade.id).toBe('b');
  });

  it('uses the caller clock when nowMs is given, and starts no interval', () => {
    const intervalSpy = vi.spyOn(window, 'setInterval');
    const trades = [trade('a', 90 * 1000), trade('b', 5 * HOUR)];
    mocks.useMarketplaceTrades.mockReturnValue(marketplace(trades));

    const { result } = renderHook(() =>
      useClaimableTrades('rest-1', 'emp-me', NOW.getTime() + 2 * 60 * 1000),
    );

    expect(result.current.trades.map((t) => t.trade.id)).toEqual(['b']);
    expect(intervalSpy).not.toHaveBeenCalled();
    intervalSpy.mockRestore();
  });
});
