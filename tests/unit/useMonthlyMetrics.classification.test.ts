import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type FailureMode = 'employees-error' | 'manual-error' | 'rpc-unified-error' | 'clean';
let mode: FailureMode = 'clean';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chainFor(table: string): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  ['select', 'eq', 'in', 'or', 'is', 'lt', 'gte', 'lte', 'order'].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
  chain.range = vi.fn(() => Promise.resolve({ data: [], error: null }));
  chain.then = (resolve: (v: { data: unknown[] | null; error: Error | null }) => void) => {
    const shouldFail =
      (mode === 'employees-error' && table === 'employees_secure') ||
      (mode === 'manual-error' && table === 'daily_labor_allocations');
    if (shouldFail) {
      return resolve({ data: null, error: new Error(`${table} fetch failed`) });
    }
    return resolve({ data: [], error: null });
  };
  return chain;
}

const fromMock = vi.fn((table: string) => chainFor(table));

const rpcMock = vi.fn((fn: string) => {
  if (mode === 'rpc-unified-error' && fn === 'get_unified_sales_totals') {
    return Promise.resolve({ data: null, error: new Error('unified totals failed') });
  }
  return Promise.resolve({ data: [], error: null });
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (...args: [string]) => fromMock(...args),
    rpc: (...args: [string, unknown]) => rpcMock(...args),
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

async function renderMetrics() {
  const { useMonthlyMetrics } = await import('@/hooks/useMonthlyMetrics');
  const { result } = renderHook(
    () =>
      useMonthlyMetrics('rest-1', new Date('2026-08-01T12:00:00Z'), new Date('2026-08-27T12:00:00Z')),
    { wrapper: createWrapper() },
  );
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  return result;
}

describe('useMonthlyMetrics failure classification', () => {
  beforeEach(() => {
    fromMock.mockClear();
    rpcMock.mockClear();
  });

  it('treats an employees fetch error as fatal', async () => {
    mode = 'employees-error';
    const result = await renderMetrics();
    expect(result.current.error).not.toBeNull();
  });

  it('treats a manual payments fetch error as soft with a warning', async () => {
    mode = 'manual-error';
    const result = await renderMetrics();
    expect(result.current.error).toBeNull();
    expect(result.current.warnings).toContain(
      'The manual payment rows failed to load. The labor cost figure is incomplete.'
    );
  });

  it('treats a unified sales totals RPC error as soft with a fallback warning', async () => {
    mode = 'rpc-unified-error';
    const result = await renderMetrics();
    expect(result.current.error).toBeNull();
    expect(result.current.warnings.some((w) => w.includes('fallback formula'))).toBe(true);
  });
});
