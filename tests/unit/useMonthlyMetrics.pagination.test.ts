/**
 * Regression test for `useMonthlyMetrics`'s `time_punches` fetch (design:
 * docs/superpowers/specs/2026-07-23-paginate-time-punches-design.md, Task 4).
 *
 * `useMonthlyMetrics` fetches `time_punches` for the query window with a
 * single unpaginated query, ordered `punch_time asc`. PostgREST caps an
 * unpaginated response at 1,000 rows, so a month whose punches exceed that
 * threshold would silently drop the newest punches (the query orders
 * ascending) and understate/zero out that month's labor cost.
 *
 * This test asserts:
 *   1. `.range()` is called with advancing offsets across pages — proving
 *      the fetch is paginated via `fetchAllRows`, not a single unbounded
 *      `.select()`.
 *   2. `.order('id')` is added as a deterministic tiebreaker after
 *      `.order('punch_time', { ascending: true })`.
 *   3. The bug is fixed end-to-end: with both pages fetched, July 2026's
 *      computed labor cost is non-zero (the target employees' shifts live
 *      on page 1, beyond the old 1000-row cap).
 *   4. When the fetch hits `fetchAllRows`'s `maxPages` cap (20 full pages),
 *      `useMonthlyMetrics` surfaces it via `console.warn` — matching this
 *      hook's existing non-fatal-logging pattern for the time-punches fetch
 *      (it already `console.warn`s on a real Supabase error instead of
 *      throwing).
 */
import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const RESTAURANT = 'rest-monthly-1';

const EMP_IDS = [
  '0a385d92-df60-4c6e-9dfc-78f15bb8c31b', '0f1a7667-f7af-4f86-a500-701f69bf42e8',
  '0f5da8cc-c3f9-41e9-b9d1-6b73ede15a7e', '3ebf26d5-efc2-4078-b6c9-60e1803e3ab1',
  '86e3ae03-0e76-4b01-9dfc-7dab2f2b7b7a', '99beacc9-daa5-4ea4-936b-be8913a2c562',
  'e54ce149-344f-4136-bc65-851e3478ac9f', 'fbf104fe-eb01-435c-b38c-ec601863590d',
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const employees: any[] = EMP_IDS.map((id) => ({
  id, restaurant_id: RESTAURANT,
  is_active: true, status: 'active', compensation_type: 'hourly', hourly_rate: 1000,
}));

// Real shifts for the newest day (Jul 22, UTC) — every shift closed. These
// are the rows that must land on page 1 (offsets 1000-1999) to be counted.
const newestDayPunches: Array<[string, string, string]> = [
  ['0a385d92-df60-4c6e-9dfc-78f15bb8c31b', '2026-07-22T22:29:33.134+00:00', 'clock_in'],
  ['0a385d92-df60-4c6e-9dfc-78f15bb8c31b', '2026-07-23T04:45:13.252+00:00', 'clock_out'],
  ['0f1a7667-f7af-4f86-a500-701f69bf42e8', '2026-07-22T21:34:01.811+00:00', 'clock_in'],
  ['0f1a7667-f7af-4f86-a500-701f69bf42e8', '2026-07-23T04:45:39.744+00:00', 'clock_out'],
  ['0f5da8cc-c3f9-41e9-b9d1-6b73ede15a7e', '2026-07-22T21:02:59.08+00:00', 'clock_in'],
  ['0f5da8cc-c3f9-41e9-b9d1-6b73ede15a7e', '2026-07-23T01:25:23.454+00:00', 'clock_out'],
  ['0f5da8cc-c3f9-41e9-b9d1-6b73ede15a7e', '2026-07-23T01:56:20.499+00:00', 'clock_in'],
  ['0f5da8cc-c3f9-41e9-b9d1-6b73ede15a7e', '2026-07-23T04:34:57.377+00:00', 'clock_out'],
  ['3ebf26d5-efc2-4078-b6c9-60e1803e3ab1', '2026-07-22T14:56:50.942+00:00', 'clock_in'],
  ['3ebf26d5-efc2-4078-b6c9-60e1803e3ab1', '2026-07-22T21:22:01.744+00:00', 'clock_out'],
  ['86e3ae03-0e76-4b01-9dfc-7dab2f2b7b7a', '2026-07-22T21:51:43.134+00:00', 'clock_in'],
  ['86e3ae03-0e76-4b01-9dfc-7dab2f2b7b7a', '2026-07-23T02:09:10.082+00:00', 'clock_out'],
  ['99beacc9-daa5-4ea4-936b-be8913a2c562', '2026-07-22T15:02:31.828+00:00', 'clock_in'],
  ['99beacc9-daa5-4ea4-936b-be8913a2c562', '2026-07-22T18:39:30.297+00:00', 'clock_out'],
  ['99beacc9-daa5-4ea4-936b-be8913a2c562', '2026-07-22T18:39:51.204+00:00', 'clock_in'],
  ['99beacc9-daa5-4ea4-936b-be8913a2c562', '2026-07-22T22:05:22.045+00:00', 'clock_out'],
  ['e54ce149-344f-4136-bc65-851e3478ac9f', '2026-07-22T17:00:04.698+00:00', 'clock_in'],
  ['e54ce149-344f-4136-bc65-851e3478ac9f', '2026-07-22T23:00:03.694+00:00', 'clock_out'],
  ['fbf104fe-eb01-435c-b38c-ec601863590d', '2026-07-22T14:15:29.714+00:00', 'clock_in'],
  ['fbf104fe-eb01-435c-b38c-ec601863590d', '2026-07-23T04:42:22.985+00:00', 'clock_out'],
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toDbPunch([employee_id, punch_time, punch_type]: [string, string, string], i: number): any {
  return {
    id: `p${i}`, employee_id, restaurant_id: RESTAURANT,
    punch_time, punch_type, created_at: punch_time, updated_at: punch_time,
    shift_id: null, notes: null, photo_path: null, device_info: null,
    location: null, created_by: null, modified_by: null,
  };
}

// Backlog punches for an employee NOT in the `employees` fixture, so they
// pad page 0 without contributing any labor cost themselves (the hook's
// labor calc only sums punches for employees present in the `employees`
// fetch) — isolating the assertion to "did page 1 get fetched at all".
function buildBacklog(count: number) {
  const rows = [];
  const start = Date.UTC(2026, 3, 1, 12, 0, 0);
  const end = Date.UTC(2026, 5, 30, 12, 0, 0);
  const step = (end - start) / count;
  for (let i = 0; i < count; i++) {
    const t = new Date(start + i * step);
    rows.push(toDbPunch(['filler-not-an-employee', t.toISOString(), i % 2 === 0 ? 'clock_in' : 'clock_out'], i));
  }
  return rows;
}

// 1,019 backlog rows + 20 newest-day rows = 1,039 total, matching the
// production repro (>1,000, so the 1000-row cap trips without pagination).
const backlog = buildBacklog(1019);
const newestPunches = newestDayPunches.map(toDbPunch);
const allPunchesSorted = [...backlog, ...newestPunches].sort((a, b) =>
  a.punch_time.localeCompare(b.punch_time),
);
const page0 = allPunchesSorted.slice(0, 1000);
const page1 = allPunchesSorted.slice(1000);

if (allPunchesSorted.length !== 1039) {
  throw new Error(`fixture drift: expected 1039 total punches, got ${allPunchesSorted.length}`);
}
if (page1.length !== 39) {
  throw new Error(`fixture drift: expected page1 to have 39 rows, got ${page1.length}`);
}

// Generic chainable Supabase query-builder mock for tables/RPCs we don't
// assert on — resolves to a fixed payload regardless of which chain methods
// were called (mirrors the pattern already used by the sibling
// usePayroll.pagination.test.ts / useLaborCostsFromTimeTracking.pagination.test.ts).
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

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

describe('useMonthlyMetrics time_punches pagination (1000-row cap fix)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('paginates time_punches via .range() with advancing offsets, orders by id as a tiebreaker, and computes non-zero July labor', async () => {
    const rangeCalls: Array<[number, number]> = [];
    const orderCalls: unknown[][] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const timePunchesChain: any = {};
    ['select', 'eq', 'gte', 'lte'].forEach((m) => {
      timePunchesChain[m] = vi.fn(() => timePunchesChain);
    });
    timePunchesChain.order = vi.fn((...args: unknown[]) => {
      orderCalls.push(args);
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
      if (table === 'employees') return makeChainable(employees);
      return makeChainable([]);
    });
    const rpcMock = vi.fn(() => Promise.resolve({ data: [], error: null }));

    vi.doMock('@/integrations/supabase/client', () => ({
      supabase: {
        from: (...args: [string]) => fromMock(...args),
        rpc: (...args: unknown[]) => rpcMock(...args),
      },
    }));

    const { useMonthlyMetrics } = await import('@/hooks/useMonthlyMetrics');

    const dateFrom = new Date(2026, 6, 1);
    const dateTo = new Date(2026, 6, 31, 23, 59, 59, 999);

    const { result } = renderHook(
      () => useMonthlyMetrics(RESTAURANT, dateFrom, dateTo),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeNull();
    // Proves the fetch is paginated (not a single unbounded `.select()`):
    // offsets advance across the 2 pages needed to cover all 1,039 rows.
    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
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

    // Proves the bug is fixed end-to-end: with only page 0 (oldest 1000
    // rows, all belonging to an employee absent from the `employees` table),
    // July's labor would be $0. With both pages fetched, the target
    // employees' Jul 22 shifts (page 1) are included and July's labor cost
    // is non-zero.
    const july = result.current.data?.find((m) => m.period === '2026-07');
    expect(july).toBeDefined();
    expect(july?.labor_cost).toBeGreaterThan(0);
  });

  it('warns (does not throw) when the time_punches fetch hits the pagination cap', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rangeCalls: Array<[number, number]> = [];

    // Every page comes back full (1,000 rows) so `fetchAllRows` never sees a
    // short page and exhausts its default `maxPages` (20) → `capped: true`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const timePunchesChain: any = {};
    ['select', 'eq', 'gte', 'lte', 'order'].forEach((m) => {
      timePunchesChain[m] = vi.fn(() => timePunchesChain);
    });
    timePunchesChain.range = vi.fn((from: number, to: number) => {
      rangeCalls.push([from, to]);
      const page = Array.from({ length: 1000 }, (_, i) =>
        toDbPunch(['filler-not-an-employee', '2026-07-05T10:00:00.000Z', i % 2 === 0 ? 'clock_in' : 'clock_out'], from + i));
      return Promise.resolve({ data: page, error: null });
    });

    const fromMock = vi.fn((table: string) => {
      if (table === 'time_punches') return timePunchesChain;
      return makeChainable([]);
    });
    const rpcMock = vi.fn(() => Promise.resolve({ data: [], error: null }));

    vi.doMock('@/integrations/supabase/client', () => ({
      supabase: {
        from: (...args: [string]) => fromMock(...args),
        rpc: (...args: unknown[]) => rpcMock(...args),
      },
    }));

    const { useMonthlyMetrics } = await import('@/hooks/useMonthlyMetrics');

    const dateFrom = new Date(2026, 6, 1);
    const dateTo = new Date(2026, 6, 31, 23, 59, 59, 999);

    const { result } = renderHook(
      () => useMonthlyMetrics(RESTAURANT, dateFrom, dateTo),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Hitting the page cap is a safety signal, not a query error — the hook
    // must not surface it as `error`.
    expect(result.current.error).toBeNull();
    expect(rangeCalls.length).toBe(20); // DEFAULT_MAX_PAGES
    expect(warnSpy).toHaveBeenCalled();
  });
});
