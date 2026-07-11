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

// Records every .not() / .is() call the hook makes against unified_sales.
// `kind` distinguishes which PostgREST builder method produced the call
// (.not(col, op, value) vs .is(col, value)) since 'uncategorized' and
// 'pending-review' touch the same two columns but with opposite methods
// per the design's parity table — collapsing them to the same tuple shape
// would make the two tabs indistinguishable to this test.
type FilterCall = { kind: 'not' | 'is'; column: string; operator?: string; value: unknown };
let filterCalls: FilterCall[];

// Chainable builder: every method returns the builder; awaiting it resolves
// with an empty page. When `capture` is true, `.not`/`.is` calls are recorded
// into `filterCalls` — only the `unified_sales` builder captures, so the
// unrelated `.not('pos_item_name', 'is', null)` call the hook's separate
// `recipes` query issues doesn't leak into these assertions.
function makeBuilder(capture: boolean) {
  const builder: any = {};
  for (const m of ['select', 'eq', 'ilike', 'gte', 'lte', 'order', 'range']) {
    builder[m] = vi.fn(() => builder);
  }
  builder.not = vi.fn((column: string, operator: string, value: unknown) => {
    if (capture) filterCalls.push({ kind: 'not', column, operator, value });
    return builder;
  });
  builder.is = vi.fn((column: string, value: unknown) => {
    if (capture) filterCalls.push({ kind: 'is', column, value });
    return builder;
  });
  builder.then = (onFulfilled: any, onRejected: any) =>
    Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
  return builder;
}

function setup() {
  filterCalls = [];
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'recipes') {
      return makeBuilder(false);
    }
    return makeBuilder(true);
  });
}

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useUnifiedSales categorization filter (server-side)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uncategorized: .not('is_categorized','is',true) AND .is('suggested_category_id', null)", async () => {
    setup();

    const { result } = renderHook(
      () => useUnifiedSales('rest-1', { categorizationFilter: 'uncategorized' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(filterCalls).toEqual([
      { kind: 'not', column: 'is_categorized', operator: 'is', value: true },
      { kind: 'is', column: 'suggested_category_id', value: null },
    ]);
  });

  it("pending-review: .not('is_categorized','is',true) AND .not('suggested_category_id','is',null)", async () => {
    setup();

    const { result } = renderHook(
      () => useUnifiedSales('rest-1', { categorizationFilter: 'pending-review' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(filterCalls).toEqual([
      { kind: 'not', column: 'is_categorized', operator: 'is', value: true },
      { kind: 'not', column: 'suggested_category_id', operator: 'is', value: null },
    ]);
  });

  it("categorized: .is('is_categorized', true) only (no suggested_category_id predicate)", async () => {
    setup();

    const { result } = renderHook(
      () => useUnifiedSales('rest-1', { categorizationFilter: 'categorized' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(filterCalls).toEqual([{ kind: 'is', column: 'is_categorized', value: true }]);
  });

  it('all: emits no categorization filter calls', async () => {
    setup();

    const { result } = renderHook(
      () => useUnifiedSales('rest-1', { categorizationFilter: 'all' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(filterCalls).toEqual([]);
  });

  it('omitted: emits no categorization filter calls (backward compatible)', async () => {
    setup();

    const { result } = renderHook(() => useUnifiedSales('rest-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(filterCalls).toEqual([]);
  });
});
