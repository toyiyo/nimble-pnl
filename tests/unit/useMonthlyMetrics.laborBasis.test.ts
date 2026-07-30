import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { resolveLaborBasis } from '@/lib/combineCosts';
import { LEGACY_UTC_FRAME } from './fixtures/businessDayFixtures';

// Contract mirrored by useMonthlyMetrics' final labor_cost emission. Kept as
// documentation of the intended contract, but note this does NOT exercise the
// hook itself — it would stay green even if the hook's emission were reverted
// to the old summed accumulator (`month.labor_cost`). The real guard is the
// `renderHook`-based describe block below.
function emittedLaborDollars(pendingDollars: number, actualDollars: number): number {
  return resolveLaborBasis(pendingDollars) === 'accrued' ? pendingDollars : actualDollars;
}

describe('useMonthlyMetrics labor_cost emission contract (documentation only)', () => {
  it('uses accrued (pending) when a month has punch labor — never the sum', () => {
    expect(emittedLaborDollars(200, 180)).toBe(200); // not 380
  });
  it('falls back to paid when no punch labor', () => {
    expect(emittedLaborDollars(0, 180)).toBe(180);
  });
  it('is zero only when both sources are zero (=== 0 guard unchanged)', () => {
    expect(emittedLaborDollars(0, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Real renderHook coverage: exercises useMonthlyMetrics end-to-end against a
// mocked Supabase client (same scaffolding pattern as
// useMonthlyMetrics.pagination.test.ts) so the emission logic in the hook's
// final `result.map` is actually run. This is the test that FAILS if the
// hook's emitted `labor_cost` is reverted to the old `month.labor_cost`
// running total (accrued + paid double-counted).
// ---------------------------------------------------------------------------

const RESTAURANT = 'rest-labor-basis-1';

// Generic chainable Supabase query-builder mock for tables/RPCs we don't
// assert on — resolves to a fixed payload regardless of which chain methods
// were called (same pattern as useMonthlyMetrics.pagination.test.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChainable(data: unknown = []): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  ['select', 'eq', 'in', 'order', 'gte', 'lte', 'lt', 'is', 'or', 'limit', 'maybeSingle'].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data, error: null });
  return chain;
}

// `time_punches` is fetched via `fetchAllRows`, which always calls `.range()`
// even for a single small page — `makeChainable` doesn't expose `.range()`,
// so this table needs its own chain.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeTimePunchesChain(data: unknown[]): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toDbPunch(employee_id: string, punch_time: string, punch_type: 'clock_in' | 'clock_out', id: string): any {
  return {
    id, employee_id, restaurant_id: RESTAURANT,
    punch_time, punch_type, created_at: punch_time, updated_at: punch_time,
    shift_id: null, notes: null, photo_path: null, device_info: null,
    location: null, created_by: null, modified_by: null,
  };
}

const EMPLOYEE_ID = 'emp-basis-1';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const employee: any = {
  id: EMPLOYEE_ID, restaurant_id: RESTAURANT,
  status: 'active', compensation_type: 'hourly', hourly_rate: 2000, // $20.00/hr, in cents
};

// A single 5-hour shift mid-month, mid-day UTC (avoids DST/day-boundary
// ambiguity), well under the 40h/week OT threshold — so accrued pay is
// exactly hours * hourlyRateCents with no OT banding: 5 * 2000 = 10000 cents
// = $100.00.
const accruedShiftPunches = [
  toDbPunch(EMPLOYEE_ID, '2026-07-15T09:00:00.000Z', 'clock_in', 'punch-in-1'),
  toDbPunch(EMPLOYEE_ID, '2026-07-15T14:00:00.000Z', 'clock_out', 'punch-out-1'),
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bankLaborRow(transaction_date: string, amountDollars: number): any {
  return {
    transaction_date,
    amount: -Math.abs(amountDollars), // outflow: negative dollars
    status: 'posted',
    chart_of_accounts: { account_subtype: 'labor' },
  };
}

function mockSupabaseClient(opts: { timePunches: unknown[]; employees: unknown[]; bankLabor: unknown[] }) {
  const fromMock = vi.fn((table: string) => {
    if (table === 'time_punches') return makeTimePunchesChain(opts.timePunches);
    if (table === 'employees') return makeChainable(opts.employees);
    if (table === 'bank_transactions') return makeChainable(opts.bankLabor);
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

describe('useMonthlyMetrics labor_cost emission (real renderHook coverage)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('emits the accrued (time-punch) subtotal, NOT accrued + paid, when a month has both', async () => {
    mockSupabaseClient({
      timePunches: accruedShiftPunches,
      employees: [employee],
      // Paid labor via bank transactions — same month, different day. If the
      // hook's emission reverts to the old summed accumulator, labor_cost
      // would include this too.
      bankLabor: [bankLaborRow('2026-07-20', 60)], // $60 paid
    });

    const { useMonthlyMetrics } = await import('@/hooks/useMonthlyMetrics');

    const { result } = renderHook(
      () => useMonthlyMetrics(RESTAURANT, dateFrom, dateTo, LEGACY_UTC_FRAME),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();

    const july = result.current.data?.find((m) => m.period === '2026-07');
    expect(july).toBeDefined();

    // Both sources are present and non-zero...
    expect(july!.pending_labor_cost).toBeCloseTo(100, 5); // accrued: 5h * $20
    expect(july!.actual_labor_cost).toBeCloseTo(60, 5); // paid

    // ...but the emitted labor_cost is the accrued subtotal alone, strictly
    // less than the (double-counted) sum of both sources. This is the
    // assertion that fails if the emission is reverted to
    // `month.labor_cost` (which would be 100 + 60 = 160).
    expect(july!.labor_cost).toBeCloseTo(july!.pending_labor_cost, 5);
    expect(july!.labor_cost).toBeCloseTo(100, 5);
    expect(july!.labor_cost).toBeLessThan(july!.pending_labor_cost + july!.actual_labor_cost);
  });

  it('falls back to the paid (bank) subtotal when a month has no accrued punch labor', async () => {
    mockSupabaseClient({
      timePunches: [], // no punches this month → no accrued labor
      employees: [employee],
      bankLabor: [bankLaborRow('2026-07-20', 45)], // $45 paid, the only labor source
    });

    const { useMonthlyMetrics } = await import('@/hooks/useMonthlyMetrics');

    const { result } = renderHook(
      () => useMonthlyMetrics(RESTAURANT, dateFrom, dateTo, LEGACY_UTC_FRAME),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();

    const july = result.current.data?.find((m) => m.period === '2026-07');
    expect(july).toBeDefined();

    expect(july!.pending_labor_cost).toBe(0);
    expect(july!.actual_labor_cost).toBeCloseTo(45, 5);
    expect(july!.labor_cost).toBeCloseTo(july!.actual_labor_cost, 5);
    expect(july!.labor_cost).toBeCloseTo(45, 5);
  });
});
