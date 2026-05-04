/**
 * Regression: useRevenueBreakdown must format the RPC date bounds in the
 * host (local) timezone — not UTC. Previously the hook used
 * `dateFrom.toISOString().split('T')[0]`, which returns the UTC date. In any
 * UTC- offset (Americas), the local end-of-month timestamp shifts forward
 * one day in UTC, so the panel queried the next month's day 1 and inflated
 * gross / pass-through totals (Russo's April 2026 dashboard showed +$3,889
 * gross because May 1 sales were pulled in).
 *
 * This test pins TZ=America/Chicago and verifies the RPC receives the
 * calendar bounds the user picked.
 */

// Pin TZ before any imports that touch Date / date-fns.
process.env.TZ = 'America/Chicago';

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';
import { startOfMonth, endOfMonth } from 'date-fns';

const mockRpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: vi.fn(),
  },
}));

const createWrapper = () => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
};

describe('useRevenueBreakdown date bounds (host TZ formatting)', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    // Both RPCs return non-null arrays so the fast path is taken.
    mockRpc.mockResolvedValue({ data: [], error: null });
  });

  it('passes local-TZ calendar bounds (NOT UTC) to get_pass_through_totals', async () => {
    const { useRevenueBreakdown } = await import('@/hooks/useRevenueBreakdown');

    const dateFrom = startOfMonth(new Date(2026, 3, 1));   // 2026-04-01 00:00 CDT
    const dateTo = endOfMonth(new Date(2026, 3, 1));        // 2026-04-30 23:59 CDT

    // Sanity: under TZ=America/Chicago, .toISOString() of the end bound
    // shifts to 2026-05-01 — the bug we're guarding against.
    expect(dateTo.toISOString().split('T')[0]).toBe('2026-05-01');

    const { result } = renderHook(
      () => useRevenueBreakdown('restaurant-uuid', dateFrom, dateTo),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const passThroughCall = mockRpc.mock.calls.find(
      (c) => c[0] === 'get_pass_through_totals'
    );
    expect(passThroughCall).toBeDefined();
    expect(passThroughCall![1]).toEqual({
      p_restaurant_id: 'restaurant-uuid',
      p_date_from: '2026-04-01',
      p_date_to: '2026-04-30',
    });

    const revenueCall = mockRpc.mock.calls.find(
      (c) => c[0] === 'get_revenue_by_account'
    );
    expect(revenueCall).toBeDefined();
    expect(revenueCall![1]).toEqual({
      p_restaurant_id: 'restaurant-uuid',
      p_date_from: '2026-04-01',
      p_date_to: '2026-04-30',
    });
  });
});
