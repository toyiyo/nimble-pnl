import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const page0 = Array.from({ length: 1000 }, () => ({
  created_at: '2026-08-01T12:00:00Z',
  transaction_date: '2026-08-01',
  total_cost: 1,
}));
const page1 = Array.from({ length: 5 }, () => ({
  created_at: '2026-08-02T12:00:00Z',
  transaction_date: '2026-08-02',
  total_cost: 1,
}));

const rangeCalls: Array<[number, number]> = [];
const orderCalls: unknown[][] = [];
let callIndex = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const inventoryChain: any = {};
['select', 'eq', 'or'].forEach((m) => {
  inventoryChain[m] = vi.fn(() => inventoryChain);
});
inventoryChain.order = vi.fn((...args: unknown[]) => {
  orderCalls.push(args);
  return inventoryChain;
});
inventoryChain.range = vi.fn((from: number, to: number) => {
  rangeCalls.push([from, to]);
  const page = [page0, page1][callIndex] ?? [];
  callIndex++;
  return Promise.resolve({ data: page, error: null });
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: () => inventoryChain },
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

describe('useFoodCosts pagination', () => {
  beforeEach(() => {
    rangeCalls.length = 0;
    orderCalls.length = 0;
    callIndex = 0;
  });

  it('pages inventory_transactions with .range() and a deterministic sort', async () => {
    const { useFoodCosts } = await import('@/hooks/useFoodCosts');

    const { result } = renderHook(
      () => useFoodCosts('rest-1', new Date('2026-08-01T12:00:00Z'), new Date('2026-08-27T12:00:00Z')),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(result.current.totalCost).toBe(1005);
    expect(result.current.capped).toBe(false);
    // buildPage runs once per page, so duplicate order calls are expected.
    expect(orderCalls).toEqual(
      expect.arrayContaining([['created_at', { ascending: true }], ['id']])
    );
  });
});
