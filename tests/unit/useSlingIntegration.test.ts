import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useSlingIntegration } from '../../src/hooks/useSlingIntegration';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  functions: { invoke: vi.fn() },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

const mockToast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const RESTAURANT_ID = 'rest-int-123';

const mockConnection = {
  id: 'conn-1',
  restaurant_id: RESTAURANT_ID,
  email: 'test@sling.com',
  sling_org_id: 42,
  sling_org_name: 'Test Org',
  last_sync_time: '2026-01-15T00:00:00Z',
  initial_sync_done: true,
  sync_cursor: 0,
  is_active: true,
  connection_status: 'connected',
  last_error: null,
  last_error_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-15T00:00:00Z',
};

let mockFromChain: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  vi.clearAllMocks();

  mockFromChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    update: vi.fn().mockReturnThis(),
  };

  mockSupabase.from.mockReturnValue(mockFromChain);
  mockSupabase.functions.invoke.mockResolvedValue({ data: null, error: null });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSlingIntegration', () => {
  it('returns isConnected=true when connection exists', async () => {
    mockFromChain.maybeSingle.mockResolvedValue({
      data: mockConnection,
      error: null,
    });

    const { result } = renderHook(() => useSlingIntegration(RESTAURANT_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isConnecting).toBe(false);
    });

    expect(result.current.isConnected).toBe(true);
    expect(result.current.connection).toEqual(mockConnection);
  });

  it('returns isConnected=false when no connection found', async () => {
    mockFromChain.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });

    const { result } = renderHook(() => useSlingIntegration(RESTAURANT_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isConnecting).toBe(false);
    });

    expect(result.current.isConnected).toBe(false);
    expect(result.current.connection).toBeNull();
  });

  it('returns isConnected=false when restaurantId is null', async () => {
    const { result } = renderHook(() => useSlingIntegration(null), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isConnecting).toBe(false);
    });

    expect(result.current.isConnected).toBe(false);
  });

  it('disconnectSling calls through to useSlingConnection', async () => {
    // Select-chain eq calls return the chain; the final eq in the update call resolves
    mockFromChain.eq
      .mockReturnValueOnce(mockFromChain)  // eq('restaurant_id', ...) in select
      .mockReturnValueOnce(mockFromChain)  // eq('is_active', ...) in select
      .mockResolvedValue({ error: null }); // eq('restaurant_id', ...) in update
    mockFromChain.maybeSingle.mockResolvedValue({
      data: mockConnection,
      error: null,
    });

    const { result } = renderHook(() => useSlingIntegration(RESTAURANT_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isConnecting).toBe(false);
    });

    await act(async () => {
      await result.current.disconnectSling();
    });

    expect(mockSupabase.from).toHaveBeenCalledWith('sling_connections');
    expect(mockFromChain.update).toHaveBeenCalledWith({ is_active: false });
  });

  it('disconnectSling is no-op when restaurantId is null', async () => {
    const { result } = renderHook(() => useSlingIntegration(null), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isConnecting).toBe(false);
    });

    await act(async () => {
      await result.current.disconnectSling();
    });

    // Should not have called update since restaurantId is null
    expect(mockFromChain.update).not.toHaveBeenCalled();
  });

  it('checkConnectionStatus is a no-op function', async () => {
    const { result } = renderHook(() => useSlingIntegration(RESTAURANT_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isConnecting).toBe(false);
    });

    // Should not throw
    expect(() => result.current.checkConnectionStatus()).not.toThrow();
  });
});
