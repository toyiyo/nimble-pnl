import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ---- Mocks (hoisted) ----

const mockSupabase = vi.hoisted(() => ({
  rpc: vi.fn(),
  functions: { invoke: vi.fn() },
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

const baseInput = {
  restaurant_id: 'r1',
  offered_shift_id: 's1',
  offered_by_employee_id: 'e1',
};

// ---- Import after mocks ----

import { useCreateShiftTradeForEmployee } from '@/hooks/useShiftTrades';

describe('useCreateShiftTradeForEmployee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.functions.invoke.mockResolvedValue({ data: null, error: null });
  });

  it('calls the RPC with p_-prefixed params and defaults nulls', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: 'trade-1', error: null });

    const { result } = renderHook(() => useCreateShiftTradeForEmployee(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync(baseInput);
    });

    expect(mockSupabase.rpc).toHaveBeenCalledWith('create_shift_trade_for_employee', {
      p_restaurant_id: 'r1',
      p_offered_shift_id: 's1',
      p_offered_by_employee_id: 'e1',
      p_target_employee_id: null,
      p_reason: null,
    });
  });

  it('passes a directed target and reason through', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: 'trade-2', error: null });

    const { result } = renderHook(() => useCreateShiftTradeForEmployee(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        ...baseInput,
        target_employee_id: 'e2',
        reason: 'family event',
      });
    });

    expect(mockSupabase.rpc).toHaveBeenCalledWith('create_shift_trade_for_employee', {
      p_restaurant_id: 'r1',
      p_offered_shift_id: 's1',
      p_offered_by_employee_id: 'e1',
      p_target_employee_id: 'e2',
      p_reason: 'family event',
    });
  });

  it('sends the created notification with the returned trade id', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: 'trade-3', error: null });

    const { result } = renderHook(() => useCreateShiftTradeForEmployee(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync(baseInput);
    });

    expect(mockSupabase.functions.invoke).toHaveBeenCalledWith(
      'send-shift-trade-notification',
      { body: { tradeId: 'trade-3', action: 'created' } },
    );
  });

  it('throws and shows a destructive toast on RPC error', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'Only an owner or a manager can post a trade for an employee' },
    });

    const { result } = renderHook(() => useCreateShiftTradeForEmployee(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(() => result.current.mutateAsync(baseInput)),
    ).rejects.toBeTruthy();

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error posting trade',
          variant: 'destructive',
        }),
      );
    });
  });
});
