import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';

const rpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastInfo = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    info: (...args: unknown[]) => toastInfo(...args),
  },
}));

import { useBulkCategorizeTransactions } from '@/hooks/useBulkTransactionActions';

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

/** A `bulk_categorize_bank_transactions` RPC result, with overrides. */
function makeResult(
  overrides: Partial<{
    categorized_count: number;
    reclassified_count: number;
    unchanged_count: number;
    skipped: Array<{ id: string; reason: string }>;
  }> = {}
) {
  return {
    success: true,
    categorized_count: 0,
    reclassified_count: 0,
    unchanged_count: 0,
    skipped: [],
    ...overrides,
  };
}

describe('useBulkCategorizeTransactions', () => {
  beforeEach(() => {
    rpc.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    toastInfo.mockReset();
  });

  it('calls the RPC with the three p_ params', async () => {
    rpc.mockResolvedValue({ data: makeResult({ categorized_count: 2 }), error: null });
    const client = new QueryClient();
    const { result } = renderHook(() => useBulkCategorizeTransactions(), { wrapper: wrapper(client) });

    result.current.mutate({ transactionIds: ['t1', 't2'], categoryId: 'c1', restaurantId: 'r1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledWith('bulk_categorize_bank_transactions', {
      p_transaction_ids: ['t1', 't2'],
      p_category_id: 'c1',
      p_restaurant_id: 'r1',
    });
  });

  it('chunks 501 ids into two RPC calls and aggregates counts and skipped', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `t${i}`);
    rpc
      .mockResolvedValueOnce({
        data: makeResult({
          categorized_count: 490,
          reclassified_count: 5,
          unchanged_count: 3,
          skipped: [{ id: 't1', reason: 'reconciled' }],
        }),
        error: null,
      })
      .mockResolvedValueOnce({
        data: makeResult({ categorized_count: 1, skipped: [{ id: 't500', reason: 'closed_period' }] }),
        error: null,
      });
    const client = new QueryClient();
    const { result } = renderHook(() => useBulkCategorizeTransactions(), { wrapper: wrapper(client) });

    result.current.mutate({ transactionIds: ids, categoryId: 'c1', restaurantId: 'r1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_transaction_ids: ids.slice(0, 500) });
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_transaction_ids: ids.slice(500) });
    expect(result.current.data).toMatchObject({
      categorized_count: 491,
      reclassified_count: 5,
      unchanged_count: 3,
    });
    expect(result.current.data?.skipped).toHaveLength(2);
  });

  it('rejects the mutation on an RPC error and shows error.message in the toast', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'network unreachable' } });
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useBulkCategorizeTransactions(), { wrapper: wrapper(client) });

    result.current.mutate({ transactionIds: ['t1'], categoryId: 'c1', restaurantId: 'r1' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalled();
    const [, options] = toastError.mock.calls[0] as [string, { description?: string }];
    expect(options.description).toBe('network unreachable');
  });

  it('shows an error toast with grouped skip reasons and duration 10000', async () => {
    rpc.mockResolvedValue({
      data: makeResult({
        categorized_count: 1,
        skipped: [
          { id: 't1', reason: 'reconciled' },
          { id: 't2', reason: 'reconciled' },
          { id: 't3', reason: 'reconciled' },
          { id: 't4', reason: 'closed_period' },
          { id: 't5', reason: 'closed_period' },
        ],
      }),
      error: null,
    });
    const client = new QueryClient();
    const { result } = renderHook(() => useBulkCategorizeTransactions(), { wrapper: wrapper(client) });

    result.current.mutate({
      transactionIds: ['t1', 't2', 't3', 't4', 't5', 't6'],
      categoryId: 'c1',
      restaurantId: 'r1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const skipCall = toastError.mock.calls.find(([, options]) => (options as { duration?: number })?.duration === 10000);
    expect(skipCall).toBeTruthy();
    const [, options] = skipCall as [string, { description: string; duration: number }];
    expect(options.description).toContain('3 reconciled');
    expect(options.description).toContain('2 closed period');
  });

  it('invalidates bank-transactions, income-statement, balance-sheet, chart-of-accounts on success', async () => {
    rpc.mockResolvedValue({ data: makeResult({ categorized_count: 1 }), error: null });
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useBulkCategorizeTransactions(), { wrapper: wrapper(client) });

    result.current.mutate({ transactionIds: ['t1'], categoryId: 'c1', restaurantId: 'r1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const keys = spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
    expect(keys).toContain(JSON.stringify(['bank-transactions']));
    expect(keys).toContain(JSON.stringify(['income-statement']));
    expect(keys).toContain(JSON.stringify(['balance-sheet']));
    expect(keys).toContain(JSON.stringify(['chart-of-accounts']));
  });

  it('the success toast count equals categorized_count + reclassified_count', async () => {
    rpc.mockResolvedValue({
      data: makeResult({ categorized_count: 4, reclassified_count: 2, unchanged_count: 1 }),
      error: null,
    });
    const client = new QueryClient();
    const { result } = renderHook(() => useBulkCategorizeTransactions(), { wrapper: wrapper(client) });

    result.current.mutate({
      transactionIds: ['t1', 't2', 't3', 't4', 't5', 't6', 't7'],
      categoryId: 'c1',
      restaurantId: 'r1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(toastSuccess).toHaveBeenCalled();
    const [message] = toastSuccess.mock.calls[0] as [string];
    expect(message).toContain('6');
  });
});
