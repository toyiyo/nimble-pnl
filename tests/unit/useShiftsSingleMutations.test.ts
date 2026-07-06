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
