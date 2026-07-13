import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// --- Mock the Supabase client query builder ---
const { mockSupabase } = vi.hoisted(() => ({
  mockSupabase: { from: vi.fn() },
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

import { useSplhData } from '@/hooks/useSplhData';

const PAGE = 1000;
const MAX_PAGES = 20;

type QueryResult = { data: unknown; error: unknown };
type MockBuilder = {
  __range?: [number, number];
  then: (
    onFulfilled: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
  [method: string]: unknown;
};

type CallLog = {
  eq: Array<[string, unknown]>;
  is: Array<[string, unknown]>;
  gte: Array<[string, unknown]>;
  lte: Array<[string, unknown]>;
  order: Array<[string, unknown]>;
  range: Array<[number, number]>;
};

function freshLog(): CallLog {
  return { eq: [], is: [], gte: [], lte: [], order: [], range: [] };
}

// Chainable builder: every filter/order method returns the builder and records
// its call into `log`; awaiting it resolves via `resolver`.
function makeBuilder(log: CallLog, resolver: (b: MockBuilder) => QueryResult) {
  const builder = {} as MockBuilder;
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn((col: string, val: unknown) => {
    log.eq.push([col, val]);
    return builder;
  });
  builder.is = vi.fn((col: string, val: unknown) => {
    log.is.push([col, val]);
    return builder;
  });
  builder.gte = vi.fn((col: string, val: unknown) => {
    log.gte.push([col, val]);
    return builder;
  });
  builder.lte = vi.fn((col: string, val: unknown) => {
    log.lte.push([col, val]);
    return builder;
  });
  builder.order = vi.fn((col: string, opts?: unknown) => {
    log.order.push([col, opts]);
    return builder;
  });
  builder.range = vi.fn((from: number, to: number) => {
    builder.__range = [from, to];
    log.range.push([from, to]);
    return builder;
  });
  builder.then = (onFulfilled, onRejected) =>
    Promise.resolve(resolver(builder)).then(onFulfilled, onRejected);
  return builder;
}

function saleRow(from: number) {
  return {
    sale_date: '2026-07-06',
    sale_time: '10:00:00',
    sold_at: '2026-07-06T10:00:00Z',
    total_price: 1,
    __seq: from,
  };
}

function punchRow(from: number) {
  return {
    id: `punch-${from}`,
    restaurant_id: 'rest-1',
    employee_id: 'emp-1',
    punch_type: 'clock_in',
    punch_time: '2026-07-06T10:00:00Z',
    __seq: from,
  };
}

const salesLog: CallLog = freshLog();
const punchesLog: CallLog = freshLog();

/** `salesPageSizes`/`punchesPageSizes`: size of each successive page. When the
 * requested page index exceeds the array, the last size is reused (so a
 * constant `[PAGE]` config yields infinite full pages, capped by MAX_PAGES). */
function setup(salesPageSizes: number[], punchesPageSizes: number[]) {
  Object.assign(salesLog, freshLog());
  Object.assign(punchesLog, freshLog());

  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'unified_sales') {
      return makeBuilder(salesLog, (b) => {
        const [from] = b.__range as [number, number];
        const page = from / PAGE;
        const size = salesPageSizes[page] ?? salesPageSizes[salesPageSizes.length - 1];
        return { data: Array.from({ length: size }, (_, i) => saleRow(from + i)), error: null };
      });
    }
    if (table === 'time_punches') {
      return makeBuilder(punchesLog, (b) => {
        const [from] = b.__range as [number, number];
        const page = from / PAGE;
        const size = punchesPageSizes[page] ?? punchesPageSizes[punchesPageSizes.length - 1];
        return { data: Array.from({ length: size }, (_, i) => punchRow(from + i)), error: null };
      });
    }
    throw new Error(`unexpected table ${table}`);
  });
}

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useSplhData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches sales + punches with the required filters and a deterministic tiebreaker order', async () => {
    setup([3], [2]); // both short pages → single fetch each, no pagination

    const { result } = renderHook(() => useSplhData('rest-1', 'UTC', 4), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.sales).toHaveLength(3);
    expect(result.current.data?.punches).toHaveLength(2);
    expect(result.current.data?.capped).toBe(false);

    // Split-sale guard + sale-row-only filter (§5 S-M1).
    expect(salesLog.eq).toContainEqual(['restaurant_id', 'rest-1']);
    expect(salesLog.eq).toContainEqual(['item_type', 'sale']);
    expect(salesLog.is).toContainEqual(['parent_sale_id', null]);

    // Fully-unique ORDER BY so OFFSET pagination is deterministic (§5 S-M2).
    expect(salesLog.order.map(([col]) => col)).toEqual(['sale_date', 'created_at', 'id']);
    expect(punchesLog.order.map(([col]) => col)).toEqual(['employee_id', 'punch_time', 'id']);

    expect(punchesLog.eq).toContainEqual(['restaurant_id', 'rest-1']);
  });

  it('pages until a short page is returned, at strictly increasing, non-overlapping offsets', async () => {
    setup([PAGE, PAGE, 250], [PAGE, 40]);

    const { result } = renderHook(() => useSplhData('rest-1', 'UTC', 4), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.sales).toHaveLength(PAGE + PAGE + 250);
    expect(result.current.data?.punches).toHaveLength(PAGE + 40);
    expect(result.current.data?.capped).toBe(false);

    expect(salesLog.range).toEqual([
      [0, PAGE - 1],
      [PAGE, PAGE * 2 - 1],
      [PAGE * 2, PAGE * 3 - 1],
    ]);
    expect(punchesLog.range).toEqual([
      [0, PAGE - 1],
      [PAGE, PAGE * 2 - 1],
    ]);
  });

  it('stops at the hard page cap and reports capped:true instead of looping unbounded (§11 S-min3)', async () => {
    setup([PAGE], [1]); // every sales page is full → never terminates naturally

    const { result } = renderHook(() => useSplhData('rest-1', 'UTC', 4), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(salesLog.range).toHaveLength(MAX_PAGES);
    expect(result.current.data?.sales).toHaveLength(MAX_PAGES * PAGE);
    expect(result.current.data?.capped).toBe(true);
  });

  it('derives the query window from the restaurant-local date, not the host/UTC date (§5 S-min1)', async () => {
    // 2026-07-14T05:00:00Z is already July 14 in UTC, but still July 13
    // in Honolulu (UTC-10, no DST) — a tz that gets this wrong will send
    // the wrong end-of-window date to Supabase.
    // Fake only `Date` (leave timers real) so `waitFor`'s internal polling
    // still advances — faking the timer queue too would deadlock it.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-14T05:00:00Z'));
    setup([1], [1]);

    const { result } = renderHook(() => useSplhData('rest-1', 'Pacific/Honolulu', 1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(salesLog.lte).toContainEqual(['sale_date', '2026-07-13']);
    expect(salesLog.gte).toContainEqual(['sale_date', '2026-07-06']);
    expect(punchesLog.lte).toContainEqual(['punch_time', '2026-07-13T23:59:59']);
    expect(punchesLog.gte).toContainEqual(['punch_time', '2026-07-06']);
  });

  it('does not fetch when restaurantId is null', async () => {
    setup([1], [1]);

    const { result } = renderHook(() => useSplhData(null, 'UTC', 4), {
      wrapper: createWrapper(),
    });

    // Give any (incorrect) eager fetch a chance to fire.
    await new Promise((r) => setTimeout(r, 0));

    expect(result.current.isFetching).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });
});
