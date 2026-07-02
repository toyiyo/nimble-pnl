/**
 * Unit Tests: useDeleteShiftTrade mutation hook
 *
 * Verifies the three observable behaviours:
 *   (a) success  → invalidates ['shift_trades'] + ['marketplace_trades'] + success toast
 *   (b) resolved { error } (PostgREST HTTP failure) → destructive toast
 *   (c) thrown transport error → destructive toast
 *
 * The Supabase builder chain exercised is:
 *   supabase.from('shift_trades').delete().eq('id', tradeId).in('status', [...])
 */

import React, { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDeleteShiftTrade } from '@/hooks/useShiftTrades';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockToast = vi.hoisted(() => vi.fn());

// We need a real-looking builder chain where `in()` is the terminal
// awaitable step (returns a promise).
const buildDeleteChain = vi.hoisted(() => {
  return (resolvedValue: { data: unknown; error: unknown }) => {
    const chain = {
      delete: vi.fn(),
      eq: vi.fn(),
      in: vi.fn().mockResolvedValue(resolvedValue),
    };
    chain.delete.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    return chain;
  };
});

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDeleteShiftTrade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('(a) success: invalidates shift_trades and marketplace_trades caches, shows success toast', async () => {
    const chain = buildDeleteChain({ data: null, error: null });
    mockSupabase.from.mockReturnValue(chain);

    const { result } = renderHook(() => useDeleteShiftTrade(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ tradeId: 'trade-123' });
    });

    // Correct Supabase chain was called
    expect(mockSupabase.from).toHaveBeenCalledWith('shift_trades');
    expect(chain.delete).toHaveBeenCalled();
    expect(chain.eq).toHaveBeenCalledWith('id', 'trade-123');
    expect(chain.in).toHaveBeenCalledWith('status', ['open', 'pending_approval']);

    // Success toast (not destructive — no variant key)
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Trade removed',
      }),
    );
    // Confirm no destructive variant was used
    const toastCall = mockToast.mock.calls[0][0];
    expect(toastCall.variant).toBeUndefined();
  });

  it('(b) resolved { error } (PostgREST failure): throws and shows destructive toast', async () => {
    const postgrestError = { message: 'Row-level security violation', code: '42501' };
    const chain = buildDeleteChain({ data: null, error: postgrestError });
    mockSupabase.from.mockReturnValue(chain);

    const { result } = renderHook(() => useDeleteShiftTrade(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({ tradeId: 'trade-456' });
      }),
    ).rejects.toThrow();

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error removing trade',
          variant: 'destructive',
        }),
      ),
    );
  });

  it('(c) thrown transport error: surfaces destructive toast', async () => {
    // `in()` throws instead of resolving — simulates a network failure
    const chain = {
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockRejectedValue(new Error('Network timeout')),
    };
    (chain.delete as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    (chain.eq as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    mockSupabase.from.mockReturnValue(chain);

    const { result } = renderHook(() => useDeleteShiftTrade(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({ tradeId: 'trade-789' });
      }),
    ).rejects.toThrow('Network timeout');

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error removing trade',
          description: 'Network timeout',
          variant: 'destructive',
        }),
      ),
    );
  });

  it('does NOT invalidate shifts cache (ownership never transferred on delete)', async () => {
    const chain = buildDeleteChain({ data: null, error: null });
    mockSupabase.from.mockReturnValue(chain);

    // Spy on invalidateQueries to assert shifts is not touched
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const wrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useDeleteShiftTrade(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ tradeId: 'trade-123' });
    });

    const calledKeys = invalidateSpy.mock.calls.map(
      (call) => (call[0] as { queryKey?: unknown[] })?.queryKey,
    );

    expect(calledKeys).toContainEqual(['shift_trades']);
    expect(calledKeys).toContainEqual(['marketplace_trades']);
    // Must NOT invalidate the shifts cache
    expect(calledKeys).not.toContainEqual(expect.arrayContaining(['shifts']));
  });
});
