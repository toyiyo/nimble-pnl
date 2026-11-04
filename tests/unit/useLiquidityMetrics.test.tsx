import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLiquidityMetrics, OPEN_OUTFLOW_WINDOW_DAYS } from '@/hooks/useLiquidityMetrics';

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
  builder.gte = vi.fn(passthrough);
  (builder as unknown as { then: typeof Promise.prototype.then }).then = (resolve) =>
    Promise.resolve(result).then(resolve);
  return builder as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    gte: ReturnType<typeof vi.fn>;
  };
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

function mockNonTxnTables(pendingOutflowsData: unknown[] = [], pendingBuilderRef?: { current: unknown }) {
  return (table: string) => {
    if (table === 'connected_banks') {
      return createResolvingBuilder({ data: [{ id: 'bank-1' }], error: null });
    }
    if (table === 'bank_account_balances') {
      return createResolvingBuilder({ data: [{ current_balance: 1000 }], error: null });
    }
    if (table === 'pending_outflows') {
      const builder = createResolvingBuilder({ data: pendingOutflowsData, error: null });
      if (pendingBuilderRef) pendingBuilderRef.current = builder;
      return builder;
    }
    return undefined;
  };
}

describe('useLiquidityMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRestaurantContext.selectedRestaurant = { restaurant_id: 'rest-123' };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes OPEN_OUTFLOW_WINDOW_DAYS as 60', () => {
    expect(OPEN_OUTFLOW_WINDOW_DAYS).toBe(60);
  });

  it('filters pending outflows by issue_date within the open window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 30, 12));

    const txnBuilder = createPagedTxnBuilder([[]]);
    const pendingBuilderRef: { current: unknown } = { current: null };
    const nonTxn = mockNonTxnTables([], pendingBuilderRef);
    mockSupabase.from.mockImplementation((table: string) => nonTxn(table) ?? txnBuilder);

    const { result } = renderHook(() => useLiquidityMetrics(startDate, endDate), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const pendingBuilder = pendingBuilderRef.current as { gte: ReturnType<typeof vi.fn> };
    expect(pendingBuilder.gte).toHaveBeenCalledWith('issue_date', '2026-08-02');
  });

  it('filters pending outflows by issue_date across a year boundary', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 0, 15, 12));

    const txnBuilder = createPagedTxnBuilder([[]]);
    const pendingBuilderRef: { current: unknown } = { current: null };
    const nonTxn = mockNonTxnTables([], pendingBuilderRef);
    mockSupabase.from.mockImplementation((table: string) => nonTxn(table) ?? txnBuilder);

    const { result } = renderHook(() => useLiquidityMetrics(startDate, endDate), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const pendingBuilder = pendingBuilderRef.current as { gte: ReturnType<typeof vi.fn> };
    expect(pendingBuilder.gte).toHaveBeenCalledWith('issue_date', '2025-11-17');
  });

  it('subtracts in-window pending outflows from bookBalance', async () => {
    const txnBuilder = createPagedTxnBuilder([[]]);
    const nonTxn = mockNonTxnTables([{ amount: 300 }, { amount: 200 }]);
    mockSupabase.from.mockImplementation((table: string) => nonTxn(table) ?? txnBuilder);

    const { result } = renderHook(() => useLiquidityMetrics(startDate, endDate), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.bookBalance).toBe(500);
  });

  it('reports daysOfCash of 95 and runwayStatus healthy (design 5.1)', async () => {
    const rangeStart = new Date(2026, 7, 1);
    const rangeEnd = new Date(2026, 7, 30); // 30-day period
    const txnBuilder = createPagedTxnBuilder([
      [
        txnRow({ id: 'txn-out', transaction_date: '2026-08-05', amount: -3000 }),
      ],
    ]);
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'connected_banks') return createResolvingBuilder({ data: [{ id: 'bank-1' }], error: null });
      if (table === 'bank_account_balances')
        return createResolvingBuilder({ data: [{ current_balance: 10000 }], error: null });
      if (table === 'pending_outflows') return createResolvingBuilder({ data: [{ amount: 500 }], error: null });
      return txnBuilder;
    });

    const { result } = renderHook(() => useLiquidityMetrics(rangeStart, rangeEnd), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.daysOfCash).toBe(95);
    expect(result.current.data?.runwayStatus).toBe('healthy');
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

  it('computes daysOfCash of 20 for a 30-day range, 3000 outflow, 1500 inflow, 1000 balance', async () => {
    const rangeStart = new Date(2026, 7, 1);
    const rangeEnd = new Date(2026, 7, 30); // 30-day period
    const txnBuilder = createPagedTxnBuilder([
      [
        txnRow({ id: 'txn-out', transaction_date: '2026-08-05', amount: -3000 }),
        txnRow({ id: 'txn-in', transaction_date: '2026-08-05', amount: 1500 }),
      ],
    ]);
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'connected_banks') return createResolvingBuilder({ data: [{ id: 'bank-1' }], error: null });
      if (table === 'bank_account_balances')
        return createResolvingBuilder({ data: [{ current_balance: 1000 }], error: null });
      if (table === 'pending_outflows') return createResolvingBuilder({ data: [], error: null });
      return txnBuilder;
    });

    const { result } = renderHook(() => useLiquidityMetrics(rangeStart, rangeEnd), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.daysOfCash).toBe(20);
  });

  it('returns Infinity when inflows are larger than outflows', async () => {
    const rangeStart = new Date(2026, 7, 1);
    const rangeEnd = new Date(2026, 7, 30); // 30-day period
    const txnBuilder = createPagedTxnBuilder([
      [
        txnRow({ id: 'txn-out', transaction_date: '2026-08-05', amount: -1000 }),
        txnRow({ id: 'txn-in', transaction_date: '2026-08-05', amount: 2000 }),
      ],
    ]);
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'connected_banks') return createResolvingBuilder({ data: [{ id: 'bank-1' }], error: null });
      if (table === 'bank_account_balances')
        return createResolvingBuilder({ data: [{ current_balance: 1000 }], error: null });
      if (table === 'pending_outflows') return createResolvingBuilder({ data: [], error: null });
      return txnBuilder;
    });

    const { result } = renderHook(() => useLiquidityMetrics(rangeStart, rangeEnd), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.daysOfCash).toBe(Infinity);
  });

  it('reports daysOfCash of 0 with no error when zero banks are connected', async () => {
    const txnBuilder = createPagedTxnBuilder([[]]);
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'connected_banks') return createResolvingBuilder({ data: [], error: null });
      if (table === 'bank_account_balances') return createResolvingBuilder({ data: [], error: null });
      if (table === 'pending_outflows') return createResolvingBuilder({ data: [], error: null });
      return txnBuilder;
    });

    const { result } = renderHook(() => useLiquidityMetrics(startDate, endDate), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.error).toBeNull();
    expect(result.current.data?.daysOfCash).toBe(0);
  });
});
