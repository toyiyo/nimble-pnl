/**
 * Regression: useLaborCostsFromTimeTracking's time_punches fetch must be
 * widened by the overnight buffer (±18h, via bufferPunchFetchRange) so a
 * shift whose clock-in and clock-out straddle the period boundary is
 * fetched whole. calculateActualLaborCost then attributes each shift back
 * to its clock-in day within [dateFrom, dateTo] and drops out-of-window
 * periods.
 *
 * The React Query cache key must stay keyed on the *logical* dateFrom/
 * dateTo (not the buffered range) so cache identity is unaffected by the
 * buffer.
 */
import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { bufferPunchFetchRange } from '@/utils/punchWindow';

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

  it('fetches time_punches widened by the overnight buffer, not the raw logical bounds', async () => {
    const { useLaborCostsFromTimeTracking } = await import('@/hooks/useLaborCostsFromTimeTracking');

    const dateFrom = new Date('2026-03-02T00:00:00.000Z');
    const dateTo = new Date('2026-03-08T23:59:59.999Z');
    const { fetchStart, fetchEnd } = bufferPunchFetchRange(dateFrom, dateTo);

    const { result } = renderHook(
      () => useLaborCostsFromTimeTracking('rest-1', dateFrom, dateTo),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fromMock).toHaveBeenCalledWith('time_punches');
    // The fetch bounds must be the BUFFERED range, not the raw logical dates.
    expect(timePunchesChain.gte).toHaveBeenCalledWith('punch_time', fetchStart.toISOString());
    expect(timePunchesChain.lte).toHaveBeenCalledWith('punch_time', fetchEnd.toISOString());
    // Sanity: the buffered bounds actually differ from the logical bounds.
    expect(fetchStart.toISOString()).not.toBe(dateFrom.toISOString());
    expect(fetchEnd.toISOString()).not.toBe(dateTo.toISOString());
  });
});
