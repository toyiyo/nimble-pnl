import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useCheckAuditLog } from '../../src/hooks/useCheckAuditLog';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  auth: {
    getUser: vi.fn(),
  },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'rest-456' },
  }),
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
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    insert: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'audit-1' }, error: null }),
  };

  mockSupabase.from.mockReturnValue(mockFromChain);
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'user-789' } },
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useCheckAuditLog', () => {
  describe('query', () => {
    it('fetches audit log entries for the current restaurant', async () => {
      const mockEntries = [
        {
          id: 'entry-1',
          restaurant_id: 'rest-456',
          check_number: 1001,
          payee_name: 'Sysco',
          amount: 500.00,
          issue_date: '2025-06-15',
          memo: null,
          action: 'printed',
          performed_by: 'user-789',
          performed_at: '2025-06-15T10:00:00Z',
          pending_outflow_id: null,
          void_reason: null,
          created_at: '2025-06-15T10:00:00Z',
        },
      ];
      mockFromChain.limit.mockResolvedValue({ data: mockEntries, error: null });

      const { result } = renderHook(() => useCheckAuditLog(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.auditLog).toEqual(mockEntries);
      expect(mockSupabase.from).toHaveBeenCalledWith('check_audit_log');
      expect(mockFromChain.eq).toHaveBeenCalledWith('restaurant_id', 'rest-456');
      expect(mockFromChain.order).toHaveBeenCalledWith('performed_at', { ascending: false });
      expect(mockFromChain.limit).toHaveBeenCalledWith(500);
    });

    it('returns empty array when no entries exist', async () => {
      mockFromChain.limit.mockResolvedValue({ data: [], error: null });

      const { result } = renderHook(() => useCheckAuditLog(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.auditLog).toEqual([]);
    });

    it('returns empty array as default when query has not resolved', () => {
      // Don't resolve the mock — check default state
      const { result } = renderHook(() => useCheckAuditLog(), {
        wrapper: createWrapper(),
      });

      // Before resolution, auditLog defaults to []
      expect(result.current.auditLog).toEqual([]);
    });

    it('handles query errors', async () => {
      const mockError = new Error('Fetch failed');
      mockFromChain.limit.mockResolvedValue({ data: null, error: mockError });

      const { result } = renderHook(() => useCheckAuditLog(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // auditLog falls back to empty array on error
      expect(result.current.auditLog).toEqual([]);
    });
  });

  describe('logCheckAction mutation', () => {
    it('inserts an audit entry with correct data', async () => {
      const savedEntry = {
        id: 'audit-new',
        restaurant_id: 'rest-456',
        check_number: 1002,
        payee_name: 'US Foods',
        amount: 750.25,
        action: 'printed',
      };
      mockFromChain.single.mockResolvedValue({ data: savedEntry, error: null });

      const { result } = renderHook(() => useCheckAuditLog(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.logCheckAction.mutateAsync({
          check_number: 1002,
          payee_name: 'US Foods',
          amount: 750.25,
          issue_date: '2025-06-20',
          memo: 'Weekly order',
          action: 'printed',
        });
      });

      expect(mockSupabase.from).toHaveBeenCalledWith('check_audit_log');
      expect(mockFromChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          restaurant_id: 'rest-456',
          performed_by: 'user-789',
          check_number: 1002,
          payee_name: 'US Foods',
          amount: 750.25,
          action: 'printed',
        }),
      );
    });

    it('inserts a reprinted audit entry', async () => {
      mockFromChain.single.mockResolvedValue({
        data: { id: 'audit-reprint', action: 'reprinted' },
        error: null,
      });

      const { result } = renderHook(() => useCheckAuditLog(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.logCheckAction.mutateAsync({
          check_number: 1001,
          payee_name: 'Sysco',
          amount: 500,
          issue_date: '2025-06-15',
          action: 'reprinted',
        });
      });

      expect(mockFromChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'reprinted' }),
      );
    });

    it('inserts a voided audit entry with reason', async () => {
      mockFromChain.single.mockResolvedValue({
        data: { id: 'audit-void', action: 'voided' },
        error: null,
      });

      const { result } = renderHook(() => useCheckAuditLog(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.logCheckAction.mutateAsync({
          check_number: 1001,
          payee_name: 'Sysco',
          amount: 500,
          issue_date: '2025-06-15',
          action: 'voided',
          void_reason: 'Wrong amount',
        });
      });

      expect(mockFromChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'voided',
          void_reason: 'Wrong amount',
        }),
      );
    });

    it('handles insert errors gracefully (non-blocking)', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockError = new Error('Insert failed');
      mockFromChain.single.mockResolvedValue({ data: null, error: mockError });

      const { result } = renderHook(() => useCheckAuditLog(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // logCheckAction has onError that logs to console — mutation should not throw unhandled
      await act(async () => {
        try {
          await result.current.logCheckAction.mutateAsync({
            check_number: 1001,
            payee_name: 'Test',
            amount: 100,
            issue_date: '2025-01-01',
            action: 'printed',
          });
        } catch {
          // Expected — mutateAsync re-throws even with onError
        }
      });

      expect(consoleSpy).toHaveBeenCalledWith('Failed to log check action:', expect.any(Error));
      consoleSpy.mockRestore();
    });

    it('throws when user is not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });

      const { result } = renderHook(() => useCheckAuditLog(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await expect(
        act(() =>
          result.current.logCheckAction.mutateAsync({
            check_number: 1001,
            payee_name: 'Test',
            amount: 100,
            issue_date: '2025-01-01',
            action: 'printed',
          }),
        ),
      ).rejects.toThrow('User not authenticated');
    });
  });
});
