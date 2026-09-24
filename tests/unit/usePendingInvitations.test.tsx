import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { usePendingInvitations } from '@/hooks/usePendingInvitations';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSupabase = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

const mockUseAuth = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useAuth', () => ({
  useAuth: mockUseAuth,
}));

const mockToast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockRecordTeamMemberJoined = vi.hoisted(() => vi.fn());
vi.mock('@/lib/analytics', () => ({
  recordTeamMemberJoined: mockRecordTeamMemberJoined,
}));

vi.mock('posthog-js', () => ({
  default: { capture: vi.fn(), identify: vi.fn(), reset: vi.fn() },
}));

let queryClient: QueryClient;

function createWrapper() {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const RPC_ROW = {
  invitation_id: 'inv-1',
  restaurant_name: 'Bar Bar',
  role: 'staff',
  expires_at: '2026-09-15T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAuth.mockReturnValue({ user: { id: 'user-1', email: 'invitee@test.com' } });
});

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

describe('usePendingInvitations query', () => {
  it('maps RPC rows to camelCase invitations', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: [RPC_ROW], error: null });

    const { result } = renderHook(() => usePendingInvitations(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_my_pending_invitations');
    expect(result.current.invitations).toEqual([
      {
        invitationId: 'inv-1',
        restaurantName: 'Bar Bar',
        role: 'staff',
        expiresAt: '2026-09-15T00:00:00Z',
      },
    ]);
  });

  it('does not query without a user', async () => {
    mockUseAuth.mockReturnValue({ user: null });

    const { result } = renderHook(() => usePendingInvitations(), {
      wrapper: createWrapper(),
    });

    expect(mockSupabase.rpc).not.toHaveBeenCalled();
    expect(result.current.invitations).toEqual([]);
  });

  it('exposes the query error', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const { result } = renderHook(() => usePendingInvitations(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.error).toBeTruthy());
  });
});

// ---------------------------------------------------------------------------
// Accept mutation
// ---------------------------------------------------------------------------

describe('usePendingInvitations accept', () => {
  it('accepts, records the join, and invalidates both query keys', async () => {
    mockSupabase.rpc.mockImplementation((fn: string) => {
      if (fn === 'get_my_pending_invitations') {
        return Promise.resolve({ data: [RPC_ROW], error: null });
      }
      if (fn === 'accept_my_invitation') {
        return Promise.resolve({
          data: [{ accepted: true, restaurant_id: 'r1', restaurant_name: 'Bar Bar', reason: null }],
          error: null,
        });
      }
      throw new Error(`unexpected rpc ${fn}`);
    });

    const { result } = renderHook(() => usePendingInvitations(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      result.current.accept('inv-1');
    });

    await waitFor(() => {
      expect(mockSupabase.rpc).toHaveBeenCalledWith('accept_my_invitation', {
        p_invitation_id: 'inv-1',
      });
    });

    await waitFor(() => {
      expect(mockRecordTeamMemberJoined).toHaveBeenCalledTimes(1);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pending-invitations', 'user-1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['restaurants', 'user-1'] });
  });

  it('shows a destructive toast and refreshes the list when accepted=false', async () => {
    mockSupabase.rpc.mockImplementation((fn: string) => {
      if (fn === 'get_my_pending_invitations') {
        return Promise.resolve({ data: [RPC_ROW], error: null });
      }
      return Promise.resolve({
        data: [{ accepted: false, restaurant_id: null, restaurant_name: null, reason: 'not_found' }],
        error: null,
      });
    });

    const { result } = renderHook(() => usePendingInvitations(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      result.current.accept('inv-1');
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive' }),
      );
    });
    expect(mockRecordTeamMemberJoined).not.toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pending-invitations', 'user-1'] });
    // A token-path accept in another tab makes the row not_found while the
    // membership exists — the restaurants list must refresh too.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['restaurants', 'user-1'] });
  });

  it('shows a destructive toast on an RPC error', async () => {
    mockSupabase.rpc.mockImplementation((fn: string) => {
      if (fn === 'get_my_pending_invitations') {
        return Promise.resolve({ data: [RPC_ROW], error: null });
      }
      return Promise.resolve({ data: null, error: { message: 'network down' } });
    });

    const { result } = renderHook(() => usePendingInvitations(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.accept('inv-1');
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive' }),
      );
    });
    expect(mockRecordTeamMemberJoined).not.toHaveBeenCalled();
  });
});
