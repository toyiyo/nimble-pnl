/**
 * Unit Tests: useDeleteShift — fire-and-forget "shift removed" notification
 *
 * Wires `buildShiftDeletedInvoke` (src/lib/shiftDeleteNotification.ts) into
 * `useDeleteShift`'s onSuccess: an optional `shift` snapshot is passed to
 * `mutate`, and iff the snapshot is a published+assigned shift, the hook
 * invokes `send-shift-notification` fire-and-forget (never lets a
 * notification failure surface as a mutation failure or block the toast).
 *
 * Per the 2026-05-16 lesson, `supabase.functions.invoke()` resolves with
 * `{ data, error }` on HTTP-level failures (it does NOT reject) — only
 * transport-level failures reject. Both are tested, and in both cases the
 * outer delete mutation must still resolve successfully and the toast must
 * still fire.
 */
import React, { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDeleteShift } from '@/hooks/useShifts';
import type { DeletableShift } from '@/lib/shiftDeleteNotification';

const mockToast = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockInvoke = vi.hoisted(() => vi.fn());

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  functions: { invoke: mockInvoke },
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

function setupDeleteChain(deleteResult: { error: { message: string } | null } = { error: null }) {
  const deleteEqRestaurant = vi.fn().mockResolvedValue(deleteResult);
  const deleteEqId = vi.fn().mockReturnValue({ eq: deleteEqRestaurant });
  const del = vi.fn().mockReturnValue({ eq: deleteEqId });

  mockSupabase.from.mockReturnValue({ delete: del });

  return { deleteEqId, deleteEqRestaurant, del };
}

const publishedAssignedShift: DeletableShift = {
  id: 'shift-1',
  restaurant_id: 'rest-123',
  employee_id: 'emp-1',
  is_published: true,
  position: 'Server',
  start_time: '2026-07-15T17:00:00.000Z',
  end_time: '2026-07-15T22:00:00.000Z',
};

const unpublishedShift: DeletableShift = {
  ...publishedAssignedShift,
  is_published: false,
};

describe('useDeleteShift — shift-deleted notification (fire-and-forget)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invokes send-shift-notification once with the deleted body for a published+assigned shift', async () => {
    setupDeleteChain();
    mockInvoke.mockResolvedValue({ data: { success: true }, error: null });

    const { result } = renderHook(() => useDeleteShift(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({ id: 'shift-1', restaurantId: 'rest-123', shift: publishedAssignedShift });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(1));

    expect(mockInvoke).toHaveBeenCalledWith('send-shift-notification', {
      body: {
        shiftId: 'shift-1',
        action: 'deleted',
        deletedShift: {
          restaurant_id: 'rest-123',
          employee_id: 'emp-1',
          position: 'Server',
          start_time: '2026-07-15T17:00:00.000Z',
          end_time: '2026-07-15T22:00:00.000Z',
        },
      },
    });
  });

  it('does NOT invoke send-shift-notification for an unpublished shift', async () => {
    setupDeleteChain();

    const { result } = renderHook(() => useDeleteShift(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({ id: 'shift-1', restaurantId: 'rest-123', shift: unpublishedShift });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('does NOT invoke send-shift-notification when no shift snapshot is passed', async () => {
    setupDeleteChain();

    const { result } = renderHook(() => useDeleteShift(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({ id: 'shift-1', restaurantId: 'rest-123' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('still resolves the mutation and shows the toast when invoke resolves with an HTTP-level error', async () => {
    setupDeleteChain();
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'edge function failed' } });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useDeleteShift(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({ id: 'shift-1', restaurantId: 'rest-123', shift: publishedAssignedShift });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Shift deleted' }),
    );

    await waitFor(() => expect(warnSpy).toHaveBeenCalledWith(
      'shift-deleted notify failed',
      expect.objectContaining({ shiftId: 'shift-1' }),
    ));

    warnSpy.mockRestore();
  });

  it('still resolves the mutation and shows the toast when invoke rejects (transport failure)', async () => {
    setupDeleteChain();
    mockInvoke.mockRejectedValue(new Error('network down'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useDeleteShift(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({ id: 'shift-1', restaurantId: 'rest-123', shift: publishedAssignedShift });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Shift deleted' }),
    );

    await waitFor(() => expect(warnSpy).toHaveBeenCalledWith(
      'shift-deleted notify failed',
      expect.objectContaining({ shiftId: 'shift-1' }),
    ));

    warnSpy.mockRestore();
  });

  it('still fires the fire-and-forget invoke when silent:true suppresses the toast', async () => {
    setupDeleteChain();
    mockInvoke.mockResolvedValue({ data: { success: true }, error: null });

    const { result } = renderHook(() => useDeleteShift({ silent: true }), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({ id: 'shift-1', restaurantId: 'rest-123', shift: publishedAssignedShift });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(1));
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Shift deleted' }),
    );
  });
});
