import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const { mockSupabase } = vi.hoisted(() => ({
  mockSupabase: { from: vi.fn() },
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

import { useUnifiedSales } from '@/hooks/useUnifiedSales';

type EqCall = { column: string; value: unknown };
let eqCalls: EqCall[];

function makeBuilder(capture: boolean) {
  const builder: any = {};
  for (const method of ['select', 'ilike', 'gte', 'lte', 'not', 'is', 'order', 'range']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.eq = vi.fn((column: string, value: unknown) => {
    if (capture) eqCalls.push({ column, value });
    return builder;
  });
  builder.then = (onFulfilled: any, onRejected: any) =>
    Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
  return builder;
}

function setup() {
  eqCalls = [];
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

describe('useUnifiedSales source filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds eq('pos_system', sourceFilter) when a source is selected", async () => {
    setup();

    const { result } = renderHook(
      () => useUnifiedSales('rest-1', { sourceFilter: 'toast' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(eqCalls).toContainEqual({ column: 'pos_system', value: 'toast' });
  });

  it('does not add a pos_system predicate for all sources', async () => {
    setup();

    const { result } = renderHook(
      () => useUnifiedSales('rest-1', { sourceFilter: 'all' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(eqCalls.some((call) => call.column === 'pos_system')).toBe(false);
  });
});
