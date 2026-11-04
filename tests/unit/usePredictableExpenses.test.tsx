import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePredictableExpenses } from '@/hooks/usePredictableExpenses';

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}));

const mockRestaurantContext = vi.hoisted(() => ({
  selectedRestaurant: { restaurant_id: 'rest-123' } as { restaurant_id: string } | null,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => mockRestaurantContext,
}));

type TxnRow = {
  id: string;
  transaction_date: string;
  amount: number;
  merchant_name: string | null;
  normalized_payee: string | null;
  description: string | null;
};

/** The bank_transactions query builder whose `.range()` returns `pages[callIndex]`, in order. */
function createPagedTxnBuilder(pages: TxnRow[][]) {
  let call = 0;
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockImplementation(() => {
      const page = pages[call] ?? [];
      call += 1;
      return Promise.resolve({ data: page, error: null });
    }),
  };
  return builder;
}

function txnRow(overrides: Partial<TxnRow>): TxnRow {
  return {
    id: `txn-${Math.random()}`,
    transaction_date: '2026-08-01',
    amount: -100,
    merchant_name: 'Acme Vendor',
    normalized_payee: 'acme vendor',
    description: null,
    ...overrides,
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('usePredictableExpenses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRestaurantContext.selectedRestaurant = { restaurant_id: 'rest-123' };
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 7, 20));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('orders the scan by transaction_date then id, and covers the full final day', async () => {
    const txnBuilder = createPagedTxnBuilder([[]]);
    mockSupabase.from.mockImplementation(() => txnBuilder);

    const { result } = renderHook(() => usePredictableExpenses(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(txnBuilder.order).toHaveBeenCalledWith('transaction_date', { ascending: true });
    expect(txnBuilder.order).toHaveBeenCalledWith('id', { ascending: true });
    expect(txnBuilder.lte).toHaveBeenCalledWith('transaction_date', '2026-08-20T23:59:59.999Z');
  });

  it('pages with .range() in 1000-row pages until a short page ends the fetch', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) =>
      txnRow({ id: `txn-${i}`, transaction_date: '2026-08-01', amount: -50 }),
    );
    const shortPage = [txnRow({ id: 'txn-last', transaction_date: '2026-08-02', amount: -50 })];
    const txnBuilder = createPagedTxnBuilder([fullPage, shortPage]);
    mockSupabase.from.mockImplementation(() => txnBuilder);

    const { result } = renderHook(() => usePredictableExpenses(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(txnBuilder.range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(txnBuilder.range).toHaveBeenNthCalledWith(2, 1000, 1999);
    expect(txnBuilder.range).toHaveBeenCalledTimes(2);
  });

  it('stops at 20 pages', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) =>
      txnRow({ id: `txn-${i}`, transaction_date: '2026-08-01', amount: -10 }),
    );
    const pages = Array.from({ length: 25 }, () => fullPage);
    const txnBuilder = createPagedTxnBuilder(pages);
    mockSupabase.from.mockImplementation(() => txnBuilder);

    const { result } = renderHook(() => usePredictableExpenses(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(txnBuilder.range).toHaveBeenCalledTimes(20);
  });
});
