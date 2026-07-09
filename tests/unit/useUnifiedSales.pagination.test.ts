import React, { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// --- Mock auth + toast (hook calls useAuth() and useToast()) ---
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// --- Mock the Supabase client query builder ---
const { mockSupabase } = vi.hoisted(() => ({
  mockSupabase: { from: vi.fn() },
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

import { useUnifiedSales } from '@/hooks/useUnifiedSales';

const PAGE_SIZE = 500;

// Records every .range() and .order() call the hook makes against unified_sales.
let rangeCalls: Array<[number, number]>;
let orderCalls: Array<[string, unknown]>;

// Build a distinct, non-overlapping page of rows for a given offset.
// IDs encode the offset so any duplicate page fetch is detectable by id.
function pageForOffset(from: number, size: number) {
  return Array.from({ length: size }, (_, i) => ({
    id: `row-${from + i}`,
    restaurant_id: 'rest-1',
    pos_system: 'toast',
    external_order_id: `ord-${from + i}`,
    external_item_id: `item-${from + i}`,
    item_name: `Item ${from + i}`,
    quantity: 1,
    unit_price: 1,
    total_price: 1,
    sale_date: '2026-07-01',
    sale_time: '10:00:00',
    pos_category: null,
    synced_at: null,
    created_at: '2026-07-01T10:00:00Z',
    category_id: null,
    suggested_category_id: null,
    ai_confidence: null,
    ai_reasoning: null,
    item_type: 'sale',
    adjustment_type: null,
    is_categorized: false,
    is_split: false,
    parent_sale_id: null,
    suggested_chart_account: null,
    approved_chart_account: null,
  }));
}

type QueryResult = { data: unknown; error: unknown };
type MockBuilder = {
  __range?: [number, number];
  then: (
    onFulfilled: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
  [method: string]: unknown;
};

// Chainable builder: every method returns the builder; awaiting it resolves
// via `resolver`. `.range`/`.order` calls are captured for assertions.
function makeBuilder(resolver: (b: MockBuilder) => QueryResult) {
  const builder = {} as MockBuilder;
  for (const m of ['select', 'eq', 'ilike', 'gte', 'lte', 'not']) {
    builder[m] = vi.fn(() => builder);
  }
  builder.order = vi.fn((col: string, opts: unknown) => {
    orderCalls.push([col, opts]);
    return builder;
  });
  builder.range = vi.fn((from: number, to: number) => {
    builder.__range = [from, to];
    rangeCalls.push([from, to]);
    return builder;
  });
  builder.then = (onFulfilled, onRejected) =>
    Promise.resolve(resolver(builder)).then(onFulfilled, onRejected);
  return builder;
}

// `firstPageSize` controls whether more pages exist (=== PAGE_SIZE → hasMore).
function setup(firstPageSize: number) {
  rangeCalls = [];
  orderCalls = [];
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'recipes') {
      return makeBuilder(() => ({ data: [], error: null }));
    }
    // unified_sales: resolve the slice for whatever offset was requested.
    return makeBuilder((b) => {
      const [from] = b.__range as [number, number];
      const size = from === 0 ? firstPageSize : PAGE_SIZE;
      return { data: pageForOffset(from, size), error: null };
    });
  });
}

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useUnifiedSales pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('advances the offset on Load more and never duplicates rows', async () => {
    setup(PAGE_SIZE); // full first page → hasMore true

    const { result } = renderHook(() => useUnifiedSales('rest-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sales).toHaveLength(PAGE_SIZE);
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      result.current.loadMoreSales();
    });

    await waitFor(() => expect(result.current.sales).toHaveLength(PAGE_SIZE * 2));

    // The SECOND unified_sales page must be fetched at offset PAGE_SIZE, not 0.
    const unifiedRanges = rangeCalls;
    expect(unifiedRanges[0]).toEqual([0, PAGE_SIZE - 1]);
    expect(unifiedRanges[1]).toEqual([PAGE_SIZE, PAGE_SIZE * 2 - 1]);

    // No duplicate ids across the two pages.
    const ids = result.current.sales.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('stops paging when the first page is short (no dead-end Load more)', async () => {
    setup(12); // 12 < PAGE_SIZE → hasMore false

    const { result } = renderHook(() => useUnifiedSales('rest-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sales).toHaveLength(12);
    expect(result.current.hasMore).toBe(false);
  });

  it('orders by a unique id tiebreaker for deterministic OFFSET paging', async () => {
    setup(PAGE_SIZE);

    const { result } = renderHook(() => useUnifiedSales('rest-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    // The ORDER BY chain must include an `id` ordering call.
    expect(orderCalls.some(([col]) => col === 'id')).toBe(true);
  });
});
