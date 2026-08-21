import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRevenueHealth } from '@/hooks/useRevenueHealth';

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

type Row = {
  id: string;
  transaction_date: string;
  amount: number;
  status: string;
  description: string | null;
  merchant_name: string | null;
  category_id: string | null;
};

type QueryBuilder = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  lte: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
};

/** The revenue-accounts lookup: resolves once, never paged. */
function createAccountsBuilder(): QueryBuilder {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn(),
  } as unknown as QueryBuilder & PromiseLike<{ data: unknown[]; error: null }>;
  // chart_of_accounts is awaited directly (no .order()/.range() call in the hook).
  (builder as unknown as { then: typeof Promise.prototype.then }).then = (resolve) =>
    Promise.resolve({ data: [], error: null }).then(resolve);
  return builder;
}

/** One bank_transactions query builder whose `.range()` returns `pages[callIndex]`, in order. */
function createPagedBuilder(pages: Row[][]): QueryBuilder {
  let call = 0;
  const builder: QueryBuilder = {
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

function row(overrides: Partial<Row>): Row {
  return {
    id: `txn-${Math.random()}`,
    transaction_date: '2026-08-01',
    amount: 100,
    status: 'posted',
    description: null,
    merchant_name: null,
    category_id: null,
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

describe('useRevenueHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRestaurantContext.selectedRestaurant = { restaurant_id: 'rest-123' };
  });

  it('orders by transaction_date then id, and covers the full final day', async () => {
    const txnBuilder = createPagedBuilder([[]]);
    mockSupabase.from.mockImplementation((table: string) =>
      table === 'chart_of_accounts' ? createAccountsBuilder() : txnBuilder,
    );

    const { result } = renderHook(() => useRevenueHealth(startDate, endDate), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(txnBuilder.order).toHaveBeenCalledWith('transaction_date', { ascending: true });
    expect(txnBuilder.order).toHaveBeenCalledWith('id', { ascending: true });
    expect(txnBuilder.lte).toHaveBeenCalledWith('transaction_date', '2026-08-15T23:59:59.999Z');
  });

  it('pages with .range() in 1000-row pages until a short page ends the fetch', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) =>
      row({ id: `txn-${i}`, transaction_date: '2026-08-01', amount: 100 }),
    );
    const shortPage = [row({ id: 'txn-last', transaction_date: '2026-08-02', amount: 100 })];
    const txnBuilder = createPagedBuilder([fullPage, shortPage]);
    mockSupabase.from.mockImplementation((table: string) =>
      table === 'chart_of_accounts' ? createAccountsBuilder() : txnBuilder,
    );

    const { result } = renderHook(() => useRevenueHealth(startDate, endDate), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(txnBuilder.range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(txnBuilder.range).toHaveBeenNthCalledWith(2, 1000, 1999);
    expect(txnBuilder.range).toHaveBeenCalledTimes(2);
    expect(result.current.data?.truncated).toBe(false);
    // 1001 posted deposits of $100 each (>= the $50 significant-deposit floor).
    expect(result.current.data?.depositCount).toBe(1001);
  });

  it('stops at 20 pages and reports truncated: true', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) =>
      row({ id: `txn-${i}`, transaction_date: '2026-08-01', amount: 10 }),
    );
    const pages = Array.from({ length: 25 }, () => fullPage);
    const txnBuilder = createPagedBuilder(pages);
    mockSupabase.from.mockImplementation((table: string) =>
      table === 'chart_of_accounts' ? createAccountsBuilder() : txnBuilder,
    );

    const { result } = renderHook(() => useRevenueHealth(startDate, endDate), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(txnBuilder.range).toHaveBeenCalledTimes(20);
    expect(result.current.data?.truncated).toBe(true);
  });
});
