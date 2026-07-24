/**
 * Regression test for the /labor "$0 labor for recent days" bug (design:
 * docs/superpowers/specs/2026-07-23-paginate-time-punches-design.md).
 *
 * `useLaborCostsFromTimeTracking`'s `time_punches` fetch spans an 18-week
 * window with a single unpaginated query, ordered `punch_time asc`. PostgREST
 * caps an unpaginated response at 1,000 rows, so once a restaurant crosses
 * that threshold the newest punches (today, yesterday) are silently dropped
 * and their labor reads $0.
 *
 * This test mocks a `time_punches` fetch that requires exactly 2 pages
 * (1,000 + 39 = 1,039 rows, matching the real prod repro in
 * `laborPunchPaginationRepro.test.ts`) and asserts:
 *   1. `.range()` was called with advancing offsets (`[0,999]`, `[1000,1999]`)
 *      — proving the fetch is paginated, not a single unbounded `.select()`.
 *   2. The newest day's computed labor is non-zero — the bug is fixed
 *      end-to-end through `calculateActualLaborCost`.
 */
import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const RESTAURANT = '7c0c76e3-e770-401b-a2a9-c1edd407efed';

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
// Filler employee absorbing the old backlog punches that fill page 0.
employees.push({ id: 'filler', restaurant_id: RESTAURANT, is_active: true, status: 'active', compensation_type: 'hourly', hourly_rate: 1000 });

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({ employees, loading: false }),
}));

// Real prod punches for the newest day (Jul 22, UTC) — every shift closed.
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

// Old backlog punches (Mar 20 -> Jul 20) that occupy the bulk of page 0.
function buildBacklog(count: number) {
  const rows = [];
  const start = Date.UTC(2026, 2, 20, 12, 0, 0);
  const end = Date.UTC(2026, 6, 20, 12, 0, 0);
  const step = (end - start) / count;
  for (let i = 0; i < count; i++) {
    const t = new Date(start + i * step);
    rows.push(toDbPunch(['filler', t.toISOString(), i % 2 === 0 ? 'clock_in' : 'clock_out'], i));
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

// Sanity on the fixture itself (not the hook) — page1 must contain the
// newest day's punches, and total must exceed the 1000-row cap.
if (allPunchesSorted.length !== 1039) {
  throw new Error(`fixture drift: expected 1039 total punches, got ${allPunchesSorted.length}`);
}
if (page1.length !== 39) {
  throw new Error(`fixture drift: expected page1 to have 39 rows, got ${page1.length}`);
}

// Generic chainable Supabase query-builder mock for tables we don't assert
// on (e.g. `daily_labor_allocations`).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChainable(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  ['select', 'eq', 'in', 'order', 'gte', 'lte', 'maybeSingle'].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  chain.then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
    resolve({ data: [], error: null });
  return chain;
}

// `time_punches` chain: every method returns `this` except `.range()`, which
// resolves to successive pages so the fetch behaves like real paginated
// Supabase/PostgREST calls — this is what actually exercises `fetchAllRows`.
const rangeCalls: Array<[number, number]> = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeTimePunchesChain(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  ['select', 'eq', 'gte', 'lte', 'order'].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  let callIndex = 0;
  chain.range = vi.fn((from: number, to: number) => {
    rangeCalls.push([from, to]);
    const page = callIndex === 0 ? page0 : callIndex === 1 ? page1 : [];
    callIndex++;
    return Promise.resolve({ data: page, error: null });
  });
  return chain;
}

const timePunchesChain = makeTimePunchesChain();
const fromMock = vi.fn((table: string) => {
  if (table === 'time_punches') return timePunchesChain;
  return makeChainable();
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (...args: [string]) => fromMock(...args),
  },
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

describe('useLaborCostsFromTimeTracking pagination (1000-row cap fix)', () => {
  // Pin to the restaurant's real timezone (America/Chicago). Day-bucketing in
  // calculateActualLaborCost uses the HOST-local day, and $586.72 is the Jul 22
  // total as seen in Chicago. Without pinning, CI's UTC host buckets employee
  // 0f5da8cc's second split shift (clock-in 2026-07-23T01:56Z = Jul 22 20:56
  // Chicago) onto Jul 23, dropping $26.44 and yielding $560.28.
  let originalTZ: string | undefined;
  beforeAll(() => {
    originalTZ = process.env.TZ;
    process.env.TZ = 'America/Chicago';
  });
  afterAll(() => {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  });

  beforeEach(() => {
    rangeCalls.length = 0;
    fromMock.mockClear();
  });

  it('paginates time_punches via .range() with advancing offsets and computes non-zero labor for the newest day', async () => {
    const { useLaborCostsFromTimeTracking } = await import('@/hooks/useLaborCostsFromTimeTracking');

    // Window matching the prod repro (host-local dates spanning the backlog
    // through the newest day).
    const dateFrom = new Date(2026, 2, 19);
    const dateTo = new Date(2026, 6, 23, 23, 59, 59, 999);

    const { result } = renderHook(
      () => useLaborCostsFromTimeTracking(RESTAURANT, dateFrom, dateTo),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Proves the fetch is paginated (not a single unbounded `.select()`):
    // offsets advance across the 2 pages needed to cover all 1,039 rows.
    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);

    // Proves the bug is fixed end-to-end: with only page 0 (oldest 1000
    // rows), every newest-day punch would be dropped and its labor would be
    // $0. With both pages fetched, the newest day's labor is non-zero.
    const newestDay = result.current.dailyCosts.find((d) => d.date === '2026-07-22');
    expect(newestDay).toBeDefined();
    expect(newestDay?.total_labor_cost).toBeGreaterThan(0);
    expect(newestDay?.total_labor_cost).toBeCloseTo(586.72, 1);
  });
});
