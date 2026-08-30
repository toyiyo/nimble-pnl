/**
 * Regression: useMonthlyMetrics's time_punches DB fetch widens on BOTH
 * ends to the ISO week (WEEK_STARTS_ON) that contains dateFrom / dateTo.
 *
 * calculateActualLaborCostForMonth buckets punches by ISO week and bands
 * overtime over the FULL week. When dateFrom or dateTo falls mid-week, the
 * days outside [dateFrom, dateTo] in that same edge week must still be
 * fetched, or that week's hour total comes out too low and hours that
 * should band as overtime cost as straight time instead. The dateFrom side
 * was a CodeRabbit finding (same bug class already fixed in
 * useLaborCostsFromTimeTracking.tsx — see
 * useLaborCostsFromTimeTracking.fetchRange.test.ts); the dateTo side is a
 * sound-logic follow-up finding on this hook.
 *
 * No post-fetch filtering is required here (unlike the sibling hook):
 * calculateActualLaborCostForRange only counts a day's wages when that day
 * falls inside [rangeStart, rangeEnd], so the extra look-back/look-ahead
 * days feed OT banding only and never inflate a month's totals.
 */
import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { startOfWeek } from 'date-fns';
import { lookaheadPunchFetchRange, weekAlignedFetchEnd } from '@/utils/punchWindow';
import { WEEK_STARTS_ON } from '@/lib/dateConfig';

// useMonthlyMetrics now sources the restaurant timezone from
// useRestaurantClock (via useRestaurantContext) to bucket accrued labor by
// the restaurant's calendar day. This file only asserts the time_punches
// fetch *range* bounds, so the specific value is not load-bearing.
vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { timezone: 'America/Chicago' } },
  }),
}));

const RESTAURANT = 'rest-week-aligned-1';

// Generic chainable Supabase query-builder mock for tables/RPCs this file
// does not assert on — resolves to an empty payload regardless of chain
// shape (mirrors the pattern in useMonthlyMetrics.pagination.test.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChainable(data: unknown = []): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  ['select', 'eq', 'in', 'order', 'gte', 'lte', 'lt', 'is', 'or', 'limit', 'maybeSingle'].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  chain.range = vi.fn(() => Promise.resolve({ data, error: null }));
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data, error: null });
  return chain;
}

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

describe('useMonthlyMetrics time_punches fetch range (ISO-week OT banding)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('widens the fetch start to the ISO week start when dateFrom falls mid-week, keeping the look-ahead end', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const timePunchesChain: any = {};
    ['select', 'eq', 'order'].forEach((m) => {
      timePunchesChain[m] = vi.fn(() => timePunchesChain);
    });
    timePunchesChain.gte = vi.fn(() => timePunchesChain);
    timePunchesChain.lte = vi.fn(() => timePunchesChain);
    timePunchesChain.range = vi.fn(() => Promise.resolve({ data: [], error: null }));

    const fromMock = vi.fn((table: string) => {
      if (table === 'time_punches') return timePunchesChain;
      return makeChainable([]);
    });
    const rpcMock = vi.fn(() => Promise.resolve({ data: [], error: null }));

    vi.doMock('@/integrations/supabase/client', () => ({
      supabase: {
        from: (...args: [string]) => fromMock(...args),
        rpc: (...args: unknown[]) => rpcMock(...args),
      },
    }));

    const { useMonthlyMetrics } = await import('@/hooks/useMonthlyMetrics');

    // A Monday-start week runs Jul 20 - Jul 26, 2026. dateFrom lands
    // mid-week (Wednesday), so the DB fetch start must widen back to
    // Jul 20, NOT stay at dateFrom.
    const dateFrom = new Date(2026, 6, 22); // 2026-07-22, a Wednesday
    const dateTo = new Date(2026, 6, 31, 23, 59, 59, 999);
    const { fetchEnd } = lookaheadPunchFetchRange(dateFrom, dateTo);
    const weekAlignedStart = startOfWeek(dateFrom, { weekStartsOn: WEEK_STARTS_ON });
    const expectedFetchEnd = weekAlignedFetchEnd(dateTo, fetchEnd);

    const { result } = renderHook(
      () => useMonthlyMetrics(RESTAURANT, dateFrom, dateTo),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fromMock).toHaveBeenCalledWith('time_punches');
    expect(timePunchesChain.gte).toHaveBeenCalledWith('punch_time', weekAlignedStart.toISOString());
    expect(timePunchesChain.lte).toHaveBeenCalledWith('punch_time', expectedFetchEnd.toISOString());
    // dateFrom is mid-week, so the widened start is strictly before it.
    expect(weekAlignedStart.getTime()).toBeLessThan(dateFrom.getTime());
    // dateTo (Jul 31) is also mid-week for the week it falls in, so the
    // end widens past the look-ahead-only +18h rule too.
    expect(expectedFetchEnd.getTime()).toBeGreaterThan(fetchEnd.getTime());
  });

  it('widens the fetch end to the ISO week end when dateTo falls mid-week', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const timePunchesChain: any = {};
    ['select', 'eq', 'order'].forEach((m) => {
      timePunchesChain[m] = vi.fn(() => timePunchesChain);
    });
    timePunchesChain.gte = vi.fn(() => timePunchesChain);
    timePunchesChain.lte = vi.fn(() => timePunchesChain);
    timePunchesChain.range = vi.fn(() => Promise.resolve({ data: [], error: null }));

    const fromMock = vi.fn((table: string) => {
      if (table === 'time_punches') return timePunchesChain;
      return makeChainable([]);
    });
    const rpcMock = vi.fn(() => Promise.resolve({ data: [], error: null }));

    vi.doMock('@/integrations/supabase/client', () => ({
      supabase: {
        from: (...args: [string]) => fromMock(...args),
        rpc: (...args: unknown[]) => rpcMock(...args),
      },
    }));

    const { useMonthlyMetrics } = await import('@/hooks/useMonthlyMetrics');

    // A Monday-start week runs Jul 20 - Jul 26, 2026. dateFrom sits on the
    // week start; dateTo lands mid-week (Wednesday), so the DB fetch end
    // must widen forward to Jul 26 (end of week), not stop at dateTo's
    // look-ahead-only +18h.
    const dateFrom = new Date(2026, 6, 20); // 2026-07-20, a Monday
    const dateTo = new Date(2026, 6, 22, 23, 59, 59, 999); // 2026-07-22, a Wednesday
    const { fetchStart, fetchEnd } = lookaheadPunchFetchRange(dateFrom, dateTo);
    const expectedFetchEnd = weekAlignedFetchEnd(dateTo, fetchEnd);

    const { result } = renderHook(
      () => useMonthlyMetrics(RESTAURANT, dateFrom, dateTo),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(timePunchesChain.gte).toHaveBeenCalledWith('punch_time', fetchStart.toISOString());
    expect(timePunchesChain.lte).toHaveBeenCalledWith('punch_time', expectedFetchEnd.toISOString());
    // dateTo is mid-week, so the widened end is strictly after the
    // look-ahead-only end.
    expect(expectedFetchEnd.getTime()).toBeGreaterThan(fetchEnd.getTime());
  });

  it('leaves the fetch start and end unchanged when [dateFrom, dateTo] already spans a full week', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const timePunchesChain: any = {};
    ['select', 'eq', 'order'].forEach((m) => {
      timePunchesChain[m] = vi.fn(() => timePunchesChain);
    });
    timePunchesChain.gte = vi.fn(() => timePunchesChain);
    timePunchesChain.lte = vi.fn(() => timePunchesChain);
    timePunchesChain.range = vi.fn(() => Promise.resolve({ data: [], error: null }));

    const fromMock = vi.fn((table: string) => {
      if (table === 'time_punches') return timePunchesChain;
      return makeChainable([]);
    });
    const rpcMock = vi.fn(() => Promise.resolve({ data: [], error: null }));

    vi.doMock('@/integrations/supabase/client', () => ({
      supabase: {
        from: (...args: [string]) => fromMock(...args),
        rpc: (...args: unknown[]) => rpcMock(...args),
      },
    }));

    const { useMonthlyMetrics } = await import('@/hooks/useMonthlyMetrics');

    // Derive dateFrom FROM startOfWeek (rather than hardcoding a calendar
    // date and assuming it lands on a Monday) so this holds under every
    // host TZ the suite runs in, not only UTC.
    const dateFrom = startOfWeek(new Date(2026, 6, 22, 12, 0, 0), { weekStartsOn: WEEK_STARTS_ON });
    const dateTo = new Date(dateFrom.getTime() + 6 * 24 * 3600 * 1000 + 23 * 3600 * 1000);
    const { fetchEnd } = lookaheadPunchFetchRange(dateFrom, dateTo);

    const { result } = renderHook(
      () => useMonthlyMetrics(RESTAURANT, dateFrom, dateTo),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(timePunchesChain.gte).toHaveBeenCalledWith('punch_time', dateFrom.toISOString());
    expect(timePunchesChain.lte).toHaveBeenCalledWith('punch_time', fetchEnd.toISOString());
  });
});
