import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useCheckBankAccounts } from '../../src/hooks/useCheckBankAccounts';

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

/**
 * The query chain calls .order() twice: once for is_default, once for account_name.
 * The first call must return `this` (the chain), the second resolves with data.
 * We use a counter so the last .order() call resolves the promise.
 */
function setupOrderChain(data: unknown[] | null, error: Error | null = null) {
  let orderCallCount = 0;
  mockFromChain.order.mockImplementation(() => {
    orderCallCount++;
    if (orderCallCount >= 2) {
      // Last .order() call — resolve with data
      return Promise.resolve({ data, error });
    }
    // First call — return chain for continued chaining
    return mockFromChain;
  });
}

beforeEach(() => {
  vi.clearAllMocks();

  mockFromChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'acc-1', account_name: 'Main' }, error: null }),
  };

  mockSupabase.from.mockReturnValue(mockFromChain);

  // Default: query returns empty array
  setupOrderChain([]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useCheckBankAccounts', () => {
  describe('query', () => {
    it('fetches active accounts for the restaurant, ordered by default first', async () => {
      const mockAccounts = [
        {
          id: 'acc-1',
          restaurant_id: 'rest-123',
          account_name: 'Main Account',
          bank_name: 'Chase',
          connected_bank_id: null,
          next_check_number: 1001,
          is_default: true,
          is_active: true,
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
        },
        {
          id: 'acc-2',
          restaurant_id: 'rest-123',
          account_name: 'Payroll',
          bank_name: 'Wells Fargo',
          connected_bank_id: null,
          next_check_number: 5001,
          is_default: false,
          is_active: true,
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
        },
      ];
      setupOrderChain(mockAccounts);

      const { result } = renderHook(() => useCheckBankAccounts(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.accounts).toEqual(mockAccounts);
      expect(result.current.error).toBeNull();
      expect(mockSupabase.from).toHaveBeenCalledWith('check_bank_accounts');
      // Verify it filters by restaurant_id and is_active
      expect(mockFromChain.eq).toHaveBeenCalledWith('restaurant_id', 'rest-123');
      expect(mockFromChain.eq).toHaveBeenCalledWith('is_active', true);
    });

    it('returns empty array when no accounts exist', async () => {
      setupOrderChain([]);

      const { result } = renderHook(() => useCheckBankAccounts(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.accounts).toEqual([]);
    });

    it('handles query errors', async () => {
      const mockError = new Error('Database error');
      setupOrderChain(null, mockError);

      const { result } = renderHook(() => useCheckBankAccounts(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
      });
    });
  });

  describe('saveAccount mutation', () => {
    it('inserts a new account when no id is provided', async () => {
      const savedData = {
        id: 'acc-new',
        restaurant_id: 'rest-123',
        account_name: 'New Account',
        bank_name: 'Chase',
        next_check_number: 1001,
        is_default: false,
        is_active: true,
      };
      mockFromChain.single.mockResolvedValue({ data: savedData, error: null });

      const { result } = renderHook(() => useCheckBankAccounts(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.saveAccount.mutateAsync({
          account_name: 'New Account',
          bank_name: 'Chase',
        });
      });

      expect(mockFromChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          restaurant_id: 'rest-123',
          account_name: 'New Account',
          bank_name: 'Chase',
        }),
      );
      // Should NOT call update
      expect(mockFromChain.update).not.toHaveBeenCalled();
    });

    it('updates an existing account when id is provided', async () => {
      const savedData = {
        id: 'acc-1',
        restaurant_id: 'rest-123',
        account_name: 'Updated Account',
        bank_name: 'Chase',
        next_check_number: 1001,
        is_default: true,
        is_active: true,
      };
      mockFromChain.single.mockResolvedValue({ data: savedData, error: null });

      const { result } = renderHook(() => useCheckBankAccounts(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.saveAccount.mutateAsync({
          id: 'acc-1',
          account_name: 'Updated Account',
        });
      });

      expect(mockFromChain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          account_name: 'Updated Account',
        }),
      );
      // Should NOT call insert
      expect(mockFromChain.insert).not.toHaveBeenCalled();
    });

    it('handles save errors', async () => {
      const mockError = new Error('Insert failed');
      mockFromChain.single.mockResolvedValue({ data: null, error: mockError });

      const { result } = renderHook(() => useCheckBankAccounts(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await expect(
        act(() =>
          result.current.saveAccount.mutateAsync({
            account_name: 'Bad Account',
          }),
        ),
      ).rejects.toThrow();
    });
  });

  describe('deleteAccount mutation', () => {
    it('soft-deletes an account by setting is_active to false', async () => {
      mockFromChain.eq.mockResolvedValue({ error: null });

      const { result } = renderHook(() => useCheckBankAccounts(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.deleteAccount.mutateAsync('acc-1');
      });

      expect(mockFromChain.update).toHaveBeenCalledWith({ is_active: false });
      expect(mockFromChain.eq).toHaveBeenCalledWith('id', 'acc-1');
    });

    it('handles delete errors', async () => {
      // For soft-delete path: .update().eq() should return error
      mockFromChain.eq.mockResolvedValue({ error: new Error('Delete failed') });

      const { result } = renderHook(() => useCheckBankAccounts(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await expect(
        act(() => result.current.deleteAccount.mutateAsync('acc-1')),
      ).rejects.toThrow();
    });
  });

  describe('claimCheckNumbers mutation', () => {
    it('calls RPC with accountId and count, returns start number', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: 1001, error: null });

      const { result } = renderHook(() => useCheckBankAccounts(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      let startNumber: number | undefined;
      await act(async () => {
        startNumber = await result.current.claimCheckNumbers.mutateAsync({
          accountId: 'acc-1',
          count: 3,
        });
      });

      expect(startNumber).toBe(1001);
      expect(mockSupabase.rpc).toHaveBeenCalledWith('claim_check_numbers_for_account', {
        p_account_id: 'acc-1',
        p_count: 3,
      });
    });

    it('throws on RPC error', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: null, error: new Error('RPC failed') });

      const { result } = renderHook(() => useCheckBankAccounts(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await expect(
        act(() =>
          result.current.claimCheckNumbers.mutateAsync({
            accountId: 'acc-1',
            count: 1,
          }),
        ),
      ).rejects.toThrow();
    });

    it('throws when RPC returns non-number data', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

      const { result } = renderHook(() => useCheckBankAccounts(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await expect(
        act(() =>
          result.current.claimCheckNumbers.mutateAsync({
            accountId: 'acc-1',
            count: 1,
          }),
        ),
      ).rejects.toThrow('Failed to claim check numbers');
    });
  });

  describe('defaultAccount', () => {
    it('returns the is_default account', async () => {
      const mockAccounts = [
        { id: 'acc-1', account_name: 'Main', is_default: true, is_active: true },
        { id: 'acc-2', account_name: 'Payroll', is_default: false, is_active: true },
      ];
      setupOrderChain(mockAccounts);

      const { result } = renderHook(() => useCheckBankAccounts(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.defaultAccount).toEqual(
        expect.objectContaining({ id: 'acc-1', is_default: true }),
      );
    });

    it('returns the first account if none is marked default', async () => {
      const mockAccounts = [
        { id: 'acc-2', account_name: 'Payroll', is_default: false, is_active: true },
        { id: 'acc-3', account_name: 'Savings', is_default: false, is_active: true },
      ];
      setupOrderChain(mockAccounts);

      const { result } = renderHook(() => useCheckBankAccounts(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.defaultAccount).toEqual(
        expect.objectContaining({ id: 'acc-2' }),
      );
    });

    it('returns null when accounts list is empty', async () => {
      setupOrderChain([]);

      const { result } = renderHook(() => useCheckBankAccounts(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.defaultAccount).toBeNull();
    });
  });
});
