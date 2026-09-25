import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// A custom period whose `dateTo` is the local midnight at the start of its
// last day must count that day's hourly wages. The engine keeps its noon
// rule, so useMonthlyMetrics passes whole-day bounds (startOfDay /
// endOfDay), as the dashboard pill loader does with day strings.
vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { timezone: 'America/Chicago' } },
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- stub for the Supabase query builder; each method returns the same object
function makeChainable(data: unknown = []): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see makeChainable above
  const chain: any = {};
  ['select', 'eq', 'in', 'order', 'gte', 'lte', 'lt', 'is', 'or', 'limit', 'maybeSingle'].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  chain.range = vi.fn(() => Promise.resolve({ data, error: null }));
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data, error: null });
  return chain;
}

const RESTAURANT = 'rest-whole-day-bounds-1';
const EMPLOYEE_ID = 'emp-whole-day-1';

function dbPunch(punch_time: string, punch_type: 'clock_in' | 'clock_out', id: string) {
  return {
    id, employee_id: EMPLOYEE_ID, restaurant_id: RESTAURANT,
    punch_time, punch_type, created_at: punch_time, updated_at: punch_time,
    shift_id: null, notes: null, photo_path: null, device_info: null,
    location: null, created_by: null, modified_by: null,
  };
}

const employee = {
  id: EMPLOYEE_ID, restaurant_id: RESTAURANT, name: 'Hourly',
  status: 'active', compensation_type: 'hourly', hourly_rate: 2000, // $20.00/hr
};

// 5 hours on 2026-07-31, 10:00-15:00 CDT: the last day of the period.
const punches = [
  dbPunch('2026-07-31T15:00:00.000Z', 'clock_in', 'p-in'),
  dbPunch('2026-07-31T20:00:00.000Z', 'clock_out', 'p-out'),
];

// DATE rows: a $30.00 tip split and a $10.00 payout on the last day, and
// per-job payments on the first day of July and of August. The mock returns
// every row for every query, so the month loop alone assigns each row a month.
const tipSplitRows = [
  { amount: 3000, employee_id: EMPLOYEE_ID, tip_splits: { restaurant_id: RESTAURANT, split_date: '2026-07-31' } },
];
const tipPayoutRows = [{ amount: 1000, employee_id: EMPLOYEE_ID, payout_date: '2026-07-31' }];
const perJobRows = [
  { date: '2026-07-01', allocated_cost: 5000 },
  { date: '2026-08-01', allocated_cost: 7000 },
];

function mockSupabaseClient({ withDayRows = false } = {}) {
  const fromMock = vi.fn((table: string) => {
    if (table === 'time_punches') return makeChainable(punches);
    if (table === 'employees_secure') return makeChainable([employee]);
    if (withDayRows && table === 'tip_split_items') return makeChainable(tipSplitRows);
    if (withDayRows && table === 'tip_payouts') return makeChainable(tipPayoutRows);
    if (withDayRows && table === 'daily_labor_allocations') return makeChainable(perJobRows);
    return makeChainable([]);
  });
  vi.doMock('@/integrations/supabase/client', () => ({
    supabase: {
      from: (...args: [string]) => fromMock(...args),
      rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
    },
  }));
}

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

describe('useMonthlyMetrics whole-day engine bounds', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('counts the hourly wages of a last day whose dateTo is local midnight', async () => {
    mockSupabaseClient();
    const { useMonthlyMetrics } = await import('@/hooks/useMonthlyMetrics');

    // Local midnight at the START of July 31: a date-picker "to" day.
    const dateFrom = new Date(2026, 6, 1);
    const dateTo = new Date(2026, 6, 31);

    const { result } = renderHook(
      () => useMonthlyMetrics(RESTAURANT, dateFrom, dateTo),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();

    const july = result.current.data?.find((m) => m.period === '2026-07');
    expect(july).toBeDefined();
    // 5 h x $20.00 = $100.00.
    expect(july!.pending_labor_cost).toBeCloseTo(100, 2);
  });

  it('counts a tip split, a payout and a per-job payment by calendar day in the month', async () => {
    mockSupabaseClient({ withDayRows: true });
    const { useMonthlyMetrics } = await import('@/hooks/useMonthlyMetrics');

    const { result } = renderHook(
      () => useMonthlyMetrics(RESTAURANT, new Date(2026, 6, 1), new Date(2026, 6, 31)),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();

    const july = result.current.data?.find((m) => m.period === '2026-07');
    expect(july).toBeDefined();
    // $100.00 wages + ($30.00 tips - $10.00 payout) + $50.00 per-job on Jul 1.
    expect(july!.pending_labor_cost).toBeCloseTo(170, 2);
  });

  it('keeps a per-job payment on Aug 1 out of July', async () => {
    mockSupabaseClient({ withDayRows: true });
    const { useMonthlyMetrics } = await import('@/hooks/useMonthlyMetrics');

    const { result } = renderHook(
      () => useMonthlyMetrics(RESTAURANT, new Date(2026, 6, 1), new Date(2026, 7, 31)),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();

    const july = result.current.data?.find((m) => m.period === '2026-07');
    const august = result.current.data?.find((m) => m.period === '2026-08');
    expect(july!.pending_labor_cost).toBeCloseTo(170, 2);
    expect(august!.pending_labor_cost).toBeCloseTo(70, 2);
  });
});
