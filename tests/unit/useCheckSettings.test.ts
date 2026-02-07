import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useCheckSettings } from '../../src/hooks/useCheckSettings';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'rest-123' },
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
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

let mockFromChain: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  vi.clearAllMocks();

  mockFromChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    upsert: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'set-1', business_name: 'Test' }, error: null }),
  };

  mockSupabase.from.mockReturnValue(mockFromChain);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useCheckSettings', () => {
  describe('query', () => {
    it('fetches settings for the current restaurant', async () => {
      const mockSettings = {
        id: 'set-1',
        restaurant_id: 'rest-123',
        business_name: 'Test Restaurant',
        next_check_number: 1001,
      };
      mockFromChain.maybeSingle.mockResolvedValue({ data: mockSettings, error: null });

      const { result } = renderHook(() => useCheckSettings(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.settings).toEqual(mockSettings);
      expect(result.current.error).toBeNull();
      expect(mockSupabase.from).toHaveBeenCalledWith('check_settings');
      expect(mockFromChain.eq).toHaveBeenCalledWith('restaurant_id', 'rest-123');
    });

    it('returns null settings when no data exists', async () => {
      mockFromChain.maybeSingle.mockResolvedValue({ data: null, error: null });

      const { result } = renderHook(() => useCheckSettings(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.settings).toBeNull();
    });

    it('handles query errors', async () => {
      const mockError = new Error('Database error');
      mockFromChain.maybeSingle.mockResolvedValue({ data: null, error: mockError });

      const { result } = renderHook(() => useCheckSettings(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
      });
    });
  });

  describe('saveSettings mutation', () => {
    it('upserts settings and returns saved data', async () => {
      const savedData = { id: 'set-1', business_name: 'New Name', next_check_number: 1001 };
      mockFromChain.single.mockResolvedValue({ data: savedData, error: null });

      const { result } = renderHook(() => useCheckSettings(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.saveSettings.mutateAsync({
          business_name: 'New Name',
        });
      });

      expect(mockSupabase.from).toHaveBeenCalledWith('check_settings');
      expect(mockFromChain.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          restaurant_id: 'rest-123',
          business_name: 'New Name',
        }),
        { onConflict: 'restaurant_id' },
      );
    });

    it('handles save errors', async () => {
      const mockError = new Error('Save failed');
      mockFromChain.single.mockResolvedValue({ data: null, error: mockError });

      const { result } = renderHook(() => useCheckSettings(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await expect(
        act(() => result.current.saveSettings.mutateAsync({ business_name: 'Test' })),
      ).rejects.toThrow();
    });
  });

  describe('claimCheckNumbers mutation', () => {
    it('calls RPC and returns the starting check number', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: 1001, error: null });

      const { result } = renderHook(() => useCheckSettings(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      let startNumber: number | undefined;
      await act(async () => {
        startNumber = await result.current.claimCheckNumbers.mutateAsync(3);
      });

      expect(startNumber).toBe(1001);
      expect(mockSupabase.rpc).toHaveBeenCalledWith('claim_check_numbers', {
        p_restaurant_id: 'rest-123',
        p_count: 3,
      });
    });

    it('throws when RPC returns an error', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: null, error: new Error('RPC failed') });

      const { result } = renderHook(() => useCheckSettings(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await expect(
        act(() => result.current.claimCheckNumbers.mutateAsync(1)),
      ).rejects.toThrow();
    });

    it('throws when RPC returns non-number data', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

      const { result } = renderHook(() => useCheckSettings(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await expect(
        act(() => result.current.claimCheckNumbers.mutateAsync(1)),
      ).rejects.toThrow('Failed to claim check numbers');
    });
  });
});
