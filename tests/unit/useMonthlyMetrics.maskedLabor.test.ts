import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// A masked employee row (no view:pay_rates) arrives from employees_secure
// with hourly_rate === null. useMonthlyMetrics must mark labor_cost_hidden
// true for every month in the result, so the Dashboard shows "Unavailable"
// instead of a $0 labor cost that reads as real. See
// docs/superpowers/specs/2026-08-06-sensitive-data-flags-design.md.
vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { timezone: 'America/Chicago' } },
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- stub for the Supabase query builder; each method returns the same object, a shape the SDK's generic builder type does not describe
function makeChainable(data: unknown = []): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see makeChainable above; the object gains its methods below, one property at a time
  const chain: any = {};
  ['select', 'eq', 'in', 'order', 'gte', 'lte', 'lt', 'is', 'or', 'limit', 'maybeSingle'].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  chain.range = vi.fn(() => Promise.resolve({ data, error: null }));
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data, error: null });
  return chain;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- stub for the Supabase query builder; see makeChainable above
function makeTimePunchesChain(data: unknown[]): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see makeChainable above; the object gains its methods below, one property at a time
  const chain: any = {};
  ['select', 'eq', 'gte', 'lte', 'order'].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  chain.range = vi.fn(() => Promise.resolve({ data, error: null }));
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- builds a raw DB punch row; the return type would just repeat the object literal below
function toDbPunch(employee_id: string, punch_time: string, punch_type: 'clock_in' | 'clock_out', id: string): any {
  return {
    id, employee_id, restaurant_id: RESTAURANT,
    punch_time, punch_type, created_at: punch_time, updated_at: punch_time,
    shift_id: null, notes: null, photo_path: null, device_info: null,
    location: null, created_by: null, modified_by: null,
  };
}

const RESTAURANT = 'rest-masked-labor-1';
const EMPLOYEE_ID = 'emp-masked-1';

// hourly_rate is null: the caller (e.g. Chef) has no view:pay_rates, so
// employees_secure masked this column instead of returning a real amount.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a partial employees_secure row; only the fields this test reads are set
const maskedEmployee: any = {
  id: EMPLOYEE_ID, restaurant_id: RESTAURANT,
  status: 'active', compensation_type: 'hourly', hourly_rate: null,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see maskedEmployee above
const unmaskedEmployee: any = {
  id: 'emp-visible-1', restaurant_id: RESTAURANT,
  status: 'active', compensation_type: 'hourly', hourly_rate: 2000, // $20.00/hr
};

const shiftPunches = [
  toDbPunch(EMPLOYEE_ID, '2026-07-15T09:00:00.000Z', 'clock_in', 'punch-in-1'),
  toDbPunch(EMPLOYEE_ID, '2026-07-15T14:00:00.000Z', 'clock_out', 'punch-out-1'),
];

function mockSupabaseClient(employees: unknown[]) {
  const fromMock = vi.fn((table: string) => {
    if (table === 'time_punches') return makeTimePunchesChain(shiftPunches);
    if (table === 'employees_secure') return makeChainable(employees);
    return makeChainable([]);
  });
  const rpcMock = vi.fn(() => Promise.resolve({ data: [], error: null }));

  vi.doMock('@/integrations/supabase/client', () => ({
    supabase: {
      from: (...args: [string]) => fromMock(...args),
      rpc: (...args: unknown[]) => rpcMock(...args),
    },
  }));
}

const dateFrom = new Date(2026, 6, 1);
const dateTo = new Date(2026, 6, 31, 23, 59, 59, 999);

describe('useMonthlyMetrics labor_cost_hidden (masked employees_secure rows)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('should mark labor_cost_hidden true and never report a bare $0 when an employee row is masked', async () => {
    mockSupabaseClient([maskedEmployee]);

    const { useMonthlyMetrics } = await import('@/hooks/useMonthlyMetrics');

    const { result } = renderHook(
      () => useMonthlyMetrics(RESTAURANT, dateFrom, dateTo),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();

    const july = result.current.data?.find((m) => m.period === '2026-07');
    expect(july).toBeDefined();
    expect(july!.labor_cost_hidden).toBe(true);
  });

  it('should leave labor_cost_hidden false when every employee row carries a real rate', async () => {
    mockSupabaseClient([unmaskedEmployee]);

    const { useMonthlyMetrics } = await import('@/hooks/useMonthlyMetrics');

    const { result } = renderHook(
      () => useMonthlyMetrics(RESTAURANT, dateFrom, dateTo),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();

    const july = result.current.data?.find((m) => m.period === '2026-07');
    expect(july).toBeDefined();
    expect(july!.labor_cost_hidden).toBe(false);
  });

  it('should mark labor_cost_hidden true when even one employee among several is masked', async () => {
    mockSupabaseClient([unmaskedEmployee, maskedEmployee]);

    const { useMonthlyMetrics } = await import('@/hooks/useMonthlyMetrics');

    const { result } = renderHook(
      () => useMonthlyMetrics(RESTAURANT, dateFrom, dateTo),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();

    const july = result.current.data?.find((m) => m.period === '2026-07');
    expect(july).toBeDefined();
    expect(july!.labor_cost_hidden).toBe(true);
  });

  it('should mark labor_cost_hidden only for months the masked employee was employed', async () => {
    // Hired mid-July: June is before the hire date, so it must stay
    // "not hidden" even though the same employee row masks July and August.
    const maskedEmployeeHiredMidJuly = {
      ...maskedEmployee,
      hire_date: '2026-07-10',
      termination_date: null,
    };
    mockSupabaseClient([maskedEmployeeHiredMidJuly]);

    const { useMonthlyMetrics } = await import('@/hooks/useMonthlyMetrics');

    const multiMonthFrom = new Date(2026, 5, 1); // June 1
    const multiMonthTo = new Date(2026, 7, 31, 23, 59, 59, 999); // Aug 31

    const { result } = renderHook(
      () => useMonthlyMetrics(RESTAURANT, multiMonthFrom, multiMonthTo),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();

    const june = result.current.data?.find((m) => m.period === '2026-06');
    const july = result.current.data?.find((m) => m.period === '2026-07');
    const august = result.current.data?.find((m) => m.period === '2026-08');
    expect(june).toBeDefined();
    expect(july).toBeDefined();
    expect(august).toBeDefined();
    expect(june!.labor_cost_hidden).toBe(false);
    expect(july!.labor_cost_hidden).toBe(true);
    expect(august!.labor_cost_hidden).toBe(true);
  });
});
