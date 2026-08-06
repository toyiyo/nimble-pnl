/**
 * Unit Tests: `useMyPayroll` (self-scoped) and `usePayroll` (admin) regression guard
 *
 * Per docs/superpowers/specs/2026-08-05-employee-self-scoped-data-design.md §3.2, both
 * hooks share one internal implementation with two public entry points. The internal
 * implementation threads `.eq('employee_id', employeeId)` into the seven per-employee
 * queries — `time_punches`, `tip_split_items`, `daily_labor_allocations`, `employee_tips`,
 * `tip_payouts`, `overtime_adjustments`, and `employees` (via `useEmployees({ status: 'all',
 * employeeId })`, which applies `.eq('id', employeeId)`) — while `tip_splits` and
 * `overtime_rules` stay restaurant-scoped.
 *
 * These assertions inspect the recorded query-builder calls, not the returned rows — a
 * row-based assertion would pass vacuously if the filter were applied client-side instead
 * of pushed into the query.
 */
import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type RecordedCall = { method: string; args: unknown[] };

// Generic chainable Supabase query-builder mock: every method returns `this`
// so any chain shape resolves, and the builder is thenable so
// `await supabase.from(...).select()...` resolves to { data: [], error: null }.
// One instance is created per table so calls can be inspected per table.
function makeChainable(): Record<string, unknown> & {
  calls: RecordedCall[];
  then: (resolve: (v: { data: unknown[]; error: null }) => void) => void;
} {
  const calls: RecordedCall[] = [];
  const chain = { calls } as Record<string, unknown> & {
    calls: RecordedCall[];
    then: (resolve: (v: { data: unknown[]; error: null }) => void) => void;
  };
  (['select', 'eq', 'in', 'gte', 'lte', 'order', 'maybeSingle', 'range'] as const).forEach(
    (method) => {
      chain[method] = vi.fn((...args: unknown[]) => {
        calls.push({ method, args });
        return chain;
      });
    },
  );
  chain.then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
    resolve({ data: [], error: null });
  return chain;
}

const employeesChain = makeChainable();
// Return at least one employee so the outer payroll query's
// `enabled: !!restaurantId && !!employees.length` gate actually opens.
employeesChain.then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
  resolve({ data: [{ id: 'emp-1', name: 'Emp One', status: 'active' }], error: null });

const perEmployeeTableChains: Record<string, ReturnType<typeof makeChainable>> = {
  time_punches: makeChainable(),
  tip_split_items: makeChainable(),
  daily_labor_allocations: makeChainable(),
  employee_tips: makeChainable(),
  tip_payouts: makeChainable(),
  overtime_adjustments: makeChainable(),
};
const restaurantScopedChains: Record<string, ReturnType<typeof makeChainable>> = {
  tip_splits: makeChainable(),
  overtime_rules: makeChainable(),
};

const allChains: Record<string, ReturnType<typeof makeChainable>> = {
  employees: employeesChain,
  ...perEmployeeTableChains,
  ...restaurantScopedChains,
};

const fromMock = vi.fn((table: string) => {
  if (allChains[table]) return allChains[table];
  return makeChainable();
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (...args: [string]) => fromMock(...args),
  },
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { timezone: 'America/Chicago' } },
  }),
}));

const createWrapper = (queryClient: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return Wrapper;
};

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
}

const restaurantId = 'rest-123';
const startDate = new Date(2026, 2, 2); // Mon 2026-03-02
const endDate = new Date(2026, 2, 8); // Sun 2026-03-08

describe('useMyPayroll (self-scoped)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.values(allChains).forEach((chain) => {
      chain.calls.length = 0;
    });
  });

  it("applies .eq('employee_id', <id>) on all seven per-employee tables and .eq('id', <id>) on employees", async () => {
    const { useMyPayroll } = await import('@/hooks/usePayroll');

    const { result } = renderHook(
      () => useMyPayroll(restaurantId, 'emp-1', startDate, endDate),
      { wrapper: createWrapper(createQueryClient()) },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    Object.entries(perEmployeeTableChains).forEach(([table, chain]) => {
      expect(fromMock).toHaveBeenCalledWith(table);
      expect(chain.calls).toContainEqual({ method: 'eq', args: ['employee_id', 'emp-1'] });
    });
    expect(fromMock).toHaveBeenCalledWith('employees');
    expect(employeesChain.calls).toContainEqual({ method: 'eq', args: ['id', 'emp-1'] });
  });

  it('leaves tip_splits and overtime_rules restaurant-scoped, with no employee_id predicate', async () => {
    const { useMyPayroll } = await import('@/hooks/usePayroll');

    const { result } = renderHook(
      () => useMyPayroll(restaurantId, 'emp-1', startDate, endDate),
      { wrapper: createWrapper(createQueryClient()) },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    Object.entries(restaurantScopedChains).forEach(([table, chain]) => {
      expect(fromMock).toHaveBeenCalledWith(table);
      expect(chain.calls).toContainEqual({
        method: 'eq',
        args: ['restaurant_id', restaurantId],
      });
      const employeeIdCalls = chain.calls.filter(
        (call) => call.method === 'eq' && call.args[0] === 'employee_id',
      );
      expect(employeeIdCalls).toHaveLength(0);
    });
  });

  it('issues no queries at all when employeeId is null', async () => {
    const { useMyPayroll } = await import('@/hooks/usePayroll');

    const { result } = renderHook(() => useMyPayroll(restaurantId, null, startDate, endDate), {
      wrapper: createWrapper(createQueryClient()),
    });

    // Disabled query: React Query never runs the queryFn, so loading never
    // transitions to true and settles immediately as not-loading.
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fromMock).not.toHaveBeenCalled();
  });

  it('reports loading: true while the inner useEmployees query is in flight (the disabled-query window)', async () => {
    // A never-resolving employees fetch keeps `useEmployees`'s inner query
    // "in flight" for the lifetime of the test, so `employees.length` never
    // reaches nonzero and the outer payroll query stays disabled. Per design
    // §3.2, `loading` must still report `true` during this window — a
    // disabled query alone reports `isLoading: false`, which would make
    // `EmployeePay` render its "No Pay Data" empty state instead of a
    // skeleton while the employee's own record is still resolving.
    employeesChain.then = () => new Promise<never>(() => {});

    const { useMyPayroll } = await import('@/hooks/usePayroll');

    const { result } = renderHook(
      () => useMyPayroll(restaurantId, 'emp-1', startDate, endDate),
      { wrapper: createWrapper(createQueryClient()) },
    );

    expect(result.current.loading).toBe(true);
  });
});

describe('usePayroll (admin) — regression guard for the shared implementation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.values(allChains).forEach((chain) => {
      chain.calls.length = 0;
    });
    employeesChain.then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
      resolve({ data: [{ id: 'emp-1', name: 'Emp One', status: 'active' }], error: null });
  });

  it('issues exactly the queries it issues today, with no employee_id predicate anywhere', async () => {
    const { usePayroll } = await import('@/hooks/usePayroll');

    const { result } = renderHook(() => usePayroll(restaurantId, startDate, endDate), {
      wrapper: createWrapper(createQueryClient()),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    Object.entries(allChains).forEach(([, chain]) => {
      const employeeIdCalls = chain.calls.filter(
        (call) => call.method === 'eq' && call.args[0] === 'employee_id',
      );
      expect(employeeIdCalls).toHaveLength(0);
    });
    const employeesIdCalls = employeesChain.calls.filter(
      (call) => call.method === 'eq' && call.args[0] === 'id',
    );
    expect(employeesIdCalls).toHaveLength(0);
  });
});
