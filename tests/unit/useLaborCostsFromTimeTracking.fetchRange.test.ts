/**
 * Regression: useLaborCostsFromTimeTracking's time_punches fetch must span the
 * BUSINESS days [dateFrom, dateTo] name, widened by the overnight buffer (via
 * businessDayPunchFetchRange), so every shift calculateActualLaborCost can
 * attribute into the displayed range is actually fetched.
 *
 * This used to be a look-AHEAD only, because calculateActualLaborCost then
 * attributed a shift to every calendar day it touched and a look-back would
 * have pulled a prior-period Sunday-night shift into the first in-range day.
 * It now attributes each shift to exactly ONE business day and reads only the
 * day keys inside [dateFrom, dateTo] (`dateMap.get(...)`, no entry -> dropped),
 * so an over-fetch cannot overstate labor -- and a look-back became REQUIRED:
 * a viewer west of the restaurant sees the first business day begin before
 * dateFrom's instant, at every cutoff including 0.
 *
 * The React Query cache key must stay keyed on the *logical* dateFrom/
 * dateTo (not the buffered range) so cache identity is unaffected.
 */
import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { businessDayPunchFetchRange } from '@/utils/punchWindow';
import { toBusinessDayFor } from '@/lib/businessDay';
import { formatLocalDate } from '@/lib/shiftInterval';

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
// to keep this test focused on the time_punches fetch bounds. The hook's
// query is `enabled: !!restaurantId && !!employees.length`, so at least one
// employee is required for the time_punches query to actually run.
vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({ employees: [{ id: 'emp-1', status: 'active' }], loading: false }),
}));

// The hook now sources its business-day framing from RestaurantContext. This
// test is only about the time_punches fetch window, not bucketing, so stub a
// restaurant-less context (the hook falls back to UTC/cutoff-0 via
// businessDay.tz/cutoffHour being undefined).
vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({ selectedRestaurant: null }),
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

  it('fetches the business days [dateFrom, dateTo] name, buffered on both ends', async () => {
    const { useLaborCostsFromTimeTracking } = await import('@/hooks/useLaborCostsFromTimeTracking');

    // Local-midnight calendar-day tokens, the shape usePeriodNavigation and
    // eachDayOfInterval build -- the fetch range reads their local fields.
    const dateFrom = new Date(2026, 2, 2);
    const dateTo = new Date(2026, 2, 8, 23, 59, 59, 999);
    // The context stub above is restaurant-less, so the hook resolves to
    // UTC / cutoff 0 and this must be the frame the assertion uses too.
    const frame = { tz: undefined, cutoffHour: undefined };
    const { fetchStart, fetchEnd } = businessDayPunchFetchRange(dateFrom, dateTo, frame);

    const { result } = renderHook(
      () => useLaborCostsFromTimeTracking('rest-1', dateFrom, dateTo),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fromMock).toHaveBeenCalledWith('time_punches');
    expect(timePunchesChain.gte).toHaveBeenCalledWith('punch_time', fetchStart.toISOString());
    expect(timePunchesChain.lte).toHaveBeenCalledWith('punch_time', fetchEnd.toISOString());

    // Both ends land strictly OUTSIDE the range's business days -- the property
    // that matters, and the one a fixed-hour buffer cannot promise across zones.
    expect(toBusinessDayFor(fetchStart, frame) < formatLocalDate(dateFrom)).toBe(true);
    expect(toBusinessDayFor(fetchEnd, frame) > formatLocalDate(dateTo)).toBe(true);
    // And there is now a look-BACK, which the previous implementation refused.
    // Only its existence is asserted, not its size: the gap to `dateFrom`'s
    // instant includes the host-zone offset, so it is not a fixed number of
    // hours. The buffer itself is measured off the boundary instant, which is
    // what businessDayPunchFetchRange's own matrix test pins.
    expect(fetchStart.getTime()).toBeLessThan(dateFrom.getTime());
  });
});
