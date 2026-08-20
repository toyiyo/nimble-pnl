import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCashFlowInsights } from '@/hooks/useCashFlowInsights';

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
  transaction_date: string;
  amount: number;
  is_transfer: boolean;
  normalized_payee: string | null;
  merchant_name: string | null;
  description: string | null;
  category: { id: string; name: string } | null;
};

type QueryBuilder = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  lte: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
};

/** One query builder whose `.range()` returns `pages[callIndex]`, in order. */
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
    transaction_date: '2026-08-01',
    amount: 100,
    is_transfer: false,
    normalized_payee: 'Acme Co',
    merchant_name: null,
    description: null,
    category: { id: 'cat-1', name: 'Revenue' },
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

const period = { from: new Date(2026, 7, 1), to: new Date(2026, 7, 15) };

describe('useCashFlowInsights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRestaurantContext.selectedRestaurant = { restaurant_id: 'rest-123' };
  });

  it('filters by restaurant_id, status=posted, and skips the bank filter when "all"', async () => {
    const builder = createPagedBuilder([[row({})]]);
    mockSupabase.from.mockReturnValue(builder);

    const { result } = renderHook(() => useCashFlowInsights(period, 'all'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockSupabase.from).toHaveBeenCalledWith('bank_transactions');
    expect(builder.eq).toHaveBeenCalledWith('restaurant_id', 'rest-123');
    expect(builder.eq).toHaveBeenCalledWith('status', 'posted');
    expect(builder.eq).not.toHaveBeenCalledWith('connected_bank_id', expect.anything());
  });

  it('applies the connected_bank_id filter when a specific bank is selected', async () => {
    const builder = createPagedBuilder([[]]);
    mockSupabase.from.mockReturnValue(builder);

    const { result } = renderHook(() => useCashFlowInsights(period, 'bank-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(builder.eq).toHaveBeenCalledWith('connected_bank_id', 'bank-1');
  });

  it('fetches from min(period.from, startOfMonth(subMonths(period.to, 4))) to period.to', async () => {
    const builder = createPagedBuilder([[]]);
    mockSupabase.from.mockReturnValue(builder);

    const { result } = renderHook(() => useCashFlowInsights(period, 'all'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // period.to = 2026-08-15; 4 months back, start of month => 2026-04-01,
    // which is earlier than period.from (2026-08-01), so the wide window wins.
    // The column is timestamptz, so the end bound must cover the full final day.
    expect(builder.gte).toHaveBeenCalledWith('transaction_date', '2026-04-01');
    expect(builder.lte).toHaveBeenCalledWith('transaction_date', '2026-08-15T23:59:59.999Z');
    expect(builder.order).toHaveBeenCalledWith('transaction_date', { ascending: true });
  });

  it('pages with .range() in 1000-row pages until a short page ends the fetch', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => row({ transaction_date: '2026-08-01', amount: i }));
    const shortPage = [row({ transaction_date: '2026-08-02' })];
    const builder = createPagedBuilder([fullPage, shortPage]);
    mockSupabase.from.mockReturnValue(builder);

    const { result } = renderHook(() => useCashFlowInsights(period, 'all'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(builder.range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(builder.range).toHaveBeenNthCalledWith(2, 1000, 1999);
    expect(builder.range).toHaveBeenCalledTimes(2);
    expect(result.current.data?.truncated).toBe(false);
  });

  it('stops at 20 pages and sets truncated: true', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => row({ transaction_date: '2026-08-01', amount: i }));
    const pages = Array.from({ length: 25 }, () => fullPage);
    const builder = createPagedBuilder(pages);
    mockSupabase.from.mockReturnValue(builder);

    const { result } = renderHook(() => useCashFlowInsights(period, 'all'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(builder.range).toHaveBeenCalledTimes(20);
    expect(result.current.data?.truncated).toBe(true);
  });

  it('memoizes totals and series from rows inside the display period only', async () => {
    const rows = [
      row({ transaction_date: '2026-07-01', amount: 500 }), // outside period, feeds insights only
      row({ transaction_date: '2026-08-05', amount: 200 }),
      row({ transaction_date: '2026-08-06', amount: -50 }),
    ];
    const builder = createPagedBuilder([rows]);
    mockSupabase.from.mockReturnValue(builder);

    const { result } = renderHook(() => useCashFlowInsights(period, 'all'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.aggregates.totals).toEqual({ moneyIn: 200, moneyOut: -50, net: 150 });
    expect(result.current.data?.rows).toHaveLength(2);
  });

  it('returns an empty result set without querying when no restaurant is selected', async () => {
    mockRestaurantContext.selectedRestaurant = null;
    const builder = createPagedBuilder([[]]);
    mockSupabase.from.mockReturnValue(builder);

    const { result } = renderHook(() => useCashFlowInsights(period, 'all'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess || result.current.isLoading === false).toBe(true));

    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(result.current.data?.rows ?? []).toHaveLength(0);
  });
});
