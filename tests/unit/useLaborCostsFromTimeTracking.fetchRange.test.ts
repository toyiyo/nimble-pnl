/**
 * Regression: useLaborCostsFromTimeTracking's time_punches DB fetch has two
 * jobs with different rules:
 *
 * 1. The END is a LOOK-AHEAD ONLY (via lookaheadPunchFetchRange) so a shift
 *    whose clock_out lands just after dateTo is fetched whole.
 * 2. The START widens back to the Monday (WEEK_STARTS_ON) that contains
 *    dateFrom, so calculateActualLaborCostForRange sees the FULL ISO week
 *    and bands overtime correctly, even when dateFrom falls mid-week
 *    (Codex P2, follow-up finding).
 *
 * calculateActualLaborCost (the straight-time daily series) must NOT see
 * those extra look-back days — it attributes hours/active-days to every day
 * a shift touches and does not drop shifts whose clock-in precedes the
 * window, so it would pull a prior-period shift into the first in-range day
 * and overstate labor. The hook filters them back out in memory before
 * calling it (see useLaborCostsFromTimeTracking.weekLookback.test.ts).
 *
 * The React Query cache key must stay keyed on the *logical* dateFrom/
 * dateTo (not the buffered range) so cache identity is unaffected.
 */
import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { startOfWeek } from 'date-fns';
import { lookaheadPunchFetchRange } from '@/utils/punchWindow';
import { WEEK_STARTS_ON } from '@/lib/dateConfig';

// Generic chainable Supabase query-builder mock: every method returns
// `this` so any chain shape resolves, and the builder is thenable so
// `await supabase.from(...).select()...` resolves to { data: [], error: null }.
type SupabaseChain = Record<string, unknown> & {
  then: (resolve: (v: { data: unknown[]; error: null }) => void) => void;
};

function makeChainable(): SupabaseChain {
  const chain = {} as SupabaseChain;
  const methods = [
    'select', 'eq', 'in', 'order', 'maybeSingle',
  ];
  methods.forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  // gte/lte are spied separately per-table so tests can assert on them.
  chain.gte = vi.fn(() => chain);
  chain.lte = vi.fn(() => chain);
  chain.range = vi.fn(() => Promise.resolve({ data: [], error: null }));
  chain.then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
    resolve({ data: [], error: null });
  return chain;
}

const timePunchesChain = makeChainable();
const fromMock = vi.fn((table: string) => {
  if (table === 'time_punches') return timePunchesChain;
  return makeChainable();
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (...args: [string]) => fromMock(...args),
  },
}));

// useEmployees pulls from the same mocked supabase client; stub it directly
// to keep this test focused on the time_punches fetch bounds. The hook's
// query is `enabled: !!restaurantId && !!employees.length`, so at least one
// employee is required for the time_punches query to actually run.
vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({ employees: [{ id: 'emp-1', status: 'active' }], loading: false }),
}));

// useLaborCostsFromTimeTracking now sources the restaurant timezone from
// useRestaurantClock (via useRestaurantContext) to bucket punches by the
// restaurant's calendar day. This test only asserts the time_punches fetch
// *range* bounds, so the specific timezone value is not load-bearing — just
// needs to be present.
vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { timezone: 'America/Chicago' } },
  }),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

describe('useLaborCostsFromTimeTracking time_punches fetch range', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches time_punches widened to the ISO week start, with a look-ahead end (+18h)', async () => {
    const { useLaborCostsFromTimeTracking } = await import('@/hooks/useLaborCostsFromTimeTracking');

    // dateFrom lands mid-week (a Monday-start week runs Mar 2 - Mar 8), so
    // the DB fetch start must widen back to Mar 2, NOT stay at dateFrom.
    const dateFrom = new Date('2026-03-04T00:00:00.000Z');
    const dateTo = new Date('2026-03-08T23:59:59.999Z');
    const { fetchStart, fetchEnd } = lookaheadPunchFetchRange(dateFrom, dateTo);
    const weekAlignedStart = startOfWeek(dateFrom, { weekStartsOn: WEEK_STARTS_ON });
    const expectedFetchStart = weekAlignedStart < fetchStart ? weekAlignedStart : fetchStart;

    const { result } = renderHook(
      () => useLaborCostsFromTimeTracking('rest-1', dateFrom, dateTo),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fromMock).toHaveBeenCalledWith('time_punches');
    expect(timePunchesChain.gte).toHaveBeenCalledWith('punch_time', expectedFetchStart.toISOString());
    expect(timePunchesChain.lte).toHaveBeenCalledWith('punch_time', fetchEnd.toISOString());
    // dateFrom is mid-week, so the widened start is strictly before it.
    expect(expectedFetchStart.getTime()).toBeLessThan(dateFrom.getTime());
    // End keeps the look-ahead-only rule: +18h past dateTo.
    expect(fetchEnd.getTime() - dateTo.getTime()).toBe(18 * 3600 * 1000);
  });

  it('leaves the fetch start unchanged when dateFrom already falls on the week start', async () => {
    const { useLaborCostsFromTimeTracking } = await import('@/hooks/useLaborCostsFromTimeTracking');

    // Derive dateFrom FROM startOfWeek (rather than hardcoding a calendar
    // date and assuming it lands on a Monday) so this holds under every
    // host TZ the suite runs in, not only UTC.
    const dateFrom = startOfWeek(new Date('2026-03-04T12:00:00.000Z'), { weekStartsOn: WEEK_STARTS_ON });
    const dateTo = new Date(dateFrom.getTime() + 6 * 24 * 3600 * 1000 + 23 * 3600 * 1000);
    const { fetchStart, fetchEnd } = lookaheadPunchFetchRange(dateFrom, dateTo);

    const { result } = renderHook(
      () => useLaborCostsFromTimeTracking('rest-1', dateFrom, dateTo),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(timePunchesChain.gte).toHaveBeenCalledWith('punch_time', fetchStart.toISOString());
    expect(timePunchesChain.lte).toHaveBeenCalledWith('punch_time', fetchEnd.toISOString());
    expect(fetchStart.toISOString()).toBe(dateFrom.toISOString());
  });
});
