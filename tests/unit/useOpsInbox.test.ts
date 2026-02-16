import React, { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useOpsInbox, useOpsInboxCount } from '@/hooks/useOpsInbox';

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

const mockItems = [
  {
    id: 'item-1',
    restaurant_id: 'rest-123',
    title: 'Uncategorized transaction',
    description: 'Transaction from SYSCO needs categorization',
    kind: 'uncategorized_txn',
    priority: 1,
    status: 'open',
    snoozed_until: null,
    due_at: null,
    linked_entity_type: 'bank_transactions',
    linked_entity_id: 'txn-1',
    evidence_json: [],
    meta: {},
    created_by: 'system',
    created_at: '2026-02-14T10:00:00Z',
    resolved_at: null,
    resolved_by: null,
  },
  {
    id: 'item-2',
    restaurant_id: 'rest-123',
    title: 'Food cost anomaly',
    description: 'Food cost spiked to 35%',
    kind: 'anomaly',
    priority: 2,
    status: 'open',
    snoozed_until: null,
    due_at: null,
    linked_entity_type: null,
    linked_entity_id: null,
    evidence_json: [],
    meta: {},
    created_by: 'system',
    created_at: '2026-02-14T09:00:00Z',
    resolved_at: null,
    resolved_by: null,
  },
];

// Build a chainable + thenable mock for list queries.
// Supabase query builders are thenable (have .then()) so `await q` works,
// but you can also keep calling .eq() / .order() etc. before awaiting.
function buildListChain(resolvedValue: { data: unknown; error: unknown; count?: number | null }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  // Make chain thenable so `await chain` resolves to resolvedValue
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable to simulate Supabase query builder
  chain.then = vi.fn().mockImplementation((resolve: (v: unknown) => unknown) => {
    return Promise.resolve(resolvedValue).then(resolve);
  });
  return chain;
}

describe('useOpsInbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when restaurantId is undefined', async () => {
    const { result } = renderHook(() => useOpsInbox(undefined), { wrapper: createWrapper() });
    expect(result.current.items).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('fetches open items by default', async () => {
    const chain = buildListChain({ data: mockItems, error: null });
    mockSupabase.from.mockReturnValue(chain);

    const { result } = renderHook(() => useOpsInbox('rest-123'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items).toEqual(mockItems);
    expect(mockSupabase.from).toHaveBeenCalledWith('ops_inbox_item');
    expect(chain.eq).toHaveBeenCalledWith('restaurant_id', 'rest-123');
    expect(chain.eq).toHaveBeenCalledWith('status', 'open');
    expect(chain.order).toHaveBeenCalledWith('priority', { ascending: true });
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('skips status filter when status is "all"', async () => {
    const chain = buildListChain({ data: mockItems, error: null });
    mockSupabase.from.mockReturnValue(chain);

    const { result } = renderHook(
      () => useOpsInbox('rest-123', { status: 'all' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // eq should be called for restaurant_id but NOT for status
    const eqCalls = chain.eq.mock.calls;
    expect(eqCalls).toContainEqual(['restaurant_id', 'rest-123']);
    expect(eqCalls.find(([col]: [string]) => col === 'status')).toBeUndefined();
  });

  it('filters by kind when provided', async () => {
    const chain = buildListChain({ data: [mockItems[0]], error: null });
    mockSupabase.from.mockReturnValue(chain);

    const { result } = renderHook(
      () => useOpsInbox('rest-123', { kind: 'uncategorized_txn' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(chain.eq).toHaveBeenCalledWith('kind', 'uncategorized_txn');
  });

  it('filters by priority when provided', async () => {
    const chain = buildListChain({ data: [mockItems[0]], error: null });
    mockSupabase.from.mockReturnValue(chain);

    const { result } = renderHook(
      () => useOpsInbox('rest-123', { priority: 1 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(chain.eq).toHaveBeenCalledWith('priority', 1);
  });

  it('respects custom limit', async () => {
    const chain = buildListChain({ data: [], error: null });
    mockSupabase.from.mockReturnValue(chain);

    const { result } = renderHook(
      () => useOpsInbox('rest-123', { limit: 50 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(chain.limit).toHaveBeenCalledWith(50);
  });

  it('returns error on Supabase failure', async () => {
    const chain = buildListChain({ data: null, error: { message: 'Query failed' } });
    mockSupabase.from.mockReturnValue(chain);

    const { result } = renderHook(() => useOpsInbox('rest-123'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error).toEqual({ message: 'Query failed' });
  });

  it('updateStatus sets snoozed_until when snoozing', async () => {
    // Query chain for initial fetch
    const queryChain = buildListChain({ data: mockItems, error: null });
    // Update chain for mutation
    const updateChain: Record<string, ReturnType<typeof vi.fn>> = {};
    updateChain.update = vi.fn().mockReturnValue(updateChain);
    updateChain.eq = vi.fn().mockResolvedValue({ error: null });

    let callCount = 0;
    mockSupabase.from.mockImplementation(() => {
      callCount++;
      // First call is for the query, subsequent calls for mutation
      if (callCount === 1) return queryChain;
      return updateChain;
    });

    const { result } = renderHook(() => useOpsInbox('rest-123'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.updateStatus({
        itemId: 'item-1',
        newStatus: 'snoozed',
        snoozedUntil: '2026-02-16T06:00:00Z',
      });
    });

    await waitFor(() => expect(result.current.isUpdating).toBe(false));
    expect(updateChain.update).toHaveBeenCalledWith({
      status: 'snoozed',
      snoozed_until: '2026-02-16T06:00:00Z',
    });
  });

  it('updateStatus sets resolved_at when dismissing', async () => {
    const queryChain = buildListChain({ data: mockItems, error: null });
    const updateChain: Record<string, ReturnType<typeof vi.fn>> = {};
    updateChain.update = vi.fn().mockReturnValue(updateChain);
    updateChain.eq = vi.fn().mockResolvedValue({ error: null });

    let callCount = 0;
    mockSupabase.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return queryChain;
      return updateChain;
    });

    const { result } = renderHook(() => useOpsInbox('rest-123'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.updateStatus({ itemId: 'item-1', newStatus: 'dismissed' });
    });

    await waitFor(() => expect(result.current.isUpdating).toBe(false));
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'dismissed',
        resolved_at: expect.any(String),
      }),
    );
  });

  it('updateStatus sets resolved_at when marking done', async () => {
    const queryChain = buildListChain({ data: mockItems, error: null });
    const updateChain: Record<string, ReturnType<typeof vi.fn>> = {};
    updateChain.update = vi.fn().mockReturnValue(updateChain);
    updateChain.eq = vi.fn().mockResolvedValue({ error: null });

    let callCount = 0;
    mockSupabase.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return queryChain;
      return updateChain;
    });

    const { result } = renderHook(() => useOpsInbox('rest-123'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.updateStatus({ itemId: 'item-2', newStatus: 'done' });
    });

    await waitFor(() => expect(result.current.isUpdating).toBe(false));
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'done',
        resolved_at: expect.any(String),
      }),
    );
  });
});

describe('useOpsInboxCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns zeros when restaurantId is undefined', async () => {
    const { result } = renderHook(() => useOpsInboxCount(undefined), { wrapper: createWrapper() });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('fetches open and critical counts', async () => {
    let callNum = 0;

    mockSupabase.from.mockImplementation(() => {
      callNum++;
      // Build chain where each .eq returns the chain, and the final state resolves
      const state = { eqCount: 0 };
      const chain: Record<string, unknown> = {};

      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockImplementation(() => {
        state.eqCount++;
        // For open count query: 2 eq calls (restaurant_id + status)
        // For critical count query: 3 eq calls (restaurant_id + status + priority)
        if (callNum === 1 && state.eqCount >= 2) {
          return Promise.resolve({ count: 5, error: null });
        }
        if (callNum === 2 && state.eqCount >= 3) {
          return Promise.resolve({ count: 2, error: null });
        }
        return chain;
      });

      return chain;
    });

    const { result } = renderHook(() => useOpsInboxCount('rest-123'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ open: 5, critical: 2 });
  });

  it('returns zeros when counts are null', async () => {
    let callNum = 0;
    mockSupabase.from.mockImplementation(() => {
      callNum++;
      const state = { eqCount: 0 };
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockImplementation(() => {
        state.eqCount++;
        if (callNum === 1 && state.eqCount >= 2) {
          return Promise.resolve({ count: null, error: null });
        }
        if (callNum === 2 && state.eqCount >= 3) {
          return Promise.resolve({ count: null, error: null });
        }
        return chain;
      });
      return chain;
    });

    const { result } = renderHook(() => useOpsInboxCount('rest-123'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ open: 0, critical: 0 });
  });

  it('throws when Supabase returns an error', async () => {
    let callNum = 0;
    mockSupabase.from.mockImplementation(() => {
      callNum++;
      const state = { eqCount: 0 };
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockImplementation(() => {
        state.eqCount++;
        if (callNum === 1 && state.eqCount >= 2) {
          return Promise.resolve({ count: null, error: { message: 'Access denied' } });
        }
        return chain;
      });
      return chain;
    });

    const { result } = renderHook(() => useOpsInboxCount('rest-123'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual({ message: 'Access denied' });
  });
});
