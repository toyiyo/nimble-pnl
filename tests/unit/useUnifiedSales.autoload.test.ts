import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { mockSupabase } = vi.hoisted(() => ({ mockSupabase: { from: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: mockSupabase }));

import { useUnifiedSales } from '@/hooks/useUnifiedSales';

const PAGE_SIZE = 500;

function pageForOffset(from: number, size: number) {
  return Array.from({ length: size }, (_, i) => ({
    id: `row-${from + i}`, restaurant_id: 'rest-1', pos_system: 'toast',
    external_order_id: `ord-${from + i}`, external_item_id: `item-${from + i}`,
    item_name: `Item ${from + i}`, quantity: 1, unit_price: 1, total_price: 1,
    sale_date: '2026-07-01', sale_time: '10:00:00', pos_category: null, synced_at: null,
    created_at: '2026-07-01T10:00:00Z', category_id: null, suggested_category_id: null,
    ai_confidence: null, ai_reasoning: null, item_type: 'sale', adjustment_type: null,
    is_categorized: false, is_split: false, parent_sale_id: null,
    suggested_chart_account: null, approved_chart_account: null,
  }));
}

type QueryResult = { data: unknown; error: unknown };
type MockBuilder = { __range?: [number, number]; then: (f: (v: QueryResult) => unknown, r?: (e: unknown) => unknown) => Promise<unknown>; [m: string]: unknown };

let unifiedFetchCount: number;

function makeBuilder(resolver: (b: MockBuilder) => QueryResult) {
  const builder = {} as MockBuilder;
  for (const m of ['select', 'eq', 'ilike', 'gte', 'lte', 'not', 'is', 'order']) {
    builder[m] = vi.fn(() => builder);
  }
  builder.range = vi.fn((from: number, to: number) => { builder.__range = [from, to]; return builder; });
  builder.then = (onF, onR) => Promise.resolve(resolver(builder)).then(onF, onR);
  return builder;
}

// nPages full pages of PAGE_SIZE, then a short page to end.
function setup(nFullPages: number) {
  unifiedFetchCount = 0;
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'recipes') return makeBuilder(() => ({ data: [], error: null }));
    return makeBuilder((b) => {
      const [from] = b.__range as [number, number];
      unifiedFetchCount += 1;
      const pageIndex = from / PAGE_SIZE;
      const size = pageIndex < nFullPages ? PAGE_SIZE : 3; // short page ends paging
      return { data: pageForOffset(from, size), error: null };
    });
  });
}

const createWrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useUnifiedSales autoLoadAll', () => {
  beforeEach(() => vi.clearAllMocks());

  it('auto-advances through all pages without manual loadMore', async () => {
    setup(3); // pages 0,1,2 full then page 3 short (3 rows) → total 1503
    const { result } = renderHook(() => useUnifiedSales('rest-1', { autoLoadAll: true }), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.sales.length).toBe(PAGE_SIZE * 3 + 3), { timeout: 3000 });
    expect(result.current.reachedCap).toBe(false);
  });

  it('does NOT auto-advance when autoLoadAll is false (dashboard safety)', async () => {
    setup(3);
    const { result } = renderHook(() => useUnifiedSales('rest-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    // Only the first page fetched; no auto-advance.
    expect(result.current.sales.length).toBe(PAGE_SIZE);
    expect(unifiedFetchCount).toBe(1);
  });
});
