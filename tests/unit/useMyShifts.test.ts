/**
 * Unit Tests: `useMyShifts` (self-scoped) and `useShifts` (admin) regression guard
 *
 * Per docs/superpowers/specs/2026-08-05-employee-self-scoped-data-design.md §3.2, both
 * hooks share one internal implementation with two public entry points:
 *
 * - `useShifts(restaurantId, startDate?, endDate?)` — unchanged admin behaviour, no
 *   `employee_id` predicate.
 * - `useMyShifts(restaurantId, employeeId, startDate?, endDate?)` — applies
 *   `.eq('employee_id', employeeId)` and is only enabled once `employeeId` is non-null
 *   (§3.1: an optional filter that silently degrades to "no filter" while
 *   `useCurrentEmployee` is still resolving would re-open the restaurant-wide read this
 *   change closes).
 *
 * These assertions inspect the recorded query-builder calls, not the returned rows — a
 * row-based assertion would pass vacuously if the filter were applied client-side instead
 * of pushed into the query.
 */
import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useShifts, useMyShifts } from '@/hooks/useShifts';

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

const createWrapper = (queryClient: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return Wrapper;
};

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

type RecordedCall = { method: string; args: unknown[] };

/**
 * A chainable query-builder mock that records every `select`/`eq`/`gte`/`lte`/`order`
 * call regardless of the order the hook chains them in, then resolves on `.order()` —
 * matching the point at which `useShifts`'s queryFn awaits the query today.
 */
function setupShiftsQueryChain(): { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};

  (['select', 'eq', 'gte', 'lte'] as const).forEach((method) => {
    builder[method] = vi.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    });
  });

  builder.order = vi.fn((...args: unknown[]) => {
    calls.push({ method: 'order', args });
    return Promise.resolve({ data: [], error: null });
  });

  mockSupabase.from.mockReturnValue(builder);

  return { calls };
}

const restaurantId = 'rest-123';
const startDate = new Date('2026-07-14T00:00:00.000Z');
const endDate = new Date('2026-07-20T23:59:59.999Z');

describe('useMyShifts (self-scoped)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies .eq('employee_id', <id>) when given an employee id", async () => {
    const { calls } = setupShiftsQueryChain();

    const { result } = renderHook(() => useMyShifts(restaurantId, 'emp-1', startDate, endDate), {
      wrapper: createWrapper(createQueryClient()),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockSupabase.from).toHaveBeenCalledWith('shifts');
    expect(calls).toContainEqual({ method: 'eq', args: ['employee_id', 'emp-1'] });
    expect(calls).toContainEqual({ method: 'eq', args: ['restaurant_id', restaurantId] });
  });

  it('issues no query against shifts when employeeId is null', async () => {
    setupShiftsQueryChain();

    const { result } = renderHook(() => useMyShifts(restaurantId, null, startDate, endDate), {
      wrapper: createWrapper(createQueryClient()),
    });

    // Disabled query: React Query never runs the queryFn, so loading never
    // transitions to true and settles immediately as not-loading.
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('keys the query on employeeId so admin and self caches cannot collide', async () => {
    setupShiftsQueryChain();
    const queryClient = createQueryClient();

    const { result } = renderHook(() => useMyShifts(restaurantId, 'emp-1', startDate, endDate), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    const keys = queryClient.getQueryCache().getAll().map((query) => query.queryKey);
    const matching = keys.find((key) => Array.isArray(key) && key[0] === 'shifts');

    expect(matching).toBeDefined();
    expect(matching).toContain('emp-1');
  });

  it('keys the unresolved self-scoped state (employeeId: null) DIFFERENTLY from the admin key, so a disabled query cannot read back an admin query\'s cache', async () => {
    // Regression test for a query-key collision: `employeeId ?? 'all'` would
    // map BOTH admin mode (employeeId === undefined, via useShifts) and
    // self-scoped-but-unresolved mode (employeeId === null, via useMyShifts
    // before useCurrentEmployee resolves) to the identical 'all' segment.
    // `enabled: false` only suppresses a new fetch, not a cache read, so a
    // dual-role viewer mounting useMyShifts after useShifts already cached
    // restaurant-wide data for the same range would transiently read that
    // cached admin data back through the self-scoped hook.
    setupShiftsQueryChain();
    const queryClient = createQueryClient();

    const { result: adminResult } = renderHook(
      () => useShifts(restaurantId, startDate, endDate),
      { wrapper: createWrapper(queryClient) },
    );
    await waitFor(() => expect(adminResult.current.loading).toBe(false));

    renderHook(() => useMyShifts(restaurantId, null, startDate, endDate), {
      wrapper: createWrapper(queryClient),
    });

    const keys = queryClient.getQueryCache().getAll().map((query) => query.queryKey);
    const shiftsKeys = keys.filter((key) => Array.isArray(key) && key[0] === 'shifts');

    // Two distinct cache entries must exist — admin and unresolved-self-scoped
    // must never collide onto the same key.
    expect(shiftsKeys).toHaveLength(2);
    expect(shiftsKeys[0]).not.toEqual(shiftsKeys[1]);
  });
});

describe('useShifts (admin) — regression guard for the shared implementation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('issues exactly the query it issues today, with no employee_id predicate', async () => {
    const { calls } = setupShiftsQueryChain();

    const { result } = renderHook(() => useShifts(restaurantId, startDate, endDate), {
      wrapper: createWrapper(createQueryClient()),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockSupabase.from).toHaveBeenCalledWith('shifts');
    expect(calls).toContainEqual({ method: 'select', args: ['*, employee:employees(*)'] });
    expect(calls).toContainEqual({ method: 'eq', args: ['restaurant_id', restaurantId] });
    expect(calls).toContainEqual({ method: 'gte', args: ['start_time', startDate.toISOString()] });
    expect(calls).toContainEqual({ method: 'lte', args: ['start_time', endDate.toISOString()] });
    expect(calls).toContainEqual({ method: 'order', args: ['start_time'] });

    const employeeIdCalls = calls.filter(
      (call) => call.method === 'eq' && call.args[0] === 'employee_id',
    );
    expect(employeeIdCalls).toHaveLength(0);
  });
});
