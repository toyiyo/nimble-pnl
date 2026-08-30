/**
 * Regression (Codex P2 follow-up): when a dashboard period starts mid-week,
 * useLaborCostsFromTimeTracking must still band overtime over the FULL ISO
 * week, not just the days inside the requested range.
 *
 * calculateActualLaborCostForRange buckets punches by ISO week and bands
 * overtime over the whole week before splitting the week's wage total back
 * across the days actually worked. If the hook only ever saw punches from
 * dateFrom onward, a mid-week start would understate the week's hours and
 * miss overtime the employee is actually owed.
 *
 * This test supplies the FULL week of punches (as the widened DB fetch now
 * does — see useLaborCostsFromTimeTracking.fetchRange.test.ts for that
 * fetch-window assertion) and checks two things at once:
 *   1. totalCost (the payroll-formula total) reflects the full week's
 *      overtime band, not just the in-range days' straight time.
 *   2. dailyCosts (the straight-time chart series) still only lists days
 *      inside [dateFrom, dateTo] and stays unaffected by the look-back days.
 */
import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const RESTAURANT = 'rest-1';

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({
    employees: [
      {
        id: 'e1',
        restaurant_id: RESTAURANT,
        is_active: true,
        status: 'active',
        compensation_type: 'hourly',
        hourly_rate: 2000, // $20.00/hr in cents
      },
    ],
    loading: false,
  }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { timezone: 'UTC' } },
  }),
}));

function punch(id: string, time: string, type: 'clock_in' | 'clock_out') {
  return {
    id, employee_id: 'e1', restaurant_id: RESTAURANT,
    punch_time: time, punch_type: type,
    created_at: time, updated_at: time,
    shift_id: null, notes: null, photo_path: null, device_info: null,
    location: null, created_by: null, modified_by: null,
  };
}

// A Monday-start ISO week: Mon Apr 27 - Sun May 3, 2026. Five 10-hour
// shifts (Mon-Fri), 08:00-18:00 UTC: 50h total for the week, so the last
// 10h band as overtime (>40h/week).
const weekPunches = ['2026-04-27', '2026-04-28', '2026-04-29', '2026-04-30', '2026-05-01']
  .flatMap((day, i) => [
    punch(`p${i}-in`, `${day}T08:00:00+00:00`, 'clock_in'),
    punch(`p${i}-out`, `${day}T18:00:00+00:00`, 'clock_out'),
  ]);

// Typed shape for the methods the hook calls on the query chain. `then`
// makes the chain awaitable for queries the hook awaits without `.range()`.
interface QueryChainMock {
  select: (columns: string) => QueryChainMock;
  eq: (column: string, value: unknown) => QueryChainMock;
  in: (column: string, values: unknown[]) => QueryChainMock;
  gte: (column: string, value: unknown) => QueryChainMock;
  lte: (column: string, value: unknown) => QueryChainMock;
  order: (column: string, options?: { ascending: boolean }) => QueryChainMock;
  maybeSingle: () => QueryChainMock;
  range: (from: number, to: number) => Promise<{ data: unknown[]; error: null }>;
  then: (resolve: (value: { data: unknown[]; error: null }) => void) => void;
}

function makeRangeChain(rows: unknown[]): QueryChainMock {
  const chain: QueryChainMock = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    lte: vi.fn(() => chain),
    order: vi.fn(() => chain),
    maybeSingle: vi.fn(() => chain),
    range: vi.fn(() => Promise.resolve({ data: rows, error: null })),
    then: (resolve) => resolve({ data: [], error: null }),
  };
  return chain;
}

const fromMock = vi.fn((table: string) => {
  // The mock ignores the query's gte/lte bounds and always returns the full
  // week, standing in for the production fetch (already widened to the ISO
  // week start — see the fetchRange test) returning that same full week.
  if (table === 'time_punches') return makeRangeChain(weekPunches);
  return makeRangeChain([]);
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (...args: [string]) => fromMock(...args) },
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

describe('useLaborCostsFromTimeTracking week-lookback overtime banding', () => {
  it('bands overtime over the full week while keeping dailyCosts straight-time and in-range', async () => {
    const { useLaborCostsFromTimeTracking } = await import('@/hooks/useLaborCostsFromTimeTracking');

    // Mid-week range: Wed Apr 29 - Fri May 1 (3 of the week's 5 worked days).
    // Anchored at 06:00/08:00 UTC (not midnight) so the local calendar date
    // `generateDateRange` reads from these instants stays Apr 29 / May 1
    // under every zone this suite runs in (America/Chicago -5, UTC,
    // Pacific/Auckland +12 — see package.json's test:tz / the CI timezone
    // matrix). A midnight-UTC instant would read back as the PRIOR local
    // day under a negative offset, corrupting both the daily-cost date keys
    // and the OT-banding rangeStart/rangeEnd the hook derives from it.
    const dateFrom = new Date('2026-04-29T06:00:00.000Z');
    const dateTo = new Date('2026-05-01T08:00:00.000Z');

    const { result } = renderHook(
      () => useLaborCostsFromTimeTracking(RESTAURANT, dateFrom, dateTo),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // dailyCosts: straight-time, 10h x $20 = $200/day, for the 3 days
    // inside the requested range.
    ['2026-04-29', '2026-04-30', '2026-05-01'].forEach((date) => {
      const day = result.current.dailyCosts.find((d) => d.date === date);
      expect(day?.total_labor_cost).toBeCloseTo(200, 2);
    });

    // Apr 27/28 (the week look-back days, fetched only for OT context) must
    // not leak any cost into the straight-time daily series.
    ['2026-04-27', '2026-04-28'].forEach((date) => {
      const day = result.current.dailyCosts.find((d) => d.date === date);
      expect(day?.total_labor_cost ?? 0).toBe(0);
    });
    const dailyCostsSum = result.current.dailyCosts.reduce((sum, d) => sum + d.total_labor_cost, 0);
    expect(dailyCostsSum).toBeCloseTo(600, 2);

    // totalCost: the week's 50h bands as 40h regular + 10h overtime.
    // Week wages = 40*$20 + 10*$20*1.5 = $800 + $300 = $1,100, split evenly
    // across the 5 worked days ($220/day), summed over the 3 in-range days.
    expect(result.current.totalCost).toBeCloseTo(660, 2);

    // Sanity check: this is MORE than the 3 in-range days' straight time
    // ($600) would be alone — proving the full week's overtime band is
    // actually being applied, not just the in-range slice.
    expect(result.current.totalCost).toBeGreaterThan(600);
  });
});
