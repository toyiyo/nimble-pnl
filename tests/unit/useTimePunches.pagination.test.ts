/**
 * Regression test for `useTimePunches`'s `time_punches` fetch (design:
 * docs/superpowers/specs/2026-07-23-paginate-time-punches-design.md, 4th call
 * site — folded in after Phase 7a review).
 *
 * `useTimePunches` (used by TimePunchesManager.tsx and Tips.tsx) fetched
 * `time_punches` with a single unpaginated query, ordered `punch_time desc`.
 * PostgREST caps an unpaginated response at 1,000 rows, so a busy restaurant's
 * wide window (e.g. the manager's month view with all employees) would
 * silently drop the OLDEST punches from the manager/export/editing UI.
 *
 * This test asserts:
 *   1. `.range()` is called with advancing offsets across pages — proving the
 *      fetch is paginated via `fetchAllRows`, not a single unbounded
 *      `.select()`.
 *   2. `.order('id')` is added as a deterministic tiebreaker after
 *      `.order('punch_time', { ascending: false })` (this hook orders DESC).
 *   3. All rows across both pages are returned (the newest AND the oldest
 *      boundary punches survive).
 *   4. When the fetch hits `fetchAllRows`'s `maxPages` cap, the hook surfaces
 *      it via `console.warn` (non-fatal) rather than throwing.
 */
import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toDbPunch(id: string, employee_id: string, punch_time: string, punch_type: string): any {
  return {
    id, employee_id, restaurant_id: 'rest-1',
    punch_time, punch_type, created_at: punch_time, updated_at: punch_time,
    shift_id: null, notes: null, photo_path: null, device_info: null,
    location: null, created_by: null, modified_by: null,
    employee: { id: employee_id, name: 'Test', position: 'server' },
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

describe('useTimePunches time_punches pagination (1000-row cap fix)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('paginates via .range() with advancing offsets, orders by id as a tiebreaker, and returns every row', async () => {
    const rangeCalls: Array<[number, number]> = [];
    const orderCalls: unknown[][] = [];

    // 1,039 rows across 2 pages (1,000 + 39), matching the prod repro shape.
    // Ordered DESC, so page 0 is the newest window and page 1 the oldest tail.
    const page0 = Array.from({ length: 1000 }, (_, i) =>
      toDbPunch(`p${i}`, 'emp-1', `2026-03-0${(i % 6) + 1}T10:00:00.000Z`, i % 2 === 0 ? 'clock_in' : 'clock_out'));
    const page1 = Array.from({ length: 39 }, (_, i) =>
      toDbPunch(`p${1000 + i}`, 'emp-1', `2026-02-27T10:00:00.000Z`, i % 2 === 0 ? 'clock_in' : 'clock_out'));
    const pages = [page0, page1];

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
      const page = pages[callIndex] ?? [];
      callIndex++;
      return Promise.resolve({ data: page, error: null });
    });

    const fromMock = vi.fn(() => timePunchesChain);

    vi.doMock('@/integrations/supabase/client', () => ({
      supabase: { from: (...args: [string]) => fromMock(...args) },
    }));

    const { useTimePunches } = await import('@/hooks/useTimePunches');

    const { result } = renderHook(
      () => useTimePunches('rest-1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    // Offsets advance across the 2 pages needed to cover all 1,039 rows —
    // proving the fetch is paginated, not a single unbounded `.select()`.
    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    // Deterministic page-boundary tiebreaker: `.order('punch_time', {desc})`
    // followed by `.order('id')`, repeated once per page (the `buildPage`
    // callback rebuilds the query chain on every page).
    expect(orderCalls).toEqual([
      ['punch_time', { ascending: false }],
      ['id'],
      ['punch_time', { ascending: false }],
      ['id'],
    ]);
    // Every row survives — including the oldest tail (page 1) that the
    // unpaginated fetch would have dropped past the 1,000-row cap.
    expect(result.current.punches).toHaveLength(1039);
    expect(result.current.punches.some((p) => p.id === 'p1038')).toBe(true);
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
        toDbPunch(`p${from + i}`, 'emp-1', '2026-03-02T10:00:00.000Z', i % 2 === 0 ? 'clock_in' : 'clock_out'));
      return Promise.resolve({ data: page, error: null });
    });

    const fromMock = vi.fn(() => timePunchesChain);

    vi.doMock('@/integrations/supabase/client', () => ({
      supabase: { from: (...args: [string]) => fromMock(...args) },
    }));

    const { useTimePunches } = await import('@/hooks/useTimePunches');

    const { result } = renderHook(
      () => useTimePunches('rest-1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Hitting the page cap is a safety signal, not a query error — the hook
    // must not surface it as `error`.
    expect(result.current.error).toBeNull();
    expect(rangeCalls.length).toBe(20); // DEFAULT_MAX_PAGES
    expect(warnSpy).toHaveBeenCalled();
  });
});
