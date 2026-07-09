import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
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

// Build a single distinct row per categorizationFilter value so we can tell,
// by id, which tab's data is currently rendered.
function rowFor(filterValue: string) {
  return {
    id: `row-${filterValue}`,
    restaurant_id: 'rest-1',
    pos_system: 'toast',
    external_order_id: `ord-${filterValue}`,
    external_item_id: `item-${filterValue}`,
    item_name: `Item ${filterValue}`,
    quantity: 1,
    unit_price: 1,
    total_price: 1,
    sale_date: '2026-07-01',
    sale_time: '10:00:00',
    pos_category: null,
    synced_at: null,
    created_at: '2026-07-01T10:00:00Z',
    category_id: null,
    suggested_category_id: filterValue === 'pending-review' ? 'chart-1' : null,
    ai_confidence: null,
    ai_reasoning: null,
    item_type: 'sale',
    adjustment_type: null,
    is_categorized: filterValue === 'categorized',
    is_split: false,
    parent_sale_id: null,
    suggested_chart_account: null,
    approved_chart_account: null,
  };
}

// Chainable builder: every method returns the builder. Resolution of the
// `unified_sales` query is gated by a manually-controlled deferred promise
// so the test can hold a refetch "in flight" and observe hook output while
// pending. The row returned encodes which `.is('suggested_category_id', ...)`
// / `.is('is_categorized', ...)` filter was applied, standing in for the
// server actually filtering by categorizationFilter.
function makeBuilder(resolvePage: () => Promise<{ data: any; error: any }>) {
  const builder: any = {};
  for (const m of ['select', 'eq', 'ilike', 'gte', 'lte', 'not', 'is', 'order', 'range']) {
    builder[m] = vi.fn(() => builder);
  }
  builder.then = (onFulfilled: any, onRejected: any) =>
    resolvePage().then(onFulfilled, onRejected);
  return builder;
}

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function defer<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 300000, staleTime: 60000 } },
  });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useUnifiedSales keepPreviousData (tab-switch UX)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps previous rows visible (non-empty) while refetching after categorizationFilter changes', async () => {
    // First tab ('uncategorized') resolves immediately.
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'recipes') {
        return makeBuilder(() => Promise.resolve({ data: [], error: null }));
      }
      return makeBuilder(() => Promise.resolve({ data: [rowFor('uncategorized')], error: null }));
    });

    const wrapper = createWrapper();
    const { result, rerender } = renderHook(
      ({ categorizationFilter }: { categorizationFilter: 'uncategorized' | 'pending-review' }) =>
        useUnifiedSales('rest-1', { categorizationFilter }),
      { wrapper, initialProps: { categorizationFilter: 'uncategorized' } }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sales).toHaveLength(1);
    expect(result.current.sales[0].id).toBe('row-uncategorized');

    // Now switch tabs to 'pending-review'. Gate the new query's resolution
    // behind a deferred promise so we can inspect hook state mid-flight.
    const gate = defer<{ data: any; error: any }>();
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'recipes') {
        return makeBuilder(() => Promise.resolve({ data: [], error: null }));
      }
      return makeBuilder(() => gate.promise);
    });

    rerender({ categorizationFilter: 'pending-review' });

    // While the new tab's fetch is still pending, the hook must not drop to
    // an empty/loading state — placeholderData: keepPreviousData should keep
    // the previous tab's row visible.
    await waitFor(() => {
      expect(result.current.sales.length).toBeGreaterThan(0);
    });
    expect(result.current.sales[0].id).toBe('row-uncategorized');

    // Resolve the pending-review fetch and confirm it eventually swaps in.
    gate.resolve({ data: [rowFor('pending-review')], error: null });

    await waitFor(() => expect(result.current.sales[0].id).toBe('row-pending-review'));
  });

  it('does NOT reuse the previous restaurant\'s rows across a restaurant switch (multi-tenant isolation)', async () => {
    // A row tagged by restaurant so we can detect any cross-tenant bleed by id.
    const rowForRestaurant = (rid: string) => ({ ...rowFor('uncategorized'), id: `row-${rid}`, restaurant_id: rid });

    // rest-1 resolves immediately.
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'recipes') return makeBuilder(() => Promise.resolve({ data: [], error: null }));
      return makeBuilder(() => Promise.resolve({ data: [rowForRestaurant('rest-1')], error: null }));
    });

    const wrapper = createWrapper();
    const { result, rerender } = renderHook(
      ({ restaurantId }: { restaurantId: string }) =>
        useUnifiedSales(restaurantId, { categorizationFilter: 'uncategorized' }),
      { wrapper, initialProps: { restaurantId: 'rest-1' } }
    );

    await waitFor(() => expect(result.current.sales[0]?.id).toBe('row-rest-1'));

    // Switch restaurants; gate rest-2's fetch so we can inspect mid-flight.
    const gate = defer<{ data: any; error: any }>();
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'recipes') return makeBuilder(() => Promise.resolve({ data: [], error: null }));
      return makeBuilder(() => gate.promise);
    });

    rerender({ restaurantId: 'rest-2' });

    // While rest-2's fetch is pending, the hook must NOT keep showing rest-1's
    // row — the restaurant-scoped placeholder guard drops it (loading state).
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.sales.find((s) => s.id === 'row-rest-1')).toBeUndefined();

    gate.resolve({ data: [rowForRestaurant('rest-2')], error: null });
    await waitFor(() => expect(result.current.sales[0]?.id).toBe('row-rest-2'));
  });
});
