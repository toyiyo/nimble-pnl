import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useSlingConnection } from '../../src/hooks/useSlingConnection';

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

const RESTAURANT_ID = 'rest-abc-123';

const mockConnection = {
  id: 'conn-1',
  restaurant_id: RESTAURANT_ID,
  email: 'test@sling.com',
  sling_org_id: 42,
  sling_org_name: 'Test Org',
  last_sync_time: '2026-01-15T00:00:00Z',
  initial_sync_done: true,
  sync_cursor: 5,
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

describe('useSlingConnection', () => {
  // =========================================================================
  // Query tests
  // =========================================================================
  describe('query', () => {
    it('returns null and does not fetch when restaurantId is null', async () => {
      const { result } = renderHook(() => useSlingConnection(null), {
        wrapper: createWrapper(),
      });

      // With enabled: false, isLoading should be false and no fetch occurs
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.connection).toBeUndefined();
      expect(result.current.isConnected).toBe(false);
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('returns null and does not fetch when restaurantId is undefined', async () => {
      const { result } = renderHook(() => useSlingConnection(undefined), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.connection).toBeUndefined();
      expect(result.current.isConnected).toBe(false);
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('fetches connection when restaurantId is provided', async () => {
      mockFromChain.maybeSingle.mockResolvedValue({
        data: mockConnection,
        error: null,
      });

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockSupabase.from).toHaveBeenCalledWith('sling_connections');
      expect(mockFromChain.select).toHaveBeenCalledWith(
        'id, restaurant_id, email, sling_org_id, sling_org_name, last_sync_time, initial_sync_done, sync_cursor, is_active, connection_status, last_error, last_error_at, created_at, updated_at'
      );
      expect(mockFromChain.eq).toHaveBeenCalledWith('restaurant_id', RESTAURANT_ID);
      expect(mockFromChain.eq).toHaveBeenCalledWith('is_active', true);
      expect(result.current.connection).toEqual(mockConnection);
    });

    it('returns isConnected=true when connection exists', async () => {
      mockFromChain.maybeSingle.mockResolvedValue({
        data: mockConnection,
        error: null,
      });

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.isConnected).toBe(true);
    });

    it('returns isConnected=false when no connection found', async () => {
      mockFromChain.maybeSingle.mockResolvedValue({
        data: null,
        error: null,
      });

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.isConnected).toBe(false);
      expect(result.current.connection).toBeNull();
    });

    it('handles PGRST116 error gracefully (row not found)', async () => {
      mockFromChain.maybeSingle.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'No rows found' },
      });

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // PGRST116 should be swallowed, returning null
      expect(result.current.connection).toBeNull();
      expect(result.current.isConnected).toBe(false);
    });

    it('throws on non-PGRST116 errors', async () => {
      mockFromChain.maybeSingle.mockResolvedValue({
        data: null,
        error: { code: '42P01', message: 'relation does not exist' },
      });

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // React Query should capture the thrown error
      // connection should remain undefined (query failed)
      expect(result.current.connection).toBeUndefined();
    });
  });

  // =========================================================================
  // saveCredentials tests
  // =========================================================================
  describe('saveCredentials', () => {
    it('invokes sling-save-credentials edge function with correct params', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { success: true },
        error: null,
      });

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.saveCredentials(RESTAURANT_ID, 'user@test.com', 'secret123');
      });

      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith('sling-save-credentials', {
        body: {
          restaurantId: RESTAURANT_ID,
          email: 'user@test.com',
          password: 'secret123',
        },
      });
    });

    it('invalidates query cache on success', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { success: true },
        error: null,
      });

      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 0 },
          mutations: { retry: false },
        },
      });
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(QueryClientProvider, { client: queryClient }, children);

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.saveCredentials(RESTAURANT_ID, 'user@test.com', 'secret123');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['sling-connection', RESTAURANT_ID],
      });
    });

    it('shows success toast on save', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { success: true },
        error: null,
      });

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.saveCredentials(RESTAURANT_ID, 'user@test.com', 'secret123');
      });

      expect(mockToast).toHaveBeenCalledWith({
        title: 'Credentials saved',
        description: 'Sling credentials have been saved successfully',
      });
    });

    it('throws when edge function returns transport error', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: null,
        error: new Error('Network error'),
      });

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(
        act(() => result.current.saveCredentials(RESTAURANT_ID, 'user@test.com', 'secret123'))
      ).rejects.toThrow('Network error');
    });

    it('throws when data contains error field', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { error: 'Invalid credentials' },
        error: null,
      });

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(
        act(() => result.current.saveCredentials(RESTAURANT_ID, 'user@test.com', 'wrong'))
      ).rejects.toThrow('Invalid credentials');
    });
  });

  // =========================================================================
  // testConnection tests
  // =========================================================================
  describe('testConnection', () => {
    it('invokes sling-test-connection with restaurantId only', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { success: true, orgName: 'My Org' },
        error: null,
      });

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.testConnection(RESTAURANT_ID);
      });

      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith('sling-test-connection', {
        body: { restaurantId: RESTAURANT_ID },
      });
    });

    it('passes slingOrgId when provided', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { success: true, orgName: 'Org 42' },
        error: null,
      });

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.testConnection(RESTAURANT_ID, 42);
      });

      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith('sling-test-connection', {
        body: { restaurantId: RESTAURANT_ID, slingOrgId: 42 },
      });
    });

    it('returns data with needsOrgSelection without showing toast', async () => {
      const orgSelectionData = {
        needsOrgSelection: true,
        organizations: [
          { id: 1, name: 'Org A' },
          { id: 2, name: 'Org B' },
        ],
      };

      mockSupabase.functions.invoke.mockResolvedValue({
        data: orgSelectionData,
        error: null,
      });

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      let response: Record<string, unknown> | undefined;
      await act(async () => {
        response = await result.current.testConnection(RESTAURANT_ID);
      });

      expect(response).toEqual(orgSelectionData);
      // Toast should NOT have been called for needsOrgSelection
      expect(mockToast).not.toHaveBeenCalled();
    });

    it('shows toast and invalidates cache on successful connection', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { success: true, orgName: 'My Restaurant' },
        error: null,
      });

      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 0 },
          mutations: { retry: false },
        },
      });
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(QueryClientProvider, { client: queryClient }, children);

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.testConnection(RESTAURANT_ID);
      });

      expect(mockToast).toHaveBeenCalledWith({
        title: 'Connection successful',
        description: 'Connected to My Restaurant',
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['sling-connection', RESTAURANT_ID],
      });
    });

    it('uses fallback "Sling" in toast when orgName is absent', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { success: true },
        error: null,
      });

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.testConnection(RESTAURANT_ID);
      });

      expect(mockToast).toHaveBeenCalledWith({
        title: 'Connection successful',
        description: 'Connected to Sling',
      });
    });

    it('throws when data has neither success nor needsOrgSelection', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { somethingElse: true },
        error: null,
      });

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(
        act(() => result.current.testConnection(RESTAURANT_ID))
      ).rejects.toThrow('Connection test failed');
    });

    it('throws when data contains error field', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { error: 'Authentication failed' },
        error: null,
      });

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(
        act(() => result.current.testConnection(RESTAURANT_ID))
      ).rejects.toThrow('Authentication failed');
    });

    it('throws when edge function returns transport error', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: null,
        error: new Error('Function timeout'),
      });

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(
        act(() => result.current.testConnection(RESTAURANT_ID))
      ).rejects.toThrow('Function timeout');
    });
  });

  // =========================================================================
  // disconnectSling tests
  // =========================================================================
  describe('disconnectSling', () => {
    it('calls supabase update to set is_active=false', async () => {
      mockFromChain.eq.mockResolvedValue({ error: null });

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.disconnectSling(RESTAURANT_ID);
      });

      expect(mockSupabase.from).toHaveBeenCalledWith('sling_connections');
      expect(mockFromChain.update).toHaveBeenCalledWith({ is_active: false });
      expect(mockFromChain.eq).toHaveBeenCalledWith('restaurant_id', RESTAURANT_ID);
    });

    it('shows success toast on disconnect', async () => {
      mockFromChain.eq.mockResolvedValue({ error: null });

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.disconnectSling(RESTAURANT_ID);
      });

      expect(mockToast).toHaveBeenCalledWith({
        title: 'Disconnected',
        description: 'Sling connection has been disabled',
      });
    });

    it('shows error toast on failure', async () => {
      mockFromChain.eq.mockResolvedValue({ error: new Error('Update failed') });

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // mutateAsync rejects, but onError fires asynchronously after
      try {
        await act(async () => {
          await result.current.disconnectSling(RESTAURANT_ID);
        });
      } catch {
        // expected rejection
      }

      // Wait for the onError callback to fire the toast
      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: 'Error',
          description: 'Failed to disconnect from Sling',
          variant: 'destructive',
        });
      });
    });
  });

  // =========================================================================
  // triggerManualSync tests
  // =========================================================================
  describe('triggerManualSync', () => {
    it('invokes sling-sync-data with restaurantId only', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { shiftsSynced: 5, timesheetsSynced: 3 },
        error: null,
      });

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.triggerManualSync(RESTAURANT_ID);
      });

      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith('sling-sync-data', {
        body: { restaurantId: RESTAURANT_ID },
      });
    });

    it('passes startDate and endDate when provided', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { shiftsSynced: 10, timesheetsSynced: 8 },
        error: null,
      });

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.triggerManualSync(RESTAURANT_ID, {
          startDate: '2026-01-01',
          endDate: '2026-01-31',
        });
      });

      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith('sling-sync-data', {
        body: {
          restaurantId: RESTAURANT_ID,
          startDate: '2026-01-01',
          endDate: '2026-01-31',
        },
      });
    });

    it('passes mode when provided', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { shiftsSynced: 2, timesheetsSynced: 1 },
        error: null,
      });

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.triggerManualSync(RESTAURANT_ID, { mode: 'initial' });
      });

      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith('sling-sync-data', {
        body: {
          restaurantId: RESTAURANT_ID,
          mode: 'initial',
        },
      });
    });

    it('shows toast for non-custom sync (no startDate)', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { shiftsSynced: 5, timesheetsSynced: 3 },
        error: null,
      });

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.triggerManualSync(RESTAURANT_ID);
      });

      expect(mockToast).toHaveBeenCalledWith({
        title: 'Sync initiated',
        description: 'Synced 5 shifts and 3 timesheets',
      });
    });

    it('does NOT show toast when startDate is provided (custom range)', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { shiftsSynced: 10, timesheetsSynced: 8 },
        error: null,
      });

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.triggerManualSync(RESTAURANT_ID, {
          startDate: '2026-01-01',
          endDate: '2026-01-31',
        });
      });

      expect(mockToast).not.toHaveBeenCalled();
    });

    it('uses 0 as fallback in toast when sync counts are missing', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: {},
        error: null,
      });

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.triggerManualSync(RESTAURANT_ID);
      });

      expect(mockToast).toHaveBeenCalledWith({
        title: 'Sync initiated',
        description: 'Synced 0 shifts and 0 timesheets',
      });
    });

    it('invalidates cache after sync', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { shiftsSynced: 1, timesheetsSynced: 1 },
        error: null,
      });

      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 0 },
          mutations: { retry: false },
        },
      });
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(QueryClientProvider, { client: queryClient }, children);

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.triggerManualSync(RESTAURANT_ID);
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['sling-connection', RESTAURANT_ID],
      });
    });

    it('throws when edge function returns transport error', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: null,
        error: new Error('Edge function timeout'),
      });

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(
        act(() => result.current.triggerManualSync(RESTAURANT_ID))
      ).rejects.toThrow('Edge function timeout');
    });

    it('throws when data contains error field', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { error: 'Sync failed: no active connection' },
        error: null,
      });

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(
        act(() => result.current.triggerManualSync(RESTAURANT_ID))
      ).rejects.toThrow('Sync failed: no active connection');
    });

    it('returns the sync data on success', async () => {
      const syncResult = { shiftsSynced: 12, timesheetsSynced: 7, status: 'complete' };
      mockSupabase.functions.invoke.mockResolvedValue({
        data: syncResult,
        error: null,
      });

      const { result } = renderHook(() => useSlingConnection(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      let response: Record<string, unknown> | null | undefined;
      await act(async () => {
        response = await result.current.triggerManualSync(RESTAURANT_ID);
      });

      expect(response).toEqual(syncResult);
    });
  });
});
