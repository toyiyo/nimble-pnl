/**
 * Unit tests for useScheduleClockAudit.
 *
 * Pins three review fixes:
 *   1. Restaurant-timezone normalization: `start`/`end` are viewer-local
 *      calendar-day tokens. The hook converts them to restaurant-zone
 *      instants (the `usePayroll` pattern) before it queries or filters,
 *      not the viewer's own timezone.
 *   2. Shifts query pagination: fetched via `fetchAllRows` with an
 *      `.order('id')` tiebreaker, not a single unbounded `.select()`
 *      (PostgREST caps an unpaginated response at 1,000 rows).
 *   3. Combined loading/error state: `loading` is true while either the
 *      shifts query or the `useTimePunches` hook is loading; `error`
 *      surfaces whichever query failed first.
 */
import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { businessDayRangeToInstants } from '@/lib/restaurantClock';
import { toDateOnlyString } from '@/lib/dateOnly';
import { bufferPunchFetchRange } from '@/utils/punchWindow';

const RESTAURANT_TZ = 'America/Chicago';

const { useTimePunchesMock, useRestaurantClockMock } = vi.hoisted(() => ({
  useTimePunchesMock: vi.fn(),
  useRestaurantClockMock: vi.fn(),
}));

vi.mock('@/hooks/useTimePunches', () => ({
  useTimePunches: (...args: unknown[]) => useTimePunchesMock(...args),
}));

vi.mock('@/hooks/useRestaurantClock', () => ({
  useRestaurantClock: (...args: unknown[]) => useRestaurantClockMock(...args),
}));

// `any` here: the return value stands in for a raw Supabase row, which
// carries no exported row type in this test file.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toDbShift(id: string, start_time: string, end_time: string): any {
  return {
    id,
    restaurant_id: 'rest-1',
    employee_id: 'emp-1',
    start_time,
    end_time,
    break_duration: 0,
    position: 'Server',
    status: 'scheduled',
    is_published: true,
  };
}

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

// Local-time constructors (not ISO UTC strings): `toDateOnlyString` reads
// LOCAL calendar fields off the Date, so building `start`/`end` this way
// keeps the expected day tokens the same on every machine's TZ, matching
// how `Payroll.tsx` builds them from a date picker.
const START = new Date(2026, 7, 10, 0, 0, 0); // Aug 10, 2026, local
const END = new Date(2026, 7, 16, 23, 59, 59); // Aug 16, 2026, local

function expectedRange() {
  const range = businessDayRangeToInstants(
    toDateOnlyString(START),
    toDateOnlyString(END),
    RESTAURANT_TZ,
  );
  const dayStart = range.start;
  const dayEnd = range.end;
  const { fetchStart, fetchEnd } = bufferPunchFetchRange(dayStart, dayEnd);
  return { dayStart, dayEnd, fetchStart, fetchEnd };
}

// `any` here: `pages` holds raw Supabase rows built by `toDbShift`, which
// itself returns `any` for the same reason.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeShiftsChain(pages: any[][]) {
  const rangeCalls: Array<[number, number]> = [];
  const gteCalls: unknown[][] = [];
  const lteCalls: unknown[][] = [];
  const orderCalls: unknown[][] = [];

  // `any` here: `chain` is a mock Supabase query builder, assembled one
  // method at a time below, so no single builder type covers it mid-build.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.gte = vi.fn((...args: unknown[]) => {
    gteCalls.push(args);
    return chain;
  });
  chain.lte = vi.fn((...args: unknown[]) => {
    lteCalls.push(args);
    return chain;
  });
  chain.order = vi.fn((...args: unknown[]) => {
    orderCalls.push(args);
    return chain;
  });
  let callIndex = 0;
  chain.range = vi.fn((from: number, to: number) => {
    rangeCalls.push([from, to]);
    const page = pages[callIndex] ?? [];
    callIndex += 1;
    return Promise.resolve({ data: page, error: null });
  });

  return { chain, rangeCalls, gteCalls, lteCalls, orderCalls };
}

describe('useScheduleClockAudit', () => {
  beforeEach(() => {
    useRestaurantClockMock.mockReturnValue({ tz: RESTAURANT_TZ });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('converts viewer-local start/end into restaurant-zone instants for both the shifts query and the punches fetch', async () => {
    useTimePunchesMock.mockReturnValue({ punches: [], loading: false, error: null });

    const { chain, rangeCalls, gteCalls, lteCalls } = makeShiftsChain([[]]);
    const fromMock = vi.fn((table: string) => {
      if (table === 'shifts') return chain;
      throw new Error(`unexpected table ${table}`);
    });
    vi.doMock('@/integrations/supabase/client', () => ({
      supabase: { from: (...args: [string]) => fromMock(...args) },
    }));

    const { useScheduleClockAudit } = await import('@/hooks/useScheduleClockAudit');
    renderHook(() => useScheduleClockAudit('rest-1', START, END, 10), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(rangeCalls.length).toBeGreaterThan(0));

    const { dayEnd, fetchStart, fetchEnd } = expectedRange();

    // The shifts query is bounded by the restaurant-zone instants, not the
    // viewer-local Date objects passed in.
    expect(gteCalls[0]).toEqual(['start_time', fetchStart.toISOString()]);
    expect(lteCalls[0]).toEqual(['start_time', dayEnd.toISOString()]);

    // The punches hook gets the same buffered restaurant-zone window.
    expect(useTimePunchesMock).toHaveBeenCalledWith('rest-1', undefined, fetchStart, fetchEnd);
  });

  it('paginates the shifts query via .range() with advancing offsets and an id tiebreaker', async () => {
    useTimePunchesMock.mockReturnValue({ punches: [], loading: false, error: null });

    // 2 pages: 1,000 rows then 7 more, matching the fetchAllRows pagination
    // shape used elsewhere in the codebase (usePayroll, useTimePunches).
    const page0 = Array.from({ length: 1000 }, (_, i) =>
      toDbShift(`s${i}`, '2026-08-11T14:00:00.000Z', '2026-08-11T22:00:00.000Z'));
    const page1 = Array.from({ length: 7 }, (_, i) =>
      toDbShift(`s${1000 + i}`, '2026-08-12T14:00:00.000Z', '2026-08-12T22:00:00.000Z'));

    const { chain, rangeCalls, orderCalls } = makeShiftsChain([page0, page1]);
    const fromMock = vi.fn((table: string) => {
      if (table === 'shifts') return chain;
      throw new Error(`unexpected table ${table}`);
    });
    vi.doMock('@/integrations/supabase/client', () => ({
      supabase: { from: (...args: [string]) => fromMock(...args) },
    }));

    const { useScheduleClockAudit } = await import('@/hooks/useScheduleClockAudit');
    const { result } = renderHook(() => useScheduleClockAudit('rest-1', START, END, 10), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(orderCalls).toEqual([
      ['start_time', { ascending: true }],
      ['id'],
      ['start_time', { ascending: true }],
      ['id'],
    ]);
  });

  it('returns an error when the shift query hits the page cap', async () => {
    useTimePunchesMock.mockReturnValue({ punches: [], loading: false, error: null });

    // 20 full pages hit the fetchAllRows page cap. The hook must not audit
    // the truncated prefix as if it were the complete shift list.
    const fullPage = Array.from({ length: 1000 }, (_, i) =>
      toDbShift(`s${i}`, '2026-08-11T14:00:00.000Z', '2026-08-11T22:00:00.000Z'));
    const pages = Array.from({ length: 20 }, () => fullPage);

    const { chain } = makeShiftsChain(pages);
    const fromMock = vi.fn((table: string) => {
      if (table === 'shifts') return chain;
      throw new Error(`unexpected table ${table}`);
    });
    vi.doMock('@/integrations/supabase/client', () => ({
      supabase: { from: (...args: [string]) => fromMock(...args) },
    }));

    const { useScheduleClockAudit } = await import('@/hooks/useScheduleClockAudit');
    const { result } = renderHook(() => useScheduleClockAudit('rest-1', START, END, 10), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(String(result.current.error)).toMatch(/incomplete/);
  });

  it('reports loading while either the shifts query or the punches hook is still loading', async () => {
    useTimePunchesMock.mockReturnValue({ punches: [], loading: true, error: null });

    const { chain } = makeShiftsChain([[]]);
    const fromMock = vi.fn((table: string) => {
      if (table === 'shifts') return chain;
      throw new Error(`unexpected table ${table}`);
    });
    vi.doMock('@/integrations/supabase/client', () => ({
      supabase: { from: (...args: [string]) => fromMock(...args) },
    }));

    const { useScheduleClockAudit } = await import('@/hooks/useScheduleClockAudit');
    const { result } = renderHook(() => useScheduleClockAudit('rest-1', START, END, 10), {
      wrapper: createWrapper(),
    });

    // The shifts query resolves quickly (empty page), but `useTimePunches`
    // still reports `loading: true` -- the combined `loading` must stay true.
    await waitFor(() => expect(chain.range).toHaveBeenCalled());
    expect(result.current.loading).toBe(true);
  });

  it('surfaces the shifts query error even when the punches hook has none', async () => {
    useTimePunchesMock.mockReturnValue({ punches: [], loading: false, error: null });

    // `any` here: `chain` is a mock Supabase query builder, assembled one
    // method at a time below, so no single builder type covers it mid-build.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.gte = vi.fn(() => chain);
    chain.lte = vi.fn(() => chain);
    chain.order = vi.fn(() => chain);
    chain.range = vi.fn(() =>
      Promise.resolve({ data: null, error: { message: 'shifts fetch failed' } }));

    const fromMock = vi.fn((table: string) => {
      if (table === 'shifts') return chain;
      throw new Error(`unexpected table ${table}`);
    });
    vi.doMock('@/integrations/supabase/client', () => ({
      supabase: { from: (...args: [string]) => fromMock(...args) },
    }));

    const { useScheduleClockAudit } = await import('@/hooks/useScheduleClockAudit');
    const { result } = renderHook(() => useScheduleClockAudit('rest-1', START, END, 10), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.loading).toBe(false);
  });

  it('surfaces the punches hook error when the shifts query succeeds', async () => {
    const punchesError = new Error('punches fetch failed');
    useTimePunchesMock.mockReturnValue({ punches: [], loading: false, error: punchesError });

    const { chain } = makeShiftsChain([[]]);
    const fromMock = vi.fn((table: string) => {
      if (table === 'shifts') return chain;
      throw new Error(`unexpected table ${table}`);
    });
    vi.doMock('@/integrations/supabase/client', () => ({
      supabase: { from: (...args: [string]) => fromMock(...args) },
    }));

    const { useScheduleClockAudit } = await import('@/hooks/useScheduleClockAudit');
    const { result } = renderHook(() => useScheduleClockAudit('rest-1', START, END, 10), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(punchesError);
  });
});
