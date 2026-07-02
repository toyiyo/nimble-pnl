import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFocusConnection, FocusRestaurantOption } from '@/hooks/useFocusConnection';
import { supabase } from '@/integrations/supabase/client';
import React from 'react';

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

describe('useFocusConnection', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  // ---- query / maybeSingle + explicit column list ----

  describe('connection query', () => {
    it('returns null and isConnected=false when no restaurantId', async () => {
      const { result } = renderHook(() => useFocusConnection(), { wrapper });

      // no restaurantId → query disabled → connection is undefined/null
      expect(result.current.isConnected).toBe(false);
      expect(result.current.connection).toBeUndefined();
    });

    it('uses maybeSingle() (not single()) so PGRST116 is never thrown', async () => {
      const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });

      (supabase.from as any) = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: maybeSingleMock,
            }),
          }),
        }),
      });

      const { result } = renderHook(() => useFocusConnection('rest-1'), { wrapper });

      await waitFor(() => expect(maybeSingleMock).toHaveBeenCalled());
      expect(result.current.isConnected).toBe(false);
    });

    it('uses an explicit column list (not select("*"))', async () => {
      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      });

      (supabase.from as any) = vi.fn().mockReturnValue({ select: selectMock });

      renderHook(() => useFocusConnection('rest-1'), { wrapper });

      await waitFor(() => expect(selectMock).toHaveBeenCalled());
      const selectArg: string = selectMock.mock.calls[0][0];
      // must not be the wildcard shortcut
      expect(selectArg).not.toBe('*');
      // must include key fields
      expect(selectArg).toMatch(/id/);
      expect(selectArg).toMatch(/store_id/);
      expect(selectArg).toMatch(/connection_status/);
      expect(selectArg).toMatch(/is_active/);
    });

    it('returns the connection when found and sets isConnected=true', async () => {
      const mockConnection = {
        id: 'conn-1',
        restaurant_id: 'rest-1',
        report_base_url: 'https://mfprod-1.myfocuspos.com',
        report_path: '/ReportServer?/generalstorereports/revenuecenter',
        store_id: '99999',
        db_server: 'mfaz-rep-1',
        db_catalog: 'KAHALA2',
        report_user_id: null,
        revenue_center: null,
        timezone: 'America/Chicago',
        last_sync_time: null,
        initial_sync_done: false,
        sync_cursor: 0,
        is_active: true,
        connection_status: 'connected',
        last_error: null,
        last_error_at: null,
        created_at: '2026-06-27T00:00:00Z',
        updated_at: '2026-06-27T00:00:00Z',
      };

      (supabase.from as any) = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: mockConnection, error: null }),
            }),
          }),
        }),
      });

      const { result } = renderHook(() => useFocusConnection('rest-1'), { wrapper });

      await waitFor(() => expect(result.current.isConnected).toBe(true));
      expect(result.current.connection).toEqual(mockConnection);
    });

    it('handles DB error (non-PGRST116) by throwing', async () => {
      (supabase.from as any) = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: { code: 'PGRST500', message: 'DB error' },
              }),
            }),
          }),
        }),
      });

      const { result } = renderHook(() => useFocusConnection('rest-1'), { wrapper });

      await waitFor(() => expect(result.current.error).toBeTruthy());
      expect(result.current.isConnected).toBe(false);
    });
  });

  // ---- saveConnection ----

  describe('saveConnection', () => {
    it('invokes focus-save-connection edge function with apiKey, apiSecret, storeId (restaurantGuid), environment', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({ data: { success: true }, error: null });
      (supabase.functions.invoke as any) = mockInvoke;

      (supabase.from as any) = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      });

      const { result } = renderHook(() => useFocusConnection('rest-1'), { wrapper });

      await act(async () => {
        await result.current.saveConnection(
          'rest-1',
          'test-api-key',
          'test-api-secret',
          'aaaabbbb-cccc-dddd-eeee-ffffgggghhhh',
          'production',
        );
      });

      expect(mockInvoke).toHaveBeenCalledWith('focus-save-connection', {
        body: {
          restaurantId: 'rest-1',
          apiKey: 'test-api-key',
          apiSecret: 'test-api-secret',
          restaurantGuid: 'aaaabbbb-cccc-dddd-eeee-ffffgggghhhh',
          environment: 'production',
        },
      });
    });

    it('defaults environment to "production" when not specified', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({ data: { success: true }, error: null });
      (supabase.functions.invoke as any) = mockInvoke;

      (supabase.from as any) = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      });

      const { result } = renderHook(() => useFocusConnection('rest-1'), { wrapper });

      await act(async () => {
        await result.current.saveConnection(
          'rest-1',
          'test-api-key',
          'test-api-secret',
          'aaaabbbb-cccc-dddd-eeee-ffffgggghhhh',
          // no environment
        );
      });

      const callBody = (mockInvoke.mock.calls[0][1] as { body: Record<string, unknown> }).body;
      expect(callBody.environment).toBe('production');
    });

    it('throws when invoke returns a network/FunctionsHttpError (error shape 1)', async () => {
      // Error shape 1: invoke itself rejects (network failure, timeout, etc.)
      (supabase.functions.invoke as any) = vi.fn().mockRejectedValueOnce(
        new Error('Network request failed')
      );

      const { result } = renderHook(() => useFocusConnection('rest-1'), { wrapper });

      await act(async () => {
        await expect(
          result.current.saveConnection('rest-1', 'sample.user', 'test-pass', '99999')
        ).rejects.toThrow('Network request failed');
      });
    });

    it('throws when invoke resolves with {data:null, error:{message}} (error shape 2)', async () => {
      // Error shape 2: HTTP error returned as {data:null, error:{message:'...'}} (lesson 2026-05-16)
      (supabase.functions.invoke as any) = vi.fn().mockResolvedValueOnce({
        data: null,
        error: { message: '500 Internal Server Error' },
      });

      const { result } = renderHook(() => useFocusConnection('rest-1'), { wrapper });

      await act(async () => {
        await expect(
          result.current.saveConnection('rest-1', 'sample.user', 'test-pass', '99999')
        ).rejects.toThrow();
      });
    });
  });

  // ---- testConnection ----

  describe('testConnection', () => {
    it('invokes focus-test-connection with restaurantId', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        data: { success: true, status: 'connected' },
        error: null,
      });
      (supabase.functions.invoke as any) = mockInvoke;

      const { result } = renderHook(() => useFocusConnection('rest-1'), { wrapper });

      await act(async () => {
        const res = await result.current.testConnection('rest-1');
        expect(res.success).toBe(true);
        expect(res.status).toBe('connected');
      });

      expect(mockInvoke).toHaveBeenCalledWith('focus-test-connection', {
        body: { restaurantId: 'rest-1' },
      });
    });

    it('throws when invoke rejects (error shape 1)', async () => {
      (supabase.functions.invoke as any) = vi.fn().mockRejectedValueOnce(
        new Error('Connection timed out')
      );

      const { result } = renderHook(() => useFocusConnection('rest-1'), { wrapper });

      await act(async () => {
        await expect(result.current.testConnection('rest-1')).rejects.toThrow(
          'Connection timed out'
        );
      });
    });

    it('throws when invoke resolves with error (error shape 2)', async () => {
      (supabase.functions.invoke as any) = vi.fn().mockResolvedValueOnce({
        data: null,
        error: { message: '403 Forbidden' },
      });

      const { result } = renderHook(() => useFocusConnection('rest-1'), { wrapper });

      await act(async () => {
        await expect(result.current.testConnection('rest-1')).rejects.toThrow();
      });
    });
  });

  // ---- disconnect ----

  describe('disconnect', () => {
    it('sets is_active=false on focus_connections', async () => {
      const eqMock = vi.fn().mockResolvedValue({ error: null });
      const updateMock = vi.fn().mockReturnValue({ eq: eqMock });

      (supabase.from as any) = vi.fn().mockReturnValue({ update: updateMock });

      const { result } = renderHook(() => useFocusConnection('rest-1'), { wrapper });

      await act(async () => {
        await result.current.disconnect('rest-1');
      });

      expect(updateMock).toHaveBeenCalledWith({ is_active: false });
    });

    it('throws when disconnect DB update fails (error shape 1 — direct error)', async () => {
      const eqMock = vi.fn().mockResolvedValue({ error: { message: 'Row not found' } });
      const updateMock = vi.fn().mockReturnValue({ eq: eqMock });

      (supabase.from as any) = vi.fn().mockReturnValue({ update: updateMock });

      const { result } = renderHook(() => useFocusConnection('rest-1'), { wrapper });

      await act(async () => {
        await expect(result.current.disconnect('rest-1')).rejects.toThrow();
      });
    });

    it('throws when disconnect DB call rejects (error shape 2 — thrown rejection)', async () => {
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockRejectedValueOnce(new Error('Network error')),
      });

      (supabase.from as any) = vi.fn().mockReturnValue({ update: updateMock });

      const { result } = renderHook(() => useFocusConnection('rest-1'), { wrapper });

      await act(async () => {
        await expect(result.current.disconnect('rest-1')).rejects.toThrow('Network error');
      });
    });
  });

  // ---- triggerManualSync ----

  describe('triggerManualSync', () => {
    it('invokes focus-sync-data edge function with restaurantId', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        data: { syncCursor: 6, initialSyncDone: false, status: 'ok' },
        error: null,
      });
      (supabase.functions.invoke as any) = mockInvoke;

      (supabase.from as any) = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      });

      const { result } = renderHook(() => useFocusConnection('rest-1'), { wrapper });

      await act(async () => {
        const syncResult = await result.current.triggerManualSync('rest-1');
        expect(syncResult?.syncCursor).toBe(6);
        expect(syncResult?.initialSyncDone).toBe(false);
        expect(syncResult?.status).toBe('ok');
      });

      expect(mockInvoke).toHaveBeenCalledWith('focus-sync-data', {
        body: { restaurantId: 'rest-1' },
      });
    });

    it('throws when invoke rejects (error shape 1)', async () => {
      (supabase.functions.invoke as any) = vi.fn().mockRejectedValueOnce(
        new Error('Sync failed')
      );

      const { result } = renderHook(() => useFocusConnection('rest-1'), { wrapper });

      await act(async () => {
        await expect(result.current.triggerManualSync('rest-1')).rejects.toThrow('Sync failed');
      });
    });

    it('throws when invoke resolves with error (error shape 2)', async () => {
      (supabase.functions.invoke as any) = vi.fn().mockResolvedValueOnce({
        data: null,
        error: { message: '404 Not Found' },
      });

      const { result } = renderHook(() => useFocusConnection('rest-1'), { wrapper });

      await act(async () => {
        await expect(result.current.triggerManualSync('rest-1')).rejects.toThrow();
      });
    });

    // ---- A3: options passthrough ----

    it('spreads startDate and endDate options into the invoke body', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        data: { daysSynced: 3, status: 'ok' },
        error: null,
      });
      (supabase.functions.invoke as any) = mockInvoke;

      (supabase.from as any) = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      });

      const { result } = renderHook(() => useFocusConnection('rest-1'), { wrapper });

      await act(async () => {
        await result.current.triggerManualSync('rest-1', {
          startDate: '2026-01-01',
          endDate: '2026-01-03',
        });
      });

      expect(mockInvoke).toHaveBeenCalledWith('focus-sync-data', {
        body: {
          restaurantId: 'rest-1',
          startDate: '2026-01-01',
          endDate: '2026-01-03',
        },
      });
    });

    it('omits optional date fields from body when options not provided', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        data: { syncCursor: 1, status: 'ok' },
        error: null,
      });
      (supabase.functions.invoke as any) = mockInvoke;

      (supabase.from as any) = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      });

      const { result } = renderHook(() => useFocusConnection('rest-1'), { wrapper });

      await act(async () => {
        await result.current.triggerManualSync('rest-1');
      });

      const body = (mockInvoke.mock.calls[0][1] as { body: Record<string, unknown> }).body;
      expect(body).not.toHaveProperty('startDate');
      expect(body).not.toHaveProperty('endDate');
    });
  });

  // ---- A3: FocusRestaurantOption type is exported ----

  describe('FocusRestaurantOption type', () => {
    it('is exported from the hook module and has restaurant_guid and restaurant_name', () => {
      // TypeScript compile-time check: if FocusRestaurantOption was not exported the import above
      // would have already failed. Here we verify the shape structurally.
      const example: FocusRestaurantOption = {
        restaurant_guid: 'abc-123',
        restaurant_name: 'Test Restaurant',
      };
      expect(example.restaurant_guid).toBe('abc-123');
      expect(example.restaurant_name).toBe('Test Restaurant');
    });
  });

  // ---- A3: listRestaurants mutation ----

  describe('listRestaurants', () => {
    const mockFrom = () => {
      (supabase.from as any) = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      });
    };

    it('invokes focus-list-restaurants with restaurantId, apiKey, apiSecret, environment', async () => {
      const restaurants: FocusRestaurantOption[] = [
        { restaurant_guid: 'guid-1', restaurant_name: 'Café A' },
      ];
      const mockInvoke = vi.fn().mockResolvedValue({
        data: { success: true, restaurants },
        error: null,
      });
      (supabase.functions.invoke as any) = mockInvoke;
      mockFrom();

      const { result } = renderHook(() => useFocusConnection('rest-1'), { wrapper });

      let returned: FocusRestaurantOption[] | undefined;
      await act(async () => {
        returned = await result.current.listRestaurants('rest-1', 'key-1', 'sec-1', 'production');
      });

      expect(mockInvoke).toHaveBeenCalledWith('focus-list-restaurants', {
        body: {
          restaurantId: 'rest-1',
          apiKey: 'key-1',
          apiSecret: 'sec-1',
          environment: 'production',
        },
      });
      expect(returned).toEqual(restaurants);
    });

    it('defaults environment to "production" when omitted', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        data: { success: true, restaurants: [] },
        error: null,
      });
      (supabase.functions.invoke as any) = mockInvoke;
      mockFrom();

      const { result } = renderHook(() => useFocusConnection('rest-1'), { wrapper });

      await act(async () => {
        await result.current.listRestaurants('rest-1', 'key-1', 'sec-1');
      });

      const body = (mockInvoke.mock.calls[0][1] as { body: Record<string, unknown> }).body;
      expect(body.environment).toBe('production');
    });

    it('returns empty array when restaurants field is absent from response', async () => {
      (supabase.functions.invoke as any) = vi.fn().mockResolvedValue({
        data: { success: true },
        error: null,
      });
      mockFrom();

      const { result } = renderHook(() => useFocusConnection('rest-1'), { wrapper });

      let returned: FocusRestaurantOption[] | undefined;
      await act(async () => {
        returned = await result.current.listRestaurants('rest-1', 'k', 's');
      });

      expect(returned).toEqual([]);
    });

    it('throws when invoke rejects (error shape 1 — transport failure)', async () => {
      (supabase.functions.invoke as any) = vi.fn().mockRejectedValueOnce(
        new Error('Network request failed'),
      );
      mockFrom();

      const { result } = renderHook(() => useFocusConnection('rest-1'), { wrapper });

      await act(async () => {
        await expect(
          result.current.listRestaurants('rest-1', 'k', 's'),
        ).rejects.toThrow('Network request failed');
      });
    });

    it('throws when invoke resolves with {data:null, error:{message}} (error shape 2 — HTTP error)', async () => {
      (supabase.functions.invoke as any) = vi.fn().mockResolvedValueOnce({
        data: null,
        error: { message: '401 Unauthorized' },
      });
      mockFrom();

      const { result } = renderHook(() => useFocusConnection('rest-1'), { wrapper });

      await act(async () => {
        await expect(
          result.current.listRestaurants('rest-1', 'k', 's'),
        ).rejects.toThrow();
      });
    });

    it('throws when data.error is set (Focus-side error message from §4.1 §8)', async () => {
      (supabase.functions.invoke as any) = vi.fn().mockResolvedValueOnce({
        data: { success: false, error: 'check your API Key and Secret' },
        error: null,
      });
      mockFrom();

      const { result } = renderHook(() => useFocusConnection('rest-1'), { wrapper });

      await act(async () => {
        await expect(
          result.current.listRestaurants('rest-1', 'k', 's'),
        ).rejects.toThrow('check your API Key and Secret');
      });
    });
  });

  // ---- A3: refetchInterval conditional polling ----

  describe('refetchInterval polling logic', () => {
    // We cannot easily assert the refetchInterval callback directly from renderHook
    // because React Query evaluates it internally. Instead we exercise the hook with
    // different connection states and verify the query key / staleTime contract.
    // The refetchInterval guard is a unit-testable function extracted from the query
    // config; we expose it for testing via a named export `__focusRefetchInterval`.

    it('the hook exposes a __focusRefetchInterval test-helper function', async () => {
      // This will fail until we add the named export — that is the RED assertion.
      const { __focusRefetchInterval } = await import('@/hooks/useFocusConnection');
      expect(typeof __focusRefetchInterval).toBe('function');
    });

    it('returns 8000 when data is present, not done, active, and not errored', async () => {
      const { __focusRefetchInterval } = await import('@/hooks/useFocusConnection');
      const fakeQuery = {
        state: {
          data: { initial_sync_done: false, is_active: true, connection_status: 'syncing' },
        },
      };
      expect(__focusRefetchInterval(fakeQuery as any)).toBe(8000);
    });

    it('returns false when initial_sync_done is true', async () => {
      const { __focusRefetchInterval } = await import('@/hooks/useFocusConnection');
      const fakeQuery = {
        state: {
          data: { initial_sync_done: true, is_active: true, connection_status: 'connected' },
        },
      };
      expect(__focusRefetchInterval(fakeQuery as any)).toBe(false);
    });

    it('returns false when is_active is false (disconnected)', async () => {
      const { __focusRefetchInterval } = await import('@/hooks/useFocusConnection');
      const fakeQuery = {
        state: {
          data: { initial_sync_done: false, is_active: false, connection_status: 'syncing' },
        },
      };
      expect(__focusRefetchInterval(fakeQuery as any)).toBe(false);
    });

    it('returns false when connection_status is "error"', async () => {
      const { __focusRefetchInterval } = await import('@/hooks/useFocusConnection');
      const fakeQuery = {
        state: {
          data: { initial_sync_done: false, is_active: true, connection_status: 'error' },
        },
      };
      expect(__focusRefetchInterval(fakeQuery as any)).toBe(false);
    });

    it('returns false when data is null (no connection row)', async () => {
      const { __focusRefetchInterval } = await import('@/hooks/useFocusConnection');
      const fakeQuery = { state: { data: null } };
      expect(__focusRefetchInterval(fakeQuery as any)).toBe(false);
    });

    it('returns false when data is undefined (query pending)', async () => {
      const { __focusRefetchInterval } = await import('@/hooks/useFocusConnection');
      const fakeQuery = { state: { data: undefined } };
      expect(__focusRefetchInterval(fakeQuery as any)).toBe(false);
    });
  });
});
