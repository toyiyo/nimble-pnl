/**
 * Regression: usePayroll's time_punches fetch must be widened by the
 * overnight buffer (±18h, via bufferPunchFetchRange) so a shift whose
 * clock-in and clock-out straddle the period boundary is fetched whole.
 * calculateEmployeePay then attributes each shift back to its clock-in day
 * within [startDate, endDate].
 *
 * The buffer must be applied to the RESTAURANT-zone day bounds, not to
 * startDate/endDate directly (Codex P1). startDate/endDate are calendar-day
 * tokens (host-local Date objects, e.g. from `startOfWeek(new Date())`);
 * buffering those raw instants buffers the VIEWER's/host's day boundary. For
 * a viewer far from the restaurant's zone, that ±18h buffer is partly (or,
 * at the extremes, entirely) eaten by the offset difference, so a
 * boundary-crossing shift is never fetched and the pairing engine can't
 * pair it.
 *
 * The React Query cache key must stay keyed on the *logical* startDate/
 * endDate (not the buffered range) so cache identity is unaffected by the
 * buffer.
 */
import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { bufferPunchFetchRange } from '@/utils/punchWindow';
import { businessDayRangeToInstants } from '@/lib/restaurantClock';
import { toDateOnlyString } from '@/lib/dateOnly';

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
// to keep this test focused on the time_punches fetch bounds. usePayroll's
// query is `enabled: !!restaurantId && !!employees.length`, so at least one
// employee is required for the time_punches query to actually run.
vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({ employees: [{ id: 'emp-1', status: 'active' }], loading: false }),
}));

// usePayroll now sources the restaurant timezone from useRestaurantClock
// (via useRestaurantContext) to bucket punches by the restaurant's calendar
// day. This test only asserts the time_punches fetch *range* bounds, so the
// specific timezone value is not load-bearing — just needs to be present.
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

describe('usePayroll time_punches fetch range', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches time_punches widened by the overnight buffer, not the raw logical bounds', async () => {
    const { usePayroll } = await import('@/hooks/usePayroll');

    // Calendar-day tokens, local-field construction (matching real callers,
    // e.g. `startOfWeek(new Date())` in Payroll.tsx) -- NOT a UTC ISO
    // literal. Only the Y/M/D fields are read (via toDateOnlyString), so
    // this is deterministic under every TZ the suite runs in.
    const startDate = new Date(2026, 2, 2); // Mon 2026-03-02
    const endDate = new Date(2026, 2, 8); // Sun 2026-03-08
    // The restaurant is mocked to 'America/Chicago' above. The fetch must be
    // buffered around the RESTAURANT's day bounds, not startDate/endDate's
    // own (host-local) instant values.
    const { start: dayStart, end: dayEnd } = businessDayRangeToInstants(
      toDateOnlyString(startDate),
      toDateOnlyString(endDate),
      'America/Chicago',
    );
    const { fetchStart, fetchEnd } = bufferPunchFetchRange(dayStart, dayEnd);

    const { result } = renderHook(
      () => usePayroll('rest-1', startDate, endDate),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fromMock).toHaveBeenCalledWith('time_punches');
    // The fetch bounds must be the BUFFERED, restaurant-zone range, not the
    // raw logical dates and not a buffer computed from the host's/viewer's
    // own instant reading of those dates.
    expect(timePunchesChain.gte).toHaveBeenCalledWith('punch_time', fetchStart.toISOString());
    expect(timePunchesChain.lte).toHaveBeenCalledWith('punch_time', fetchEnd.toISOString());
    // Sanity: the buffered bounds actually differ from the logical bounds.
    expect(fetchStart.toISOString()).not.toBe(startDate.toISOString());
    expect(fetchEnd.toISOString()).not.toBe(endDate.toISOString());
  });

  it('buffers the RESTAURANT-zone day bounds, not the host/viewer instant reading of startDate/endDate', async () => {
    // Regression for the Codex P1 fix: this pins the exact fetch bounds to
    // literal America/Chicago (CDT, UTC-5) values, independent of host TZ,
    // so it fails if the fetch window ever reverts to buffering
    // startDate/endDate directly (which is host-TZ-dependent and would only
    // coincidentally match when the suite happens to run under TZ=UTC).
    const { usePayroll } = await import('@/hooks/usePayroll');

    const startDate = new Date(2026, 2, 2); // Mon 2026-03-02
    const endDate = new Date(2026, 2, 8); // Sun 2026-03-08

    const { result } = renderHook(
      () => usePayroll('rest-1', startDate, endDate),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Restaurant day bounds: 2026-03-02T00:00 CST .. 2026-03-08T23:59:59.999
    // CST (both before the Mar 8 02:00 spring-forward), buffered by ±18h.
    expect(timePunchesChain.gte).toHaveBeenCalledWith('punch_time', '2026-03-01T12:00:00.000Z');
    expect(timePunchesChain.lte).toHaveBeenCalledWith('punch_time', '2026-03-09T22:59:59.999Z');
  });
});
