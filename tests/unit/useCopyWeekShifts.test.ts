import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { Shift } from '@/types/scheduling';

// ---- Mocks (hoisted) ----

const mockSupabase = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

const mockToast = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ---- Helpers ----

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function mockShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: crypto.randomUUID(),
    restaurant_id: 'r1',
    employee_id: 'e1',
    start_time: new Date(2026, 2, 2, 10, 0, 0).toISOString(),
    end_time: new Date(2026, 2, 2, 16, 0, 0).toISOString(),
    break_duration: 30,
    position: 'Server',
    notes: undefined,
    status: 'scheduled',
    is_published: false,
    locked: false,
    is_recurring: false,
    recurrence_parent_id: null,
    recurrence_pattern: null,
    published_at: null,
    published_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as Shift;
}

const sourceMonday = new Date(2026, 2, 2);
const targetMonday = new Date(2026, 2, 9);
const restaurantId = 'r1';

// ---- Import after mocks ----

import { useCopyWeekShifts } from '@/hooks/useCopyWeekShifts';

describe('useCopyWeekShifts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls supabase.rpc with correct params on success', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: { copied_count: 2, deleted_count: 1 },
      error: null,
    });

    const { result } = renderHook(() => useCopyWeekShifts(), {
      wrapper: createWrapper(),
    });

    const shifts = [mockShift(), mockShift({ employee_id: 'e2' })];

    await act(async () => {
      await result.current.mutateAsync({
        sourceShifts: shifts,
        sourceMonday,
        targetMonday,
        restaurantId,
      });
    });

    expect(mockSupabase.rpc).toHaveBeenCalledWith('copy_week_shifts', {
      p_restaurant_id: restaurantId,
      p_target_start: expect.stringContaining('2026-03-'),
      p_target_end: expect.stringContaining('2026-03-'),
      p_shifts: expect.arrayContaining([
        expect.objectContaining({
          restaurant_id: restaurantId,
          status: 'scheduled',
          is_published: false,
          locked: false,
        }),
      ]),
    });
  });

  it('returns copiedCount and deletedCount from RPC response', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: { copied_count: 3, deleted_count: 5 },
      error: null,
    });

    const { result } = renderHook(() => useCopyWeekShifts(), {
      wrapper: createWrapper(),
    });

    let outcome: { copiedCount: number; deletedCount: number } | undefined;

    await act(async () => {
      outcome = await result.current.mutateAsync({
        sourceShifts: [mockShift()],
        sourceMonday,
        targetMonday,
        restaurantId,
      });
    });

    expect(outcome).toEqual({ copiedCount: 3, deletedCount: 5 });
  });

  it('falls back to inserts.length when RPC returns null data', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useCopyWeekShifts(), {
      wrapper: createWrapper(),
    });

    let outcome: { copiedCount: number; deletedCount: number } | undefined;

    await act(async () => {
      outcome = await result.current.mutateAsync({
        sourceShifts: [mockShift(), mockShift()],
        sourceMonday,
        targetMonday,
        restaurantId,
      });
    });

    expect(outcome).toEqual({ copiedCount: 2, deletedCount: 0 });
  });

  it('shows success toast with shift count and date range', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: { copied_count: 4, deleted_count: 0 },
      error: null,
    });

    const { result } = renderHook(() => useCopyWeekShifts(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        sourceShifts: [mockShift()],
        sourceMonday,
        targetMonday,
        restaurantId,
      });
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Schedule copied',
          description: expect.stringContaining('4 shifts copied to'),
        }),
      );
    });
  });

  it('throws when all source shifts are cancelled (empty inserts)', async () => {
    const { result } = renderHook(() => useCopyWeekShifts(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(() =>
        result.current.mutateAsync({
          sourceShifts: [mockShift({ status: 'cancelled' })],
          sourceMonday,
          targetMonday,
          restaurantId,
        }),
      ),
    ).rejects.toThrow('No shifts to copy');

    // Should NOT have called supabase
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('throws and shows destructive toast on RPC error', async () => {
    const rpcError = { message: 'permission denied', code: '42501' };
    mockSupabase.rpc.mockResolvedValue({ data: null, error: rpcError });

    const { result } = renderHook(() => useCopyWeekShifts(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(() =>
        result.current.mutateAsync({
          sourceShifts: [mockShift()],
          sourceMonday,
          targetMonday,
          restaurantId,
        }),
      ),
    ).rejects.toBeTruthy();

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Failed to copy schedule',
          variant: 'destructive',
        }),
      );
    });
  });

  it('excludes cancelled shifts from RPC payload', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: { copied_count: 1, deleted_count: 0 },
      error: null,
    });

    const { result } = renderHook(() => useCopyWeekShifts(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        sourceShifts: [
          mockShift({ status: 'scheduled' }),
          mockShift({ status: 'cancelled' }),
          mockShift({ status: 'confirmed' }),
        ],
        sourceMonday,
        targetMonday,
        restaurantId,
      });
    });

    const rpcCall = mockSupabase.rpc.mock.calls[0];
    const shiftsPayload = rpcCall[1].p_shifts;
    // cancelled shift should be filtered out
    expect(shiftsPayload).toHaveLength(2);
  });
});
