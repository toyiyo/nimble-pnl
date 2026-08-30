import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
        hourly_rate: 1000, // $10.00/hr in cents
      },
    ],
    loading: false,
  }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { timezone: 'America/Chicago' } },
  }),
}));

// One closed 8-hour shift on Jul 6 (15:00-23:00 UTC = 10:00-18:00 Chicago).
const punches = [
  {
    id: 'p1', employee_id: 'e1', restaurant_id: RESTAURANT,
    punch_time: '2026-07-06T15:00:00+00:00', punch_type: 'clock_in',
    created_at: '2026-07-06T15:00:00+00:00', updated_at: '2026-07-06T15:00:00+00:00',
    shift_id: null, notes: null, photo_path: null, device_info: null,
    location: null, created_by: null, modified_by: null,
  },
  {
    id: 'p2', employee_id: 'e1', restaurant_id: RESTAURANT,
    punch_time: '2026-07-06T23:00:00+00:00', punch_type: 'clock_out',
    created_at: '2026-07-06T23:00:00+00:00', updated_at: '2026-07-06T23:00:00+00:00',
    shift_id: null, notes: null, photo_path: null, device_info: null,
    location: null, created_by: null, modified_by: null,
  },
];

// $5.00 of tips owed to e1 on the same day.
const tipRows = [
  { amount: 500, employee_id: 'e1', tip_splits: { restaurant_id: RESTAURANT, split_date: '2026-07-06' } },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeRangeChain(rows: unknown[]): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  ['select', 'eq', 'in', 'gte', 'lte', 'order', 'maybeSingle'].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  // A page smaller than 1000 rows stops the paging after one call.
  chain.range = vi.fn(() => Promise.resolve({ data: rows, error: null }));
  chain.then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
    resolve({ data: [], error: null });
  return chain;
}

// Per-test payout fixture. Payouts reduce tips owed (netting, floored at
// zero per employee) — the default is none so the base case stays $5 owed.
const payoutRows: unknown[] = [];

const fromMock = vi.fn((table: string) => {
  if (table === 'time_punches') return makeRangeChain(punches);
  if (table === 'tip_split_items') return makeRangeChain(tipRows);
  if (table === 'tip_payouts') return makeRangeChain(payoutRows);
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

describe('useLaborCostsFromTimeTracking payroll total with tips', () => {
  beforeEach(() => {
    payoutRows.length = 0;
  });

  it('adds tips owed to the total but keeps dailyCosts straight-time', async () => {
    const { useLaborCostsFromTimeTracking } = await import('@/hooks/useLaborCostsFromTimeTracking');

    const { result } = renderHook(
      () =>
        useLaborCostsFromTimeTracking(
          RESTAURANT,
          new Date('2026-07-06T00:00:00.000Z'),
          new Date('2026-07-06T23:59:59.999Z'),
        ),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Straight-time chart series: 8h x $10.00 = $80.00 on Jul 6.
    const day = result.current.dailyCosts.find((d) => d.date === '2026-07-06');
    expect(day?.total_labor_cost).toBeCloseTo(80, 2);

    // Payroll total: $80.00 wages + $5.00 tips owed = $85.00.
    expect(result.current.totalCost).toBeCloseTo(85, 2);
    // wageCost excludes tips: it is the basis input, so a period with only
    // tips owed must not read as "has accrued labor".
    expect(result.current.wageCost).toBeCloseTo(80, 2);
    expect(result.current.capped).toBe(false);
  });

  it('subtracts tip payouts in the window from tips owed', async () => {
    // $2.00 already paid out to e1 → tips owed nets to $3.00.
    payoutRows.push({ amount: 200, employee_id: 'e1', payout_date: '2026-07-06' });

    const { useLaborCostsFromTimeTracking } = await import('@/hooks/useLaborCostsFromTimeTracking');

    const { result } = renderHook(
      () =>
        useLaborCostsFromTimeTracking(
          RESTAURANT,
          new Date('2026-07-06T00:00:00.000Z'),
          new Date('2026-07-06T23:59:59.999Z'),
        ),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Payroll total: $80.00 wages + ($5.00 - $2.00) tips owed = $83.00.
    expect(result.current.totalCost).toBeCloseTo(83, 2);
  });

  it('floors tips owed at zero when payouts exceed the splits', async () => {
    // $9.00 paid out against $5.00 of splits → tips owed floors at $0.00.
    payoutRows.push({ amount: 900, employee_id: 'e1', payout_date: '2026-07-06' });

    const { useLaborCostsFromTimeTracking } = await import('@/hooks/useLaborCostsFromTimeTracking');

    const { result } = renderHook(
      () =>
        useLaborCostsFromTimeTracking(
          RESTAURANT,
          new Date('2026-07-06T00:00:00.000Z'),
          new Date('2026-07-06T23:59:59.999Z'),
        ),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Wages only: the netting never turns tips owed negative.
    expect(result.current.totalCost).toBeCloseTo(80, 2);
  });
});
