import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLiquidityMetrics } from '@/hooks/useLiquidityMetrics';

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
  status: string;
};

/** A single-shot query builder: resolves once, never paged. */
function createResolvingBuilder(result: { data: unknown; error: null }) {
  const builder: Record<string, unknown> = {};
  const passthrough = () => builder;
  builder.select = vi.fn(passthrough);
  builder.eq = vi.fn(passthrough);
  builder.in = vi.fn(passthrough);
  (builder as unknown as { then: typeof Promise.prototype.then }).then = (resolve) =>
    Promise.resolve(result).then(resolve);
  return builder as { select: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn>; in: ReturnType<typeof vi.fn> };
}

/** The bank_transactions query builder whose `.range()` returns `pages[callIndex]`, in order. */
function createPagedTxnBuilder(pages: TxnRow[][]) {
  let call = 0;
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
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
    status: 'posted',
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

const startDate = new Date(2026, 7, 1);
const endDate = new Date(2026, 7, 15);

function mockNonTxnTables() {
  return (table: string) => {
    if (table === 'connected_banks') {
      return createResolvingBuilder({ data: [{ id: 'bank-1' }], error: null });
    }
    if (table === 'bank_account_balances') {
      return createResolvingBuilder({ data: [{ current_balance: 1000 }], error: null });
    }
    if (table === 'pending_outflows') {
      return createResolvingBuilder({ data: [], error: null });
    }
    return undefined;
  };
}

describe('useLiquidityMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRestaurantContext.selectedRestaurant = { restaurant_id: 'rest-123' };
  });

  it('orders the transaction scan by transaction_date then id, and covers the full final day', async () => {
    const txnBuilder = createPagedTxnBuilder([[]]);
    const nonTxn = mockNonTxnTables();
    mockSupabase.from.mockImplementation((table: string) => nonTxn(table) ?? txnBuilder);

    const { result } = renderHook(() => useLiquidityMetrics(startDate, endDate), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(txnBuilder.order).toHaveBeenCalledWith('transaction_date', { ascending: true });
    expect(txnBuilder.order).toHaveBeenCalledWith('id', { ascending: true });
    expect(txnBuilder.lte).toHaveBeenCalledWith('transaction_date', '2026-08-15T23:59:59.999Z');
  });

  it('pages with .range() in 1000-row pages until a short page ends the fetch', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) =>
      txnRow({ id: `txn-${i}`, transaction_date: '2026-08-01', amount: -50 }),
    );
    const shortPage = [txnRow({ id: 'txn-last', transaction_date: '2026-08-02', amount: -50 })];
    const txnBuilder = createPagedTxnBuilder([fullPage, shortPage]);
    const nonTxn = mockNonTxnTables();
    mockSupabase.from.mockImplementation((table: string) => nonTxn(table) ?? txnBuilder);

    const { result } = renderHook(() => useLiquidityMetrics(startDate, endDate), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(txnBuilder.range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(txnBuilder.range).toHaveBeenNthCalledWith(2, 1000, 1999);
    expect(txnBuilder.range).toHaveBeenCalledTimes(2);
    expect(result.current.data?.truncated).toBe(false);
  });

  it('stops at 20 pages and reports truncated: true', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) =>
      txnRow({ id: `txn-${i}`, transaction_date: '2026-08-01', amount: -10 }),
    );
    const pages = Array.from({ length: 25 }, () => fullPage);
    const txnBuilder = createPagedTxnBuilder(pages);
    const nonTxn = mockNonTxnTables();
    mockSupabase.from.mockImplementation((table: string) => nonTxn(table) ?? txnBuilder);

    const { result } = renderHook(() => useLiquidityMetrics(startDate, endDate), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(txnBuilder.range).toHaveBeenCalledTimes(20);
    expect(result.current.data?.truncated).toBe(true);
  });
});
