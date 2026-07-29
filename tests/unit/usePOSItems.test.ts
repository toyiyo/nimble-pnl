import React, { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// --- Mock the Supabase client (hook calls supabase.rpc('search_pos_items', ...)) ---
const { mockSupabase } = vi.hoisted(() => ({
  mockSupabase: { rpc: vi.fn() },
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

import { usePOSItems, POSItem } from '@/hooks/usePOSItems';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function defer<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type RpcResponse = { data: POSItem[] | null; error: { message: string } | null };

/** The signal the hook last handed to PostgREST. */
let lastAbortSignal: AbortSignal | undefined;

/**
 * `supabase.rpc()` returns a PostgREST builder, not a promise: the hook chains
 * `.abortSignal(signal)` onto it and awaits that. Mocking a bare promise leaves
 * `.abortSignal` undefined, and the resulting TypeError is indistinguishable
 * from a real query failure to React Query -- which turns the "RPC failed" case
 * green for the wrong reason while every data assertion goes red. Mirror the
 * builder so the chain under test is the chain that ships.
 */
function rpcBuilder(promise: Promise<RpcResponse>) {
  return {
    abortSignal(signal: AbortSignal) {
      lastAbortSignal = signal;
      return promise;
    },
  };
}

const SAMPLE_ROWS: POSItem[] = [
  {
    item_name: 'House Burger',
    item_id: 'pos-item-1',
    source: 'pos_sales',
    sales_count: 92,
    last_sold: '2026-07-20',
  },
  {
    item_name: 'Garden Salad',
    item_id: 'pos-item-2',
    source: 'unified_sales',
    sales_count: 41,
    last_sold: '2026-07-18',
  },
];

describe('usePOSItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastAbortSignal = undefined;
  });

  it('calls search_pos_items with the restaurant id, search term, and limit', async () => {
    mockSupabase.rpc.mockReturnValue(rpcBuilder(Promise.resolve({ data: [], error: null })));

    renderHook(() => usePOSItems('rest-1', { search: 'burger', limit: 250 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(mockSupabase.rpc).toHaveBeenCalled());

    expect(mockSupabase.rpc).toHaveBeenCalledWith('search_pos_items', {
      p_restaurant_id: 'rest-1',
      p_search: 'burger',
      p_limit: 250,
    });
  });

  it('omits search/limit args when no opts are given, letting the RPC defaults apply', async () => {
    mockSupabase.rpc.mockReturnValue(rpcBuilder(Promise.resolve({ data: [], error: null })));

    renderHook(() => usePOSItems('rest-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(mockSupabase.rpc).toHaveBeenCalled());

    const [fnName, args] = mockSupabase.rpc.mock.calls[0];
    expect(fnName).toBe('search_pos_items');
    expect(args.p_restaurant_id).toBe('rest-1');
    // Server-side defaults (p_search DEFAULT NULL, p_limit DEFAULT 100) are
    // what should apply — the hook must not invent its own values here.
    expect(args.p_search).toBeUndefined();
    expect(args.p_limit).toBeUndefined();
  });

  it('maps the RPC row shape onto POSItem unchanged', async () => {
    mockSupabase.rpc.mockReturnValue(rpcBuilder(Promise.resolve({ data: SAMPLE_ROWS, error: null })));

    const { result } = renderHook(() => usePOSItems('rest-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.posItems).toEqual(SAMPLE_ROWS);
  });

  it('does not call the RPC and reports loading=false while restaurantId is null (disabled-query trap)', async () => {
    renderHook(() => usePOSItems(null), { wrapper: createWrapper() });

    // A disabled React Query query never sets isFetching, so isLoading is
    // false despite nothing ever having resolved — the hook's exported
    // `loading` must reflect that correctly rather than reading `isLoading`
    // as "still loading" (see 2026-07-27 lesson).
    await waitFor(() => {
      expect(mockSupabase.rpc).not.toHaveBeenCalled();
    });

    const { result } = renderHook(() => usePOSItems(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.posItems).toEqual([]);
  });

  it('reports loading=true while the RPC call is in flight', async () => {
    const gate = defer<{ data: POSItem[]; error: null }>();
    mockSupabase.rpc.mockReturnValue(rpcBuilder(gate.promise));

    const { result } = renderHook(() => usePOSItems('rest-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.posItems).toEqual([]);

    gate.resolve({ data: SAMPLE_ROWS, error: null });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.posItems).toEqual(SAMPLE_ROWS);
  });

  it('populates error and keeps posItems=[] when the RPC call fails', async () => {
    mockSupabase.rpc.mockReturnValue(
      rpcBuilder(Promise.resolve({ data: null, error: { message: 'connection reset' } })),
    );

    const { result } = renderHook(() => usePOSItems('rest-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.error).toBeTruthy());

    expect(result.current.posItems).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("hands React Query's abort signal to PostgREST so superseded searches are cancelled", async () => {
    // Held open deliberately: a query that has already settled has nothing
    // left to cancel, so the signal must be inspected mid-flight.
    const gate = defer<RpcResponse>();
    mockSupabase.rpc.mockReturnValue(rpcBuilder(gate.promise));

    const { unmount } = renderHook(() => usePOSItems('rest-1', { search: 'burger' }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(lastAbortSignal).toBeInstanceOf(AbortSignal));
    expect(lastAbortSignal!.aborted).toBe(false);

    // Typing is debounced, so a superseded keystroke must take its in-flight
    // RPC down with it rather than leaving the server computing a result
    // nobody will read.
    unmount();
    await waitFor(() => expect(lastAbortSignal!.aborted).toBe(true));
  });
});
