/**
 * Unit Tests: recurring-shift creation anchors every child on the
 * restaurant's wall clock (Task 6, surface 4).
 *
 * `createRecurringShifts` (useShifts.tsx) built every occurrence after the
 * first with host-local `Date.setHours`/getters: it read the parent's local
 * hour/minute/second on the *host* machine, then wrote them onto the next
 * calendar day, also computed host-locally. That is invisible whenever both
 * the host and the restaurant hold a constant UTC offset across the whole
 * recurrence window — "add N days at a fixed host-local hour" and "add N
 * days at a fixed restaurant-local hour" land on the identical instant in
 * that case, coincidentally. It only diverges when the *restaurant* crosses
 * a DST transition inside the recurrence while the host does not (or vice
 * versa) — the same technique the Task 8 drag-copy spec uses. So this test
 * pins the host to America/Phoenix (fixed UTC-7, never observes DST) and
 * recurs a daily 09:00 America/Chicago shift across Chicago's 2026-03-08
 * spring-forward: the correct wall clock (09:00 Chicago) stays fixed across
 * the transition, but a host-local round trip carries the *pre-transition*
 * UTC offset forward and drifts by 60 minutes on the post-transition day.
 */
import React, { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCreateShift } from '@/hooks/useShifts';

const mockToast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return Wrapper;
};

/** Mimics supabase-js's thenable `insert()` result, chained by `.select().single()` for the
 * parent insert and awaited bare for the children insert (array payload). */
function makeInsertResult(resolvedValue: unknown) {
  return {
    select: () => ({ single: () => Promise.resolve(resolvedValue) }),
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(resolvedValue).then(resolve, reject),
  };
}

function setupSupabaseMock(insertCalls: unknown[]) {
  mockSupabase.from.mockImplementation(() => ({
    insert: (payload: unknown) => {
      insertCalls.push(payload);
      if (Array.isArray(payload)) {
        return makeInsertResult({ error: null });
      }
      return makeInsertResult({
        data: { id: 'parent-1', ...(payload as object), recurrence_parent_id: null },
        error: null,
      });
    },
  }));
}

describe('useCreateShift — recurring children anchor to the restaurant timezone', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('a daily 09:00 Chicago recurrence stays at 09:00 Chicago across the 2026-03-08 spring-forward, from a Phoenix (no-DST) host', async () => {
    process.env.TZ = 'America/Phoenix';

    const insertCalls: unknown[] = [];
    setupSupabaseMock(insertCalls);

    const { result } = renderHook(() => useCreateShift({ tz: 'America/Chicago' }), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        restaurant_id: 'rest-1',
        employee_id: 'emp-1',
        // 09:00 America/Chicago on 2026-03-07 is still CST (UTC-6) — the
        // transition to CDT happens 2026-03-08 02:00 local.
        start_time: '2026-03-07T15:00:00.000Z',
        end_time: '2026-03-07T21:00:00.000Z',
        break_duration: 30,
        position: 'Server',
        status: 'scheduled',
        notes: null,
        is_recurring: true,
        is_published: false,
        locked: false,
        recurrence_pattern: {
          type: 'daily',
          interval: 1,
          endType: 'after',
          occurrences: 3,
        },
        recurrence_parent_id: null,
      } as never);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const childInsertCall = insertCalls.find((c) => Array.isArray(c)) as
      | Array<{ start_time: string; end_time: string }>
      | undefined;
    expect(childInsertCall, 'expected a children insert() call').toBeTruthy();
    expect(childInsertCall).toHaveLength(2);

    // 09:00 Chicago is CDT (UTC-5) on both 03-08 and 03-09 — the transition
    // already happened at 02:00 local on 03-08, before the 09:00 shift starts.
    const expectedStarts = ['2026-03-08T14:00:00.000Z', '2026-03-09T14:00:00.000Z'];
    const expectedEnds = ['2026-03-08T20:00:00.000Z', '2026-03-09T20:00:00.000Z'];
    childInsertCall!.forEach((child, i) => {
      expect(new Date(child.start_time).toISOString(), `child ${i} start_time`).toBe(expectedStarts[i]);
      expect(new Date(child.end_time).toISOString(), `child ${i} end_time`).toBe(expectedEnds[i]);
    });
  });

  it('throws INVALID_DATE synchronously up front when tz is missing for a recurring create', async () => {
    const insertCalls: unknown[] = [];
    setupSupabaseMock(insertCalls);

    const { result } = renderHook(() => useCreateShift(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({
        restaurant_id: 'rest-1',
        employee_id: 'emp-1',
        start_time: '2026-08-12T11:30:00.000Z',
        end_time: '2026-08-12T17:30:00.000Z',
        break_duration: 30,
        position: 'Server',
        status: 'scheduled',
        notes: null,
        is_recurring: true,
        is_published: false,
        locked: false,
        recurrence_pattern: { type: 'daily', interval: 1, endType: 'after', occurrences: 3 },
        recurrence_parent_id: null,
      } as never);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error)?.message).toBe('INVALID_DATE');
    // No child rows should have been written when the create was rejected up front.
    expect(insertCalls.some((c) => Array.isArray(c))).toBe(false);
  });
});
