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

function mockSupabaseClient() {
  const fromMock = vi.fn((table: string) => {
    if (table === 'time_punches') return makeChainable(punches);
    if (table === 'employees_secure') return makeChainable([employee]);
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
});
