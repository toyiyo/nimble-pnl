import React, { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSyncBankTransactions } from '@/hooks/useSyncBankTransactions';

// See docs/superpowers/specs/2026-07-23-bank-reauth-flow-design.md §5.3
// ("useSyncBankTransactions.tsx") and the Task 12 RED list in
// docs/superpowers/plans/2026-07-23-bank-reauth-flow-plan.md.

const mockInvoke = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: mockInvoke },
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { Wrapper, queryClient };
}

function mockSyncResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      success: true,
      synced: 0,
      skipped: 0,
      total: 0,
      accounts: [],
      needsReauth: [],
      message: undefined,
      ...overrides,
    },
    error: null,
  };
}

function mockBalanceResponse(overrides: Record<string, unknown> = {}) {
  return { data: { refreshed: 1, ...overrides }, error: null };
}

describe('useSyncBankTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a destructive toast naming the bank when an account needs reauth', async () => {
    mockInvoke
      .mockResolvedValueOnce(mockSyncResponse({ needsReauth: ['acct_123'] }))
      .mockResolvedValueOnce(mockBalanceResponse());

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useSyncBankTransactions(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ bankId: 'bank-1', institutionName: 'Northgate Savings & Trust' });
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
        description: expect.stringContaining('Northgate Savings & Trust'),
      }),
    );
    // Never claims success when reconnection is required.
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Sync complete' }),
    );
  });

  it('shows a neutral "No new transactions" toast when nothing synced and nothing needs reauth', async () => {
    mockInvoke
      .mockResolvedValueOnce(mockSyncResponse({ synced: 0, needsReauth: [] }))
      .mockResolvedValueOnce(mockBalanceResponse());

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useSyncBankTransactions(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ bankId: 'bank-1', institutionName: 'Northgate Savings & Trust' });
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'No new transactions' }),
    );
    const call = mockToast.mock.calls.find(([arg]) => arg.title === 'No new transactions')?.[0];
    expect(call?.variant).not.toBe('destructive');
  });

  it('shows a success toast carrying the real count when transactions synced', async () => {
    mockInvoke
      .mockResolvedValueOnce(mockSyncResponse({ synced: 7, needsReauth: [] }))
      .mockResolvedValueOnce(mockBalanceResponse());

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useSyncBankTransactions(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ bankId: 'bank-1', institutionName: 'Northgate Savings & Trust' });
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Sync complete',
        description: expect.stringContaining('7'),
      }),
    );
  });

  it('invalidates both connectedBanks and connected-banks caches on success', async () => {
    mockInvoke
      .mockResolvedValueOnce(mockSyncResponse({ synced: 2, needsReauth: [] }))
      .mockResolvedValueOnce(mockBalanceResponse());

    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useSyncBankTransactions(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ bankId: 'bank-1', institutionName: 'Northgate Savings & Trust' });
    });

    const invalidatedKeys = invalidateSpy.mock.calls.map(([arg]) => (arg as { queryKey: unknown[] }).queryKey[0]);
    expect(invalidatedKeys).toContain('connectedBanks');
    expect(invalidatedKeys).toContain('connected-banks');
  });

  it('prioritizes the reauth toast over a partial synced count from healthy sibling accounts', async () => {
    mockInvoke
      .mockResolvedValueOnce(mockSyncResponse({ synced: 3, needsReauth: ['acct_999'] }))
      .mockResolvedValueOnce(mockBalanceResponse());

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useSyncBankTransactions(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ bankId: 'bank-1', institutionName: 'Northgate Savings & Trust' });
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Sync complete' }),
    );
  });

  it('shows a destructive failure toast when the sync call itself errors', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: { message: 'Network error' } });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useSyncBankTransactions(), { wrapper: Wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ bankId: 'bank-1', institutionName: 'Northgate Savings & Trust' }),
      ).rejects.toThrow();
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Sync failed', variant: 'destructive' }),
    );
  });
});
