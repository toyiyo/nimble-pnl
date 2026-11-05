import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const calls: { method: string; args: unknown[] }[] = [];
let pages: Array<{ data: unknown[] | null; error: unknown }> = [];
let pageIndex = 0;
let rpcResult: { data: unknown; error: unknown } = { data: [], error: null };
const rpcMock = vi.fn();

function makeChain() {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'order']) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  chain.range = (...args: unknown[]) => {
    calls.push({ method: 'range', args });
    const page = pages[pageIndex] ?? { data: [], error: null };
    pageIndex += 1;
    return Promise.resolve(page);
  };
  return chain;
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => makeChain()),
    rpc: (...args: unknown[]) => {
      rpcMock(...args);
      return Promise.resolve(rpcResult);
    },
  },
}));

import { useShiftTradeHistory } from '@/hooks/useShiftTradeHistory';

const wrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
};

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  status: 'approved',
  offered_shift_id: `s-${id}`,
  offered_by_employee_id: 'e1',
  accepted_by_employee_id: 'e2',
  target_employee_id: null,
  reviewed_by: 'u1',
  reviewed_at: '2026-01-01T00:00:00Z',
  manager_note: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  offered_shift: { id: `s-${id}` },
  offered_by: { id: 'e1', name: 'Ann' },
  accepted_by: { id: 'e2', name: 'Bob' },
  target_employee: null,
  ...over,
});

const manyRows = (n: number, start = 0) =>
  Array.from({ length: n }, (_, i) => row(`t${start + i}`));

beforeEach(() => {
  calls.length = 0;
  pages = [];
  pageIndex = 0;
  rpcResult = { data: [], error: null };
  rpcMock.mockClear();
});

describe('useShiftTradeHistory', () => {
  it('filters by restaurant and status, orders, and pages with range', async () => {
    pages = [{ data: [row('a')], error: null }];
    const { result } = renderHook(() => useShiftTradeHistory('r1', 'approved'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(calls).toContainEqual({ method: 'eq', args: ['restaurant_id', 'r1'] });
    expect(calls).toContainEqual({ method: 'eq', args: ['status', 'approved'] });
    expect(calls).toContainEqual({ method: 'order', args: ['updated_at', { ascending: false }] });
    expect(calls).toContainEqual({ method: 'order', args: ['id', { ascending: false }] });
    expect(calls).toContainEqual({ method: 'range', args: [0, 24] });
  });

  it('uses the three closed statuses for the all filter', async () => {
    pages = [{ data: [], error: null }];
    const { result } = renderHook(() => useShiftTradeHistory('r1', 'all'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(calls.some((c) => c.method === 'eq' && c.args[0] === 'status')).toBe(false);
    expect(calls).toContainEqual({
      method: 'in',
      args: ['status', ['approved', 'rejected', 'cancelled']],
    });
  });

  it('fetches the next page when the raw count is 25', async () => {
    pages = [
      { data: manyRows(25), error: null },
      { data: [row('last')], error: null },
    ];
    const { result } = renderHook(() => useShiftTradeHistory('r1', 'approved'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.trades).toHaveLength(25));
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.trades).toHaveLength(26));
    expect(calls).toContainEqual({ method: 'range', args: [25, 49] });
    expect(result.current.hasNextPage).toBe(false);
  });

  it('uses the raw count before the join filter to decide the next page', async () => {
    const page = manyRows(25).map((r, i) => (i === 0 ? { ...r, offered_by: null } : r));
    pages = [{ data: page, error: null }];
    const { result } = renderHook(() => useShiftTradeHistory('r1', 'approved'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.trades).toHaveLength(24));
    expect(result.current.hasNextPage).toBe(true);
  });

  it('adds the reviewer full name, then email, then former team member', async () => {
    pages = [
      {
        data: [
          row('a', { reviewed_by: 'u1' }),
          row('b', { reviewed_by: 'u2' }),
          row('c', { reviewed_by: 'u3' }),
          row('d', { reviewed_by: null, status: 'cancelled' }),
        ],
        error: null,
      },
    ];
    rpcResult = {
      data: [
        { id: 'u1', full_name: 'Mary Manager', email: 'm@x.com' },
        { id: 'u2', full_name: null, email: 'only@x.com' },
      ],
      error: null,
    };
    const { result } = renderHook(() => useShiftTradeHistory('r1', 'all'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.trades).toHaveLength(4));
    const names = Object.fromEntries(result.current.trades.map((t) => [t.id, t.reviewer_name]));
    expect(names).toEqual({
      a: 'Mary Manager',
      b: 'only@x.com',
      c: 'a former team member',
      d: null,
    });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('get_users_by_ids', { user_ids: ['u1', 'u2', 'u3'] });
  });

  it('keeps the list and sets a null name when the RPC fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    pages = [{ data: [row('a')], error: null }];
    rpcResult = { data: null, error: { message: 'boom' } };
    const { result } = renderHook(() => useShiftTradeHistory('r1', 'approved'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.trades).toHaveLength(1));
    expect(result.current.trades[0].reviewer_name).toBeNull();
    expect(result.current.error).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('skips the RPC when no row has a reviewer', async () => {
    pages = [{ data: [row('a', { reviewed_by: null })], error: null }];
    const { result } = renderHook(() => useShiftTradeHistory('r1', 'approved'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.trades).toHaveLength(1));
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('treats null RPC data as an empty list', async () => {
    pages = [{ data: [row('a')], error: null }];
    rpcResult = { data: null, error: null };
    const { result } = renderHook(() => useShiftTradeHistory('r1', 'approved'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.trades).toHaveLength(1));
    expect(result.current.trades[0].reviewer_name).toBe('a former team member');
  });

  it('removes duplicate ids across pages', async () => {
    const first = manyRows(25);
    pages = [
      { data: first, error: null },
      { data: [first[24], row('new')], error: null },
    ];
    const { result } = renderHook(() => useShiftTradeHistory('r1', 'approved'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.trades).toHaveLength(25));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.trades).toHaveLength(26));
    const ids = result.current.trades.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not query when the restaurant id is null', async () => {
    const { result } = renderHook(() => useShiftTradeHistory(null, 'all'), {
      wrapper: wrapper(),
    });
    expect(result.current.trades).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('surfaces a query error', async () => {
    pages = [{ data: null, error: { message: 'bad' } }];
    const { result } = renderHook(() => useShiftTradeHistory('r1', 'approved'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());
  });
});
