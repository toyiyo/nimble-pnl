import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useToastConnection } from '@/hooks/useToastConnection';
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
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

describe('useToastConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkConnectionStatus', () => {
    it('should return null when restaurantId is missing', async () => {
      const { result } = renderHook(() => useToastConnection());

      await act(async () => {
        const status = await result.current.checkConnectionStatus('');
        expect(status).toBeNull();
        expect(result.current.isConnected).toBe(false);
        expect(result.current.connection).toBeNull();
      });
    });

    it('should fetch and set connection when found', async () => {
      const mockConnection = {
        id: 'conn-1',
        restaurant_id: 'rest-1',
        client_id: 'client-123',
        toast_restaurant_guid: 'toast-guid',
        is_active: true,
        webhook_active: false,
        connection_status: 'connected',
        last_sync_time: null,
        initial_sync_done: false,
        last_error: null,
        last_error_at: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: mockConnection,
                error: null,
              }),
            }),
          }),
        }),
      });

      (supabase.from as any) = mockFrom;

      const { result } = renderHook(() => useToastConnection());

      await act(async () => {
        const status = await result.current.checkConnectionStatus('rest-1');
        expect(status).toEqual(mockConnection);
      });

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
        expect(result.current.connection).toEqual(mockConnection);
      });
    });

    it('should handle connection not found', async () => {
      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: null,
              }),
            }),
          }),
        }),
      });

      (supabase.from as any) = mockFrom;

      const { result } = renderHook(() => useToastConnection());

      await act(async () => {
        const status = await result.current.checkConnectionStatus('rest-1');
        expect(status).toBeNull();
      });

      expect(result.current.isConnected).toBe(false);
      expect(result.current.connection).toBeNull();
    });

    it('should handle database errors gracefully', async () => {
      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: { code: 'PGRST500', message: 'Database error' },
              }),
            }),
          }),
        }),
      });

      (supabase.from as any) = mockFrom;

      const { result } = renderHook(() => useToastConnection());

      await act(async () => {
        const status = await result.current.checkConnectionStatus('rest-1');
        expect(status).toBeNull();
      });

      expect(result.current.isConnected).toBe(false);
    });
  });

  describe('saveCredentials', () => {
    it('should call edge function and update connection status', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        data: { success: true },
        error: null,
      });

      (supabase.functions.invoke as any) = mockInvoke;

      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: null,
              }),
            }),
          }),
        }),
      });

      (supabase.from as any) = mockFrom;

      const { result } = renderHook(() => useToastConnection());

      await act(async () => {
        await result.current.saveCredentials(
          'rest-1',
          'client-id',
          'client-secret',
          'toast-guid'
        );
      });

      expect(mockInvoke).toHaveBeenCalledWith('toast-save-credentials', {
        body: {
          restaurantId: 'rest-1',
          clientId: 'client-id',
          clientSecret: 'client-secret',
          toastRestaurantGuid: 'toast-guid',
        },
      });
    });

    it('should handle edge function errors', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Failed to save credentials' },
      });

      (supabase.functions.invoke as any) = mockInvoke;

      const { result } = renderHook(() => useToastConnection());

      await act(async () => {
        await expect(
          result.current.saveCredentials('rest-1', 'client-id', 'client-secret', 'toast-guid')
        ).rejects.toThrow();
      });
    });
  });

  describe('testConnection', () => {
    it('should invoke test-connection edge function successfully', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        data: { success: true, restaurantName: 'Test Restaurant' },
        error: null,
      });

      (supabase.functions.invoke as any) = mockInvoke;

      const { result } = renderHook(() => useToastConnection());

      await act(async () => {
        const testResult = await result.current.testConnection('rest-1');
        expect(testResult.success).toBe(true);
        expect(testResult.restaurantName).toBe('Test Restaurant');
      });

      expect(mockInvoke).toHaveBeenCalledWith('toast-test-connection', {
        body: { restaurantId: 'rest-1' },
      });
    });

    it('should handle test connection failures', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        data: { error: 'Invalid credentials' },
        error: null,
      });

      (supabase.functions.invoke as any) = mockInvoke;

      const { result } = renderHook(() => useToastConnection());

      await act(async () => {
        await expect(result.current.testConnection('rest-1')).rejects.toThrow('Invalid credentials');
      });
    });
  });

  describe('saveWebhookSecret', () => {
    it('should save webhook secret successfully', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        data: { success: true },
        error: null,
      });

      (supabase.functions.invoke as any) = mockInvoke;

      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: null,
              }),
            }),
          }),
        }),
      });

      (supabase.from as any) = mockFrom;

      const { result } = renderHook(() => useToastConnection());

      await act(async () => {
        await result.current.saveWebhookSecret('rest-1', 'webhook-secret-123');
      });

      expect(mockInvoke).toHaveBeenCalledWith('toast-save-webhook-secret', {
        body: { restaurantId: 'rest-1', webhookSecret: 'webhook-secret-123' },
      });
    });
  });

  describe('disconnectToast', () => {
    it('should set is_active to false', async () => {
      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          error: null,
        }),
      });

      const mockFrom = vi.fn().mockReturnValue({
        update: mockUpdate,
      });

      (supabase.from as any) = mockFrom;

      const { result } = renderHook(() => useToastConnection());

      await act(async () => {
        await result.current.disconnectToast('rest-1');
      });

      expect(mockUpdate).toHaveBeenCalledWith({ is_active: false });
      expect(result.current.isConnected).toBe(false);
      expect(result.current.connection).toBeNull();
    });

    it('should handle disconnect errors', async () => {
      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          error: { message: 'Update failed' },
        }),
      });

      const mockFrom = vi.fn().mockReturnValue({
        update: mockUpdate,
      });

      (supabase.from as any) = mockFrom;

      const { result } = renderHook(() => useToastConnection());

      await act(async () => {
        await expect(result.current.disconnectToast('rest-1')).rejects.toThrow();
      });
    });
  });

  describe('triggerManualSync', () => {
    it('CRITICAL: should invoke sync edge function and return orders synced', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        data: { success: true, ordersSynced: 42, errors: [] },
        error: null,
      });

      (supabase.functions.invoke as any) = mockInvoke;

      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: null,
              }),
            }),
          }),
        }),
      });

      (supabase.from as any) = mockFrom;

      const { result } = renderHook(() => useToastConnection());

      await act(async () => {
        const syncResult = await result.current.triggerManualSync('rest-1');
        expect(syncResult.ordersSynced).toBe(42);
        expect(syncResult.errors).toEqual([]);
      });

      expect(mockInvoke).toHaveBeenCalledWith('toast-sync-data', {
        body: { restaurantId: 'rest-1' },
      });
    });

    it('should handle sync errors', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        data: { error: 'Sync failed' },
        error: null,
      });

      (supabase.functions.invoke as any) = mockInvoke;

      const { result } = renderHook(() => useToastConnection());

      await act(async () => {
        await expect(result.current.triggerManualSync('rest-1')).rejects.toThrow('Sync failed');
      });
    });
  });
});
