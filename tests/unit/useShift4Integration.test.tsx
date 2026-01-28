import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useShift4Integration } from '@/hooks/useShift4Integration';
import { supabase } from '@/integrations/supabase/client';

// Mock Supabase client
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    functions: {
      invoke: vi.fn(),
    },
  },
}));

// Mock toast
const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

describe('useShift4Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper to setup mock from() chain
  function setupMockFrom(data: unknown, error: unknown = null) {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data, error }),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error }),
      }),
    });
    (supabase.from as ReturnType<typeof vi.fn>) = mockFrom;
    return mockFrom;
  }

  describe('initial state', () => {
    it('should return not connected when no restaurantId provided', async () => {
      setupMockFrom(null);

      const { result } = renderHook(() => useShift4Integration(null));

      expect(result.current.isConnected).toBe(false);
      expect(result.current.connection).toBeNull();
      expect(result.current.loading).toBe(false);
    });

    it('should check connection on mount when restaurantId is provided', async () => {
      const mockConnection = {
        id: 'conn-1',
        restaurant_id: 'rest-1',
        merchant_id: 'merchant-123',
        environment: 'production',
        connected_at: '2024-01-01T00:00:00Z',
        last_sync_at: null,
        initial_sync_done: false,
        sync_cursor: 0,
        is_active: true,
        connection_status: 'connected',
      };

      setupMockFrom(mockConnection);

      const { result } = renderHook(() => useShift4Integration('rest-1'));

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
        expect(result.current.connection).toEqual(mockConnection);
      });
    });

    it('should handle connection not found', async () => {
      setupMockFrom(null);

      const { result } = renderHook(() => useShift4Integration('rest-1'));

      await waitFor(() => {
        expect(result.current.isConnected).toBe(false);
        expect(result.current.connection).toBeNull();
      });
    });

    it('should handle database errors gracefully', async () => {
      setupMockFrom(null, { code: 'PGRST500', message: 'Database error' });

      const { result } = renderHook(() => useShift4Integration('rest-1'));

      await waitFor(() => {
        expect(result.current.isConnected).toBe(false);
        expect(result.current.connection).toBeNull();
      });
    });
  });

  describe('connectShift4', () => {
    it('should throw when no restaurant selected', async () => {
      setupMockFrom(null);

      const { result } = renderHook(() => useShift4Integration(null));

      await expect(
        result.current.connectShift4('secret-key', 'merchant-id')
      ).rejects.toThrow('No restaurant selected');
    });

    it('should call edge function with correct parameters', async () => {
      setupMockFrom(null);

      const mockInvoke = vi.fn()
        .mockResolvedValueOnce({ data: { success: true, merchantId: 'merchant-123' }, error: null })
        .mockResolvedValueOnce({ data: { success: true, results: { chargesSynced: 10 } }, error: null });

      (supabase.functions.invoke as ReturnType<typeof vi.fn>) = mockInvoke;

      const { result } = renderHook(() => useShift4Integration('rest-1'));

      await act(async () => {
        await result.current.connectShift4('secret-key', 'merchant-id', 'production', 'email@test.com', 'password');
      });

      expect(mockInvoke).toHaveBeenCalledWith('shift4-connect', {
        body: {
          restaurantId: 'rest-1',
          secretKey: 'secret-key',
          merchantId: 'merchant-id',
          environment: 'production',
          email: 'email@test.com',
          password: 'password',
        },
      });
    });

    it('should trigger initial sync after successful connection', async () => {
      setupMockFrom(null);

      const mockInvoke = vi.fn()
        .mockResolvedValueOnce({ data: { success: true, merchantId: 'merchant-123' }, error: null })
        .mockResolvedValueOnce({ data: { success: true, results: { chargesSynced: 25, refundsSynced: 3 } }, error: null });

      (supabase.functions.invoke as ReturnType<typeof vi.fn>) = mockInvoke;

      const { result } = renderHook(() => useShift4Integration('rest-1'));

      await act(async () => {
        await result.current.connectShift4('secret-key', 'merchant-id');
      });

      // Should have called shift4-sync-data with initial_sync action
      expect(mockInvoke).toHaveBeenCalledWith('shift4-sync-data', {
        body: {
          restaurantId: 'rest-1',
          action: 'initial_sync',
        },
      });

      // Should show success toast
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Initial Sync Complete',
          description: expect.stringContaining('28'), // 25 + 3
        })
      );
    });

    it('should handle connection error from edge function', async () => {
      setupMockFrom(null);

      const mockInvoke = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Connection failed' },
      });

      (supabase.functions.invoke as ReturnType<typeof vi.fn>) = mockInvoke;

      const { result } = renderHook(() => useShift4Integration('rest-1'));

      await expect(
        result.current.connectShift4('secret-key', 'merchant-id')
      ).rejects.toThrow();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Connection Failed',
          variant: 'destructive',
        })
      );
    });

    it('should handle unsuccessful response from edge function', async () => {
      setupMockFrom(null);

      const mockInvoke = vi.fn().mockResolvedValue({
        data: { success: false, error: 'Invalid API key' },
        error: null,
      });

      (supabase.functions.invoke as ReturnType<typeof vi.fn>) = mockInvoke;

      const { result } = renderHook(() => useShift4Integration('rest-1'));

      await expect(
        result.current.connectShift4('secret-key', 'merchant-id')
      ).rejects.toThrow('Invalid API key');
    });

    it('should handle sync error after successful connection', async () => {
      setupMockFrom(null);

      const mockInvoke = vi.fn()
        .mockResolvedValueOnce({ data: { success: true, merchantId: 'merchant-123' }, error: null })
        .mockResolvedValueOnce({ data: null, error: { message: 'Sync failed' } });

      (supabase.functions.invoke as ReturnType<typeof vi.fn>) = mockInvoke;

      const { result } = renderHook(() => useShift4Integration('rest-1'));

      await act(async () => {
        await result.current.connectShift4('secret-key', 'merchant-id');
      });

      // Should show warning toast about sync issues
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Sync Warning',
          variant: 'destructive',
        })
      );
    });

    it('should set loading state during connection', async () => {
      setupMockFrom(null);

      let resolveInvoke: (value: unknown) => void;
      const invokePromise = new Promise((resolve) => {
        resolveInvoke = resolve;
      });

      const mockInvoke = vi.fn().mockReturnValue(invokePromise);
      (supabase.functions.invoke as ReturnType<typeof vi.fn>) = mockInvoke;

      const { result } = renderHook(() => useShift4Integration('rest-1'));

      expect(result.current.loading).toBe(false);

      let connectPromise: Promise<unknown>;
      act(() => {
        connectPromise = result.current.connectShift4('secret-key', 'merchant-id');
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(true);
      });

      await act(async () => {
        resolveInvoke!({ data: { success: true }, error: null });
        await connectPromise;
      });

      expect(result.current.loading).toBe(false);
    });
  });

  describe('disconnectShift4', () => {
    it('should throw when no connection exists', async () => {
      setupMockFrom(null);

      const { result } = renderHook(() => useShift4Integration('rest-1'));

      await waitFor(() => {
        expect(result.current.connection).toBeNull();
      });

      await expect(result.current.disconnectShift4()).rejects.toThrow('No connection to disconnect');
    });

    it('should delete connection and update state', async () => {
      const mockConnection = {
        id: 'conn-1',
        restaurant_id: 'rest-1',
        merchant_id: 'merchant-123',
        environment: 'production' as const,
        connected_at: '2024-01-01T00:00:00Z',
        last_sync_at: null,
      };

      const mockDelete = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: mockConnection, error: null }),
          }),
        }),
        delete: mockDelete,
      });

      (supabase.from as ReturnType<typeof vi.fn>) = mockFrom;

      const { result } = renderHook(() => useShift4Integration('rest-1'));

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      await act(async () => {
        await result.current.disconnectShift4();
      });

      expect(mockDelete).toHaveBeenCalled();
      expect(result.current.isConnected).toBe(false);
      expect(result.current.connection).toBeNull();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Shift4 Disconnected' })
      );
    });

    it('should handle disconnect error', async () => {
      const mockConnection = {
        id: 'conn-1',
        restaurant_id: 'rest-1',
        merchant_id: 'merchant-123',
        environment: 'production' as const,
        connected_at: '2024-01-01T00:00:00Z',
        last_sync_at: null,
      };

      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: mockConnection, error: null }),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: { message: 'Delete failed' } }),
        }),
      });

      (supabase.from as ReturnType<typeof vi.fn>) = mockFrom;

      const { result } = renderHook(() => useShift4Integration('rest-1'));

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      await expect(result.current.disconnectShift4()).rejects.toThrow();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Disconnection Failed',
          variant: 'destructive',
        })
      );
    });
  });

  describe('syncNow', () => {
    it('should throw when not connected', async () => {
      setupMockFrom(null);

      const { result } = renderHook(() => useShift4Integration('rest-1'));

      await waitFor(() => {
        expect(result.current.isConnected).toBe(false);
      });

      await expect(result.current.syncNow()).rejects.toThrow('Shift4 is not connected');
    });

    it('should call sync edge function with hourly_sync action', async () => {
      const mockConnection = {
        id: 'conn-1',
        restaurant_id: 'rest-1',
        merchant_id: 'merchant-123',
        environment: 'production' as const,
        connected_at: '2024-01-01T00:00:00Z',
        last_sync_at: null,
      };

      setupMockFrom(mockConnection);

      const mockInvoke = vi.fn().mockResolvedValue({
        data: { success: true, results: { chargesSynced: 15, refundsSynced: 2, errors: [] } },
        error: null,
      });

      (supabase.functions.invoke as ReturnType<typeof vi.fn>) = mockInvoke;

      const { result } = renderHook(() => useShift4Integration('rest-1'));

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      await act(async () => {
        const syncResult = await result.current.syncNow();
        expect(syncResult.results.chargesSynced).toBe(15);
      });

      expect(mockInvoke).toHaveBeenCalledWith('shift4-sync-data', {
        body: {
          restaurantId: 'rest-1',
          action: 'hourly_sync',
        },
      });

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Sync Complete',
          description: expect.stringContaining('17'), // 15 + 2
        })
      );
    });

    it('should handle sync failure from edge function error', async () => {
      const mockConnection = {
        id: 'conn-1',
        restaurant_id: 'rest-1',
        merchant_id: 'merchant-123',
        environment: 'production' as const,
        connected_at: '2024-01-01T00:00:00Z',
        last_sync_at: null,
      };

      setupMockFrom(mockConnection);

      const mockInvoke = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'API rate limit exceeded' },
      });

      (supabase.functions.invoke as ReturnType<typeof vi.fn>) = mockInvoke;

      const { result } = renderHook(() => useShift4Integration('rest-1'));

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      await expect(result.current.syncNow()).rejects.toThrow();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Sync Failed',
          variant: 'destructive',
        })
      );
    });

    it('should handle unsuccessful sync response', async () => {
      const mockConnection = {
        id: 'conn-1',
        restaurant_id: 'rest-1',
        merchant_id: 'merchant-123',
        environment: 'production' as const,
        connected_at: '2024-01-01T00:00:00Z',
        last_sync_at: null,
      };

      setupMockFrom(mockConnection);

      const mockInvoke = vi.fn().mockResolvedValue({
        data: { success: false, error: 'Authentication expired' },
        error: null,
      });

      (supabase.functions.invoke as ReturnType<typeof vi.fn>) = mockInvoke;

      const { result } = renderHook(() => useShift4Integration('rest-1'));

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      await expect(result.current.syncNow()).rejects.toThrow('Authentication expired');
    });

    it('should refresh connection after successful sync', async () => {
      const mockConnection = {
        id: 'conn-1',
        restaurant_id: 'rest-1',
        merchant_id: 'merchant-123',
        environment: 'production' as const,
        connected_at: '2024-01-01T00:00:00Z',
        last_sync_at: null,
      };

      const updatedConnection = {
        ...mockConnection,
        last_sync_at: '2024-01-15T12:00:00Z',
      };

      let callCount = 0;
      const mockFrom = vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockImplementation(() => {
              callCount++;
              return Promise.resolve({
                data: callCount === 1 ? mockConnection : updatedConnection,
                error: null,
              });
            }),
          }),
        }),
      }));

      (supabase.from as ReturnType<typeof vi.fn>) = mockFrom;

      const mockInvoke = vi.fn().mockResolvedValue({
        data: { success: true, results: { chargesSynced: 5, refundsSynced: 0 } },
        error: null,
      });

      (supabase.functions.invoke as ReturnType<typeof vi.fn>) = mockInvoke;

      const { result } = renderHook(() => useShift4Integration('rest-1'));

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      await act(async () => {
        await result.current.syncNow();
      });

      // checkConnection should have been called again after sync
      expect(callCount).toBeGreaterThan(1);
    });
  });

  describe('checkConnection', () => {
    it('should update connection state when called manually', async () => {
      const mockConnection = {
        id: 'conn-1',
        restaurant_id: 'rest-1',
        merchant_id: 'merchant-123',
        environment: 'production' as const,
        connected_at: '2024-01-01T00:00:00Z',
        last_sync_at: null,
      };

      let callCount = 0;
      const mockFrom = vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockImplementation(() => {
              callCount++;
              return Promise.resolve({
                data: callCount === 1 ? null : mockConnection,
                error: null,
              });
            }),
          }),
        }),
      }));

      (supabase.from as ReturnType<typeof vi.fn>) = mockFrom;

      const { result } = renderHook(() => useShift4Integration('rest-1'));

      await waitFor(() => {
        expect(result.current.isConnected).toBe(false);
      });

      await act(async () => {
        await result.current.checkConnection();
      });

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
        expect(result.current.connection).toEqual(mockConnection);
      });
    });
  });

  describe('sync progress tracking', () => {
    it('should expose sync progress fields from connection', async () => {
      const mockConnection = {
        id: 'conn-1',
        restaurant_id: 'rest-1',
        merchant_id: 'merchant-123',
        environment: 'production' as const,
        connected_at: '2024-01-01T00:00:00Z',
        last_sync_at: '2024-01-15T10:00:00Z',
        initial_sync_done: false,
        sync_cursor: 45,
        is_active: true,
        connection_status: 'connected',
        last_error: null,
        last_error_at: null,
        last_sync_time: '2024-01-15T10:00:00Z',
      };

      setupMockFrom(mockConnection);

      const { result } = renderHook(() => useShift4Integration('rest-1'));

      await waitFor(() => {
        expect(result.current.connection).not.toBeNull();
      });

      expect(result.current.connection?.initial_sync_done).toBe(false);
      expect(result.current.connection?.sync_cursor).toBe(45);
      expect(result.current.connection?.is_active).toBe(true);
      expect(result.current.connection?.connection_status).toBe('connected');
    });

    it('should expose error state from connection', async () => {
      const mockConnection = {
        id: 'conn-1',
        restaurant_id: 'rest-1',
        merchant_id: 'merchant-123',
        environment: 'production' as const,
        connected_at: '2024-01-01T00:00:00Z',
        last_sync_at: '2024-01-15T10:00:00Z',
        initial_sync_done: true,
        sync_cursor: 0,
        is_active: true,
        connection_status: 'error',
        last_error: 'Authentication token expired',
        last_error_at: '2024-01-15T12:00:00Z',
        last_sync_time: '2024-01-15T10:00:00Z',
      };

      setupMockFrom(mockConnection);

      const { result } = renderHook(() => useShift4Integration('rest-1'));

      await waitFor(() => {
        expect(result.current.connection).not.toBeNull();
      });

      expect(result.current.connection?.connection_status).toBe('error');
      expect(result.current.connection?.last_error).toBe('Authentication token expired');
      expect(result.current.connection?.last_error_at).toBe('2024-01-15T12:00:00Z');
    });
  });

  describe('edge cases', () => {
    it('should handle restaurantId change', async () => {
      const connection1 = {
        id: 'conn-1',
        restaurant_id: 'rest-1',
        merchant_id: 'merchant-1',
        environment: 'production' as const,
        connected_at: '2024-01-01T00:00:00Z',
        last_sync_at: null,
      };

      const connection2 = {
        id: 'conn-2',
        restaurant_id: 'rest-2',
        merchant_id: 'merchant-2',
        environment: 'production' as const,
        connected_at: '2024-01-02T00:00:00Z',
        last_sync_at: null,
      };

      const mockFrom = vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockImplementation((_, restaurantId) => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: restaurantId === 'rest-1' ? connection1 : connection2,
              error: null,
            }),
          })),
        }),
      }));

      (supabase.from as ReturnType<typeof vi.fn>) = mockFrom;

      const { result, rerender } = renderHook(
        ({ restaurantId }) => useShift4Integration(restaurantId),
        { initialProps: { restaurantId: 'rest-1' } }
      );

      await waitFor(() => {
        expect(result.current.connection?.merchant_id).toBe('merchant-1');
      });

      rerender({ restaurantId: 'rest-2' });

      await waitFor(() => {
        expect(result.current.connection?.merchant_id).toBe('merchant-2');
      });
    });

    it('should handle null to valid restaurantId transition', async () => {
      const mockConnection = {
        id: 'conn-1',
        restaurant_id: 'rest-1',
        merchant_id: 'merchant-123',
        environment: 'production' as const,
        connected_at: '2024-01-01T00:00:00Z',
        last_sync_at: null,
      };

      setupMockFrom(mockConnection);

      const { result, rerender } = renderHook(
        ({ restaurantId }) => useShift4Integration(restaurantId),
        { initialProps: { restaurantId: null as string | null } }
      );

      expect(result.current.isConnected).toBe(false);
      expect(result.current.connection).toBeNull();

      rerender({ restaurantId: 'rest-1' });

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
        expect(result.current.connection).toEqual(mockConnection);
      });
    });

    it('should handle empty merchant ID in connection', async () => {
      setupMockFrom(null);

      const mockInvoke = vi.fn()
        .mockResolvedValueOnce({ data: { success: true, merchantId: '' }, error: null })
        .mockResolvedValueOnce({ data: { success: true, results: { chargesSynced: 0 } }, error: null });

      (supabase.functions.invoke as ReturnType<typeof vi.fn>) = mockInvoke;

      const { result } = renderHook(() => useShift4Integration('rest-1'));

      await act(async () => {
        await result.current.connectShift4('secret-key', undefined);
      });

      expect(mockInvoke).toHaveBeenCalledWith('shift4-connect', {
        body: expect.objectContaining({
          merchantId: undefined,
        }),
      });
    });

    it('should handle sandbox environment', async () => {
      setupMockFrom(null);

      const mockInvoke = vi.fn()
        .mockResolvedValueOnce({ data: { success: true, merchantId: 'sandbox-merchant' }, error: null })
        .mockResolvedValueOnce({ data: { success: true, results: { chargesSynced: 0 } }, error: null });

      (supabase.functions.invoke as ReturnType<typeof vi.fn>) = mockInvoke;

      const { result } = renderHook(() => useShift4Integration('rest-1'));

      await act(async () => {
        await result.current.connectShift4('sandbox-key', 'sandbox-merchant', 'sandbox');
      });

      expect(mockInvoke).toHaveBeenCalledWith('shift4-connect', {
        body: expect.objectContaining({
          environment: 'sandbox',
        }),
      });
    });

    it('should handle zero records synced', async () => {
      const mockConnection = {
        id: 'conn-1',
        restaurant_id: 'rest-1',
        merchant_id: 'merchant-123',
        environment: 'production' as const,
        connected_at: '2024-01-01T00:00:00Z',
        last_sync_at: null,
      };

      setupMockFrom(mockConnection);

      const mockInvoke = vi.fn().mockResolvedValue({
        data: { success: true, results: { chargesSynced: 0, refundsSynced: 0 } },
        error: null,
      });

      (supabase.functions.invoke as ReturnType<typeof vi.fn>) = mockInvoke;

      const { result } = renderHook(() => useShift4Integration('rest-1'));

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      await act(async () => {
        await result.current.syncNow();
      });

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Sync Complete',
          description: expect.stringContaining('0'),
        })
      );
    });
  });
});
