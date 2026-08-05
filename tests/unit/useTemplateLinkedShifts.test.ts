import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';

import { useTemplateLinkedShifts } from '@/hooks/useTemplateLinkedShifts';
import { supabase } from '@/integrations/supabase/client';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Chainable mock query builder
// ---------------------------------------------------------------------------

interface RecordedCall {
  method: string;
  args: unknown[];
}

interface MockBuilder {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  lt: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
  then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise<unknown>;
  calls: RecordedCall[];
}

/**
 * A chainable, thenable mock matching the shape of a real supabase query
 * builder: every filter method (`eq`/`lt`/`gte`/`order`) returns the same
 * builder, records its call, and the whole thing resolves to `result` when
 * awaited — no explicit terminal method required, matching how the hook
 * awaits the chain directly after `.order(...)` or `.lt(...)`.
 */
function makeChainableBuilder(result: { data: unknown; error: Error | null; count?: number | null }): MockBuilder {
  const calls: RecordedCall[] = [];
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
    return builder;
  };
  const builder: MockBuilder = {
    select: vi.fn(record('select')),
    eq: vi.fn(record('eq')),
    lt: vi.fn(record('lt')),
    gte: vi.fn(record('gte')),
    order: vi.fn(record('order')),
    range: vi.fn(record('range')),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    calls,
  };
  return builder;
}

function findCall(calls: RecordedCall[], method: string): RecordedCall | undefined {
  return calls.find((c) => c.method === method);
}

describe('useTemplateLinkedShifts', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  );

  it('returns pastCount from the count query and shifts from the row query', async () => {
    const countBuilder = makeChainableBuilder({ data: null, error: null, count: 7 });
    const rowsBuilder = makeChainableBuilder({
      data: [
        {
          id: 's1',
          start_time: '2026-08-05T10:00:00Z',
          end_time: '2026-08-05T18:00:00Z',
          is_published: true,
          locked: false,
          employee_id: 'e1',
          employee: { name: 'Alex' },
        },
      ],
      error: null,
    });

    vi.mocked(supabase.from)
      .mockReturnValueOnce(countBuilder as any)
      .mockReturnValueOnce(rowsBuilder as any);

    const { result } = renderHook(
      () => useTemplateLinkedShifts('r1', 't1'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.pastCount).toBe(7);
    expect(result.current.shifts).toEqual([
      {
        id: 's1',
        start_time: '2026-08-05T10:00:00Z',
        end_time: '2026-08-05T18:00:00Z',
        is_published: true,
        locked: false,
        employee_id: 'e1',
        employeeName: 'Alex',
      },
    ]);
  });

  it('filters the count query strictly before the cutoff and the row query at-or-after the same cutoff', async () => {
    const countBuilder = makeChainableBuilder({ data: null, error: null, count: 0 });
    const rowsBuilder = makeChainableBuilder({ data: [], error: null });

    vi.mocked(supabase.from)
      .mockReturnValueOnce(countBuilder as any)
      .mockReturnValueOnce(rowsBuilder as any);

    const { result } = renderHook(
      () => useTemplateLinkedShifts('r1', 't1'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const ltCall = findCall(countBuilder.calls, 'lt');
    const gteCall = findCall(rowsBuilder.calls, 'gte');

    expect(ltCall).toBeDefined();
    expect(gteCall).toBeDefined();
    expect(ltCall!.args[0]).toBe('start_time');
    expect(gteCall!.args[0]).toBe('start_time');

    // The disjointness guarantee: both queries are filtered on the exact
    // same cutoff instant, so no shift is dropped or double-counted between
    // the "before" (count) and "at or after" (rows) sets.
    expect(ltCall!.args[1]).toBe(gteCall!.args[1]);

    // Row query keeps its ordering.
    expect(findCall(rowsBuilder.calls, 'order')).toBeDefined();

    // Count query never fetches rows — head: true, count: 'exact'.
    const countSelectCall = findCall(countBuilder.calls, 'select');
    expect(countSelectCall!.args[1]).toEqual({ count: 'exact', head: true });
  });

  it('stays disabled and does not query supabase when restaurantId is null', async () => {
    const { result } = renderHook(
      () => useTemplateLinkedShifts(null, 't1'),
      { wrapper },
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.shifts).toEqual([]);
    expect(result.current.pastCount).toBe(0);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('stays disabled and does not query supabase when templateId is null', async () => {
    const { result } = renderHook(
      () => useTemplateLinkedShifts('r1', null),
      { wrapper },
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.shifts).toEqual([]);
    expect(result.current.pastCount).toBe(0);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('stays disabled while the dialog is closed', async () => {
    const { result } = renderHook(
      () => useTemplateLinkedShifts('r1', 't1', false),
      { wrapper },
    );

    expect(result.current.isLoading).toBe(false);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('refetches when the dialog reopens, without ever unmounting', async () => {
    // The regression this guards: the planner mounts TemplateFormDialog once
    // and only flips `open`, so refetchOnMount fires a single time per page
    // load. Shifts linked to the template while the dialog was shut have to
    // show up on the next open, or the ledger understates what will move.
    vi.mocked(supabase.from).mockImplementation(
      () => makeChainableBuilder({ data: [], error: null, count: 0 }) as any,
    );

    const { result, rerender } = renderHook(
      ({ isOpen }: { isOpen: boolean }) => useTemplateLinkedShifts('r1', 't1', isOpen),
      { wrapper, initialProps: { isOpen: true } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const afterFirstOpen = vi.mocked(supabase.from).mock.calls.length;
    expect(afterFirstOpen).toBeGreaterThan(0);

    rerender({ isOpen: false });
    expect(vi.mocked(supabase.from).mock.calls.length).toBe(afterFirstOpen);

    rerender({ isOpen: true });
    await waitFor(() =>
      expect(vi.mocked(supabase.from).mock.calls.length).toBeGreaterThan(afterFirstOpen),
    );
  });

  it('pages through future linked shifts until a short page proves the set is exhausted', async () => {
    const makeRow = (i: number) => ({
      id: `s${i}`,
      start_time: '2026-08-05T10:00:00Z',
      end_time: '2026-08-05T18:00:00Z',
      is_published: false,
      locked: false,
      employee_id: 'e1',
      employee: { name: 'Alex' },
    });

    const countBuilder = makeChainableBuilder({ data: null, error: null, count: 0 });
    // A full page means "there may be more"; the short page that follows is
    // the only thing that ends the loop.
    const page1 = makeChainableBuilder({
      data: Array.from({ length: 1000 }, (_, i) => makeRow(i)),
      error: null,
    });
    const page2 = makeChainableBuilder({
      data: [makeRow(1000), makeRow(1001)],
      error: null,
    });

    vi.mocked(supabase.from)
      .mockReturnValueOnce(countBuilder as any)
      .mockReturnValueOnce(page1 as any)
      .mockReturnValueOnce(page2 as any);

    const { result } = renderHook(
      () => useTemplateLinkedShifts('r1', 't1'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.shifts.length).toBe(1002));

    expect(findCall(page1.calls, 'range')!.args).toEqual([0, 999]);
    expect(findCall(page2.calls, 'range')!.args).toEqual([1000, 1999]);
    expect(result.current.shifts.at(-1)!.id).toBe('s1001');
  });

  it('stops after a single page when it comes back short', async () => {
    const countBuilder = makeChainableBuilder({ data: null, error: null, count: 0 });
    const page1 = makeChainableBuilder({ data: [], error: null });

    vi.mocked(supabase.from)
      .mockReturnValueOnce(countBuilder as any)
      .mockReturnValueOnce(page1 as any);

    const { result } = renderHook(
      () => useTemplateLinkedShifts('r1', 't1'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Two `from` calls total: the count query and exactly one row page.
    expect(vi.mocked(supabase.from)).toHaveBeenCalledTimes(2);
  });
});
