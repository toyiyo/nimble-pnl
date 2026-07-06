/**
 * Unit Tests: Single-shift mutation hooks — explicit restaurant_id filter
 *
 * Pins that useUpdateShift/useDeleteShift apply an explicit
 * `.eq('restaurant_id', restaurantId)` filter on their mutation query
 * (defense-in-depth per lesson 2026-07-02), matching the series-mutation
 * pattern (useUpdateShiftSeries/useDeleteShiftSeries already do this).
 */
import React, { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUpdateShift, useDeleteShift } from '@/hooks/useShifts';

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
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const Wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  return Wrapper;
};

describe('useUpdateShift — explicit restaurant_id filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupUpdateChain(updateResult: { data: Record<string, unknown> | null; error: { message: string } | null }) {
    // assertShiftNotLocked: select().eq('id', id).single()
    const lockCheckSingle = vi.fn().mockResolvedValue({ data: { locked: false }, error: null });
    const lockCheckEq = vi.fn().mockReturnValue({ single: lockCheckSingle });
    const lockCheckSelect = vi.fn().mockReturnValue({ eq: lockCheckEq });

    // update(...).eq('id', id).eq('restaurant_id', restaurantId).select().single()
    const updateSingle = vi.fn().mockResolvedValue(updateResult);
    const updateSelect = vi.fn().mockReturnValue({ single: updateSingle });
    const updateEqRestaurant = vi.fn().mockReturnValue({ select: updateSelect });
    const updateEqId = vi.fn().mockReturnValue({ eq: updateEqRestaurant });
    const update = vi.fn().mockReturnValue({ eq: updateEqId });

    mockSupabase.from.mockReturnValue({
      select: lockCheckSelect,
      update,
    });

    return { updateEqId, updateEqRestaurant, update };
  }

  it('applies .eq(restaurant_id) after .eq(id) when updating a shift', async () => {
    const updatedShift = {
      id: 'shift-1',
      restaurant_id: 'rest-123',
      employee_id: 'emp-1',
      start_time: '2026-01-10T09:00:00Z',
      end_time: '2026-01-10T17:00:00Z',
    };

    const { updateEqId, updateEqRestaurant } = setupUpdateChain({
      data: updatedShift,
      error: null,
    });

    const { result } = renderHook(() => useUpdateShift(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({
        id: 'shift-1',
        restaurant_id: 'rest-123',
        status: 'confirmed' as const,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(updateEqId).toHaveBeenCalledWith('id', 'shift-1');
    expect(updateEqRestaurant).toHaveBeenCalledWith('restaurant_id', 'rest-123');
  });

  it('surfaces the Supabase error when the update fails', async () => {
    setupUpdateChain({ data: null, error: { message: 'permission denied' } });

    const { result } = renderHook(() => useUpdateShift(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({
        id: 'shift-1',
        restaurant_id: 'rest-123',
        status: 'confirmed' as const,
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useUpdateShift — optimistic cache update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupDeferredUpdateChain() {
    // assertShiftNotLocked: select().eq('id', id).single()
    const lockCheckSingle = vi.fn().mockResolvedValue({ data: { locked: false }, error: null });
    const lockCheckEq = vi.fn().mockReturnValue({ single: lockCheckSingle });
    const lockCheckSelect = vi.fn().mockReturnValue({ eq: lockCheckEq });

    // The actual DB update only resolves once the test calls `resolveUpdate`,
    // so the test can assert on the cache DURING the in-flight mutation (i.e.
    // the optimistic patch applied by onMutate, before onSuccess/onSettled).
    let resolveUpdate!: (value: { data: Record<string, unknown>; error: null }) => void;
    const updatePromise = new Promise<{ data: Record<string, unknown>; error: null }>((resolve) => {
      resolveUpdate = resolve;
    });
    const updateSingle = vi.fn().mockReturnValue(updatePromise);
    const updateSelect = vi.fn().mockReturnValue({ single: updateSingle });
    const updateEqRestaurant = vi.fn().mockReturnValue({ select: updateSelect });
    const updateEqId = vi.fn().mockReturnValue({ eq: updateEqRestaurant });
    const update = vi.fn().mockReturnValue({ eq: updateEqId });

    mockSupabase.from.mockReturnValue({
      select: lockCheckSelect,
      update,
    });

    return { resolveUpdate };
  }

  function seedShiftsCache(queryClient: QueryClient, restaurantId: string, shifts: Record<string, unknown>[]) {
    queryClient.setQueryData(['shifts', restaurantId, undefined, undefined], shifts);
  }

  it('patches the matching shift in the cache synchronously on mutate (before the mutation resolves)', async () => {
    const { resolveUpdate } = setupDeferredUpdateChain();

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const Wrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const original = {
      id: 'shift-1',
      restaurant_id: 'rest-123',
      employee_id: 'emp-1',
      start_time: '2026-01-10T09:00:00Z',
      end_time: '2026-01-10T17:00:00Z',
      status: 'scheduled',
    };
    seedShiftsCache(queryClient, 'rest-123', [original]);

    const { result } = renderHook(() => useUpdateShift(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({
        id: 'shift-1',
        restaurant_id: 'rest-123',
        start_time: '2026-01-10T10:00:00Z',
        end_time: '2026-01-10T18:00:00Z',
      });
    });

    // While the mutation is still in flight (update() hasn't resolved yet),
    // the cache should already reflect the optimistic patch.
    await waitFor(() => {
      const cached = queryClient.getQueryData<Record<string, unknown>[]>(['shifts', 'rest-123', undefined, undefined]);
      expect(cached?.[0]).toMatchObject({
        id: 'shift-1',
        start_time: '2026-01-10T10:00:00Z',
        end_time: '2026-01-10T18:00:00Z',
      });
    });

    // Resolve the underlying update so the mutation settles cleanly.
    resolveUpdate({
      data: { ...original, start_time: '2026-01-10T10:00:00Z', end_time: '2026-01-10T18:00:00Z' },
      error: null,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('rolls back the cache to the previous snapshot when the update errors', async () => {
    const lockCheckSingle = vi.fn().mockResolvedValue({ data: { locked: false }, error: null });
    const lockCheckEq = vi.fn().mockReturnValue({ single: lockCheckSingle });
    const lockCheckSelect = vi.fn().mockReturnValue({ eq: lockCheckEq });

    const updateSingle = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    const updateSelect = vi.fn().mockReturnValue({ single: updateSingle });
    const updateEqRestaurant = vi.fn().mockReturnValue({ select: updateSelect });
    const updateEqId = vi.fn().mockReturnValue({ eq: updateEqRestaurant });
    const update = vi.fn().mockReturnValue({ eq: updateEqId });

    mockSupabase.from.mockReturnValue({ select: lockCheckSelect, update });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const Wrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const original = {
      id: 'shift-1',
      restaurant_id: 'rest-123',
      employee_id: 'emp-1',
      start_time: '2026-01-10T09:00:00Z',
      end_time: '2026-01-10T17:00:00Z',
      status: 'scheduled',
    };
    seedShiftsCache(queryClient, 'rest-123', [original]);

    const { result } = renderHook(() => useUpdateShift(), { wrapper: Wrapper });

    await act(async () => {
      result.current.mutate({
        id: 'shift-1',
        restaurant_id: 'rest-123',
        start_time: '2026-01-10T10:00:00Z',
        end_time: '2026-01-10T18:00:00Z',
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const cached = queryClient.getQueryData<Record<string, unknown>[]>(['shifts', 'rest-123', undefined, undefined]);
    expect(cached).toEqual([original]);
  });
});

describe('useDeleteShift — explicit restaurant_id filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupDeleteChain(deleteResult: { error: { message: string } | null }) {
    const deleteEqRestaurant = vi.fn().mockResolvedValue(deleteResult);
    const deleteEqId = vi.fn().mockReturnValue({ eq: deleteEqRestaurant });
    const del = vi.fn().mockReturnValue({ eq: deleteEqId });

    mockSupabase.from.mockReturnValue({ delete: del });

    return { deleteEqId, deleteEqRestaurant, del };
  }

  it('applies .eq(restaurant_id) after .eq(id) when deleting a shift', async () => {
    const { deleteEqId, deleteEqRestaurant } = setupDeleteChain({ error: null });

    const { result } = renderHook(() => useDeleteShift(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({ id: 'shift-1', restaurantId: 'rest-123' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(deleteEqId).toHaveBeenCalledWith('id', 'shift-1');
    expect(deleteEqRestaurant).toHaveBeenCalledWith('restaurant_id', 'rest-123');
  });

  it('surfaces the Supabase error when the delete fails', async () => {
    setupDeleteChain({ error: { message: 'permission denied' } });

    const { result } = renderHook(() => useDeleteShift(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({ id: 'shift-1', restaurantId: 'rest-123' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
