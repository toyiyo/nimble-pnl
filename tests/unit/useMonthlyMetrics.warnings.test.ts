import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type TipMode = 'capped' | 'error';
let tipMode: TipMode = 'capped';

// A full 1000-row page on every call: fetchAllRows keeps paging until it
// exhausts its 20-page budget and reports capped.
const fullTipPage = Array.from({ length: 1000 }, () => ({
  amount: 100,
  employee_id: 'e1',
  tip_splits: { restaurant_id: 'rest-1', split_date: '2026-08-05' },
}));

// Generic chain for every other table. maybeSingle -> null keeps the COGS
// method on 'inventory', so the financial COGS block is skipped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeGenericChain(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  ['select', 'eq', 'in', 'or', 'is', 'lt', 'gte', 'lte', 'order'].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
  chain.range = vi.fn(() => Promise.resolve({ data: [], error: null }));
  chain.then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
    resolve({ data: [], error: null });
  return chain;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeTipChain(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  ['select', 'eq', 'in', 'gte', 'lte', 'order'].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  chain.range = vi.fn(() => {
    if (tipMode === 'error') {
      return Promise.resolve({ data: null, error: new Error('tips fetch failed') });
    }
    return Promise.resolve({ data: fullTipPage, error: null });
  });
  return chain;
}

const fromMock = vi.fn((table: string) => {
  if (table === 'tip_split_items') return makeTipChain();
  return makeGenericChain();
});

const rpcMock = vi.fn(() => Promise.resolve({ data: [], error: null }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (...args: [string]) => fromMock(...args),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { timezone: 'America/Chicago' } },
  }),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

describe('useMonthlyMetrics warnings', () => {
  beforeEach(() => {
    fromMock.mockClear();
    rpcMock.mockClear();
  });

  it('reports a warning when the tips fetch hits the page limit', async () => {
    tipMode = 'capped';
    const { useMonthlyMetrics } = await import('@/hooks/useMonthlyMetrics');

    const { result } = renderHook(
      () =>
        useMonthlyMetrics('rest-1', new Date('2026-08-01T12:00:00Z'), new Date('2026-08-27T12:00:00Z')),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(Array.isArray(result.current.data)).toBe(true);
    expect(result.current.warnings).toContain(
      'The tip rows hit the fetch limit. The labor cost figure is incomplete.'
    );
  });

  it('surfaces a tips fetch error as a query error', async () => {
    tipMode = 'error';
    const { useMonthlyMetrics } = await import('@/hooks/useMonthlyMetrics');

    const { result } = renderHook(
      () =>
        useMonthlyMetrics('rest-1', new Date('2026-08-01T12:00:00Z'), new Date('2026-08-27T12:00:00Z')),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).not.toBeNull();
  });
});
