/**
 * Regression: useMonthlyMetrics' time_punches fetch must span the BUSINESS days
 * [dateFrom, dateTo] name, widened by the overnight buffer (via
 * businessDayPunchFetchRange), so every shift calculateActualLaborCostForMonth
 * can attribute into the displayed months is actually fetched.
 *
 * This was a look-AHEAD measured off `dateFrom`'s raw instant, with no
 * look-back at all. Those are different frames: dateFrom is a calendar-day
 * token in the BROWSER's zone, while the business day resolves in the
 * RESTAURANT's zone, and the spread between the two runs to 26 hours. Browser
 * Los_Angeles / restaurant Auckland at cutoff 2: `Mar 1 02:00 Auckland` is
 * `Feb 28 05:00 LA`, 19 hours before the old lower bound -- the first shift of
 * the month was never fetched, and the previous month's window rejects it too
 * (its clip runs on the business day, which says March). Those hours were
 * costed on no month at all.
 *
 * The over-fetch is safe in the other direction: the per-day clip inside
 * calculateActualLaborCostForMonth only adds days inside [monthStart, monthEnd].
 */
import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { businessDayPunchFetchRange } from '@/utils/punchWindow';
import { toBusinessDayFor } from '@/lib/businessDay';
import { formatLocalDate } from '@/lib/shiftInterval';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChainable(data: unknown = []): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  ['select', 'eq', 'in', 'order', 'gte', 'lte', 'lt', 'is', 'or', 'limit', 'range', 'maybeSingle']
    .forEach((m) => { chain[m] = vi.fn(() => chain); });
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) =>
    resolve({ data, error: null });
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

describe('useMonthlyMetrics time_punches fetch range', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  // A restaurant east of every plausible CI/browser zone is the case a
  // look-ahead-only fetch cannot serve, at any cutoff including 0.
  const FRAME = { tz: 'Pacific/Auckland', cutoffHour: 2 } as const;

  it('fetches the business days [dateFrom, dateTo] name, buffered on both ends', async () => {
    const gteCalls: unknown[][] = [];
    const lteCalls: unknown[][] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const timePunchesChain: any = {};
    ['select', 'eq', 'order'].forEach((m) => {
      timePunchesChain[m] = vi.fn(() => timePunchesChain);
    });
    timePunchesChain.gte = vi.fn((...args: unknown[]) => { gteCalls.push(args); return timePunchesChain; });
    timePunchesChain.lte = vi.fn((...args: unknown[]) => { lteCalls.push(args); return timePunchesChain; });
    timePunchesChain.range = vi.fn(() => Promise.resolve({ data: [], error: null }));

    const fromMock = vi.fn((table: string) => {
      if (table === 'time_punches') return timePunchesChain;
      return makeChainable([]);
    });

    vi.doMock('@/integrations/supabase/client', () => ({
      supabase: {
        from: (...args: [string]) => fromMock(...args),
        rpc: () => Promise.resolve({ data: [], error: null }),
      },
    }));

    const { useMonthlyMetrics } = await import('@/hooks/useMonthlyMetrics');

    // Local-midnight calendar-day tokens, the shape the dashboard's month
    // navigation builds -- the fetch range reads their local fields.
    const dateFrom = new Date(2026, 2, 1);
    const dateTo = new Date(2026, 2, 31, 23, 59, 59, 999);
    const { fetchStart, fetchEnd } = businessDayPunchFetchRange(dateFrom, dateTo, FRAME);

    const { result } = renderHook(
      () => useMonthlyMetrics('rest-1', dateFrom, dateTo, FRAME),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fromMock).toHaveBeenCalledWith('time_punches');
    expect(gteCalls).toContainEqual(['punch_time', fetchStart.toISOString()]);
    expect(lteCalls).toContainEqual(['punch_time', fetchEnd.toISOString()]);

    // Both ends land strictly OUTSIDE the range's business days -- the property
    // that matters, and the one a look-ahead off the raw instant cannot promise.
    expect(toBusinessDayFor(fetchStart, FRAME) < formatLocalDate(dateFrom)).toBe(true);
    expect(toBusinessDayFor(fetchEnd, FRAME) > formatLocalDate(dateTo)).toBe(true);
    // And there is a look-BACK, which the previous implementation had none of.
    // Only its existence is asserted, not its size: the gap to `dateFrom`'s
    // instant carries the host-zone offset and is not a fixed number of hours.
    expect(fetchStart.getTime()).toBeLessThan(dateFrom.getTime());
  });
});
