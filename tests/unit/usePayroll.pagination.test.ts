/**
 * Regression test for `usePayroll`'s `time_punches` fetch (design:
 * docs/superpowers/specs/2026-07-23-paginate-time-punches-design.md, Task 3).
 *
 * `usePayroll` fetches `time_punches` for a payroll period with a single
 * unpaginated query, ordered `punch_time asc`. PostgREST caps an unpaginated
 * response at 1,000 rows, so a pay period with >1,000 punches would silently
 * drop the newest punches and understate/misstate pay.
 *
 * This test asserts:
 *   1. The fetch asks for pages of 1,000 rows (`.range(0, 999)`), and each
 *      next page starts after the last `(punch_time, id)` of the page before
 *      (keyset paging via `fetchAllRowsKeyset`, not offsets) — proving the
 *      fetch is paginated, not a single unbounded `.select()`.
 *   2. `.order('id')` is added as a deterministic tiebreaker after
 *      `.order('punch_time', { ascending: true })`.
 *   3. When the fetch hits the `maxPages` cap (20 full pages),
 *      `usePayroll` surfaces it via `console.warn` (matching its existing
 *      non-fatal-logging pattern — this hook `throw`s on a real Supabase
 *      error, but a page-cap is a safety signal, not a query failure).
 */
import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { keysetAfterFilter } from '../../supabase/functions/_shared/labor/fetchAllRows';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toDbPunch(id: string, employee_id: string, punch_time: string, punch_type: string): any {
  return {
    id, employee_id, restaurant_id: 'rest-1',
    punch_time, punch_type, created_at: punch_time, updated_at: punch_time,
    shift_id: null, notes: null, photo_path: null, device_info: null,
    location: null, created_by: null, modified_by: null,
  };
}

// Generic chainable Supabase query-builder mock for tables we don't assert
// on (tip_splits, tip_split_items, daily_labor_allocations, employee_tips,
// tip_payouts, overtime_adjustments). `.range()` returns the chain, which is
// thenable and resolves to an empty page.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChainable(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  ['select', 'eq', 'in', 'order', 'gte', 'lte', 'or', 'range', 'maybeSingle'].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  chain.then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
    resolve({ data: [], error: null });
  return chain;
}

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({ employees: [{ id: 'emp-1', status: 'active' }], loading: false }),
}));

// usePayroll now sources the restaurant timezone from useRestaurantClock
// (via useRestaurantContext) to bucket punches by the restaurant's calendar
// day. This test only asserts pagination behavior (`.range()` offsets), so
// the specific timezone value is not load-bearing — just needs to be present.
vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { timezone: 'America/Chicago' } },
  }),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

describe('usePayroll time_punches pagination (1000-row cap fix)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('pages time_punches with keyset paging and orders by id as a tiebreaker', async () => {
    const rangeCalls: Array<[number, number]> = [];
    const orderCalls: unknown[][] = [];
    const orCalls: string[] = [];

    // 1,039 rows across 2 pages (1,000 + 39), matching the prod repro shape.
    const page0 = Array.from({ length: 1000 }, (_, i) =>
      toDbPunch(`p${i}`, 'emp-1', `2026-03-0${(i % 6) + 1}T10:00:00.000Z`, i % 2 === 0 ? 'clock_in' : 'clock_out'));
    const page1 = Array.from({ length: 39 }, (_, i) =>
      toDbPunch(`p${1000 + i}`, 'emp-1', `2026-03-07T10:00:00.000Z`, i % 2 === 0 ? 'clock_in' : 'clock_out'));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const timePunchesChain: any = {};
    ['select', 'eq', 'gte', 'lte'].forEach((m) => {
      timePunchesChain[m] = vi.fn(() => timePunchesChain);
    });
    timePunchesChain.order = vi.fn((...args: unknown[]) => {
      orderCalls.push(args);
      return timePunchesChain;
    });
    timePunchesChain.or = vi.fn((filters: string) => {
      orCalls.push(filters);
      return timePunchesChain;
    });
    let callIndex = 0;
    timePunchesChain.range = vi.fn((from: number, to: number) => {
      rangeCalls.push([from, to]);
      const page = callIndex === 0 ? page0 : callIndex === 1 ? page1 : [];
      callIndex++;
      return Promise.resolve({ data: page, error: null });
    });

    const fromMock = vi.fn((table: string) => {
      if (table === 'time_punches') return timePunchesChain;
      return makeChainable();
    });

    vi.doMock('@/integrations/supabase/client', () => ({
      supabase: { from: (...args: [string]) => fromMock(...args) },
    }));

    const { usePayroll } = await import('@/hooks/usePayroll');

    const startDate = new Date('2026-03-02T00:00:00.000Z');
    const endDate = new Date('2026-03-08T23:59:59.999Z');

    const { result } = renderHook(
      () => usePayroll('rest-1', startDate, endDate),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    // Proves the fetch is paginated (not a single unbounded `.select()`):
    // two pages of up to 1,000 rows cover all 1,039 rows, and the second
    // page starts after the last (punch_time, id) of the first.
    expect(rangeCalls).toEqual([
      [0, 999],
      [0, 999],
    ]);
    const last = page0[page0.length - 1];
    expect(orCalls).toEqual([keysetAfterFilter('punch_time', { key: last.punch_time, id: last.id })]);
    // Deterministic page-boundary tiebreaker: `.order('punch_time', {asc})`
    // followed by `.order('id')` — the `buildPage` callback rebuilds the
    // query chain on every page, so this pair repeats once per page fetched
    // (2 pages here).
    expect(orderCalls).toEqual([
      ['punch_time', { ascending: true }],
      ['id'],
      ['punch_time', { ascending: true }],
      ['id'],
    ]);
  });

  it('warns (does not throw) when the time_punches fetch hits the pagination cap', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rangeCalls: Array<[number, number]> = [];

    // Every page comes back full (1,000 rows) so the keyset loop never sees
    // a short page and exhausts its default `maxPages` (20) → `capped: true`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const timePunchesChain: any = {};
    ['select', 'eq', 'gte', 'lte', 'order', 'or'].forEach((m) => {
      timePunchesChain[m] = vi.fn(() => timePunchesChain);
    });
    timePunchesChain.range = vi.fn((from: number, to: number) => {
      const offset = rangeCalls.length * 1000;
      rangeCalls.push([from, to]);
      const page = Array.from({ length: 1000 }, (_, i) =>
        toDbPunch(`p${offset + i}`, 'emp-1', '2026-03-02T10:00:00.000Z', i % 2 === 0 ? 'clock_in' : 'clock_out'));
      return Promise.resolve({ data: page, error: null });
    });

    const fromMock = vi.fn((table: string) => {
      if (table === 'time_punches') return timePunchesChain;
      return makeChainable();
    });

    vi.doMock('@/integrations/supabase/client', () => ({
      supabase: { from: (...args: [string]) => fromMock(...args) },
    }));

    const { usePayroll } = await import('@/hooks/usePayroll');

    const startDate = new Date('2026-03-02T00:00:00.000Z');
    const endDate = new Date('2026-03-08T23:59:59.999Z');

    const { result } = renderHook(
      () => usePayroll('rest-1', startDate, endDate),
      { wrapper: createWrapper() },
    );

    // This fixture's 20,000 punches (the page-cap stress case) now each go
    // through timezone-aware bucketing (`toBusinessDay`/`Intl.DateTimeFormat`
    // per punch instead of a plain local-field read), which is slower than
    // `waitFor`'s 1000ms default — bump it rather than the global testTimeout.
    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 5000 });

    // Hitting the page cap is a safety signal, not a query error — the hook
    // must not surface it as `error`.
    expect(result.current.error).toBeNull();
    expect(rangeCalls.length).toBe(20); // DEFAULT_MAX_PAGES
    expect(warnSpy).toHaveBeenCalled();
  });
});
