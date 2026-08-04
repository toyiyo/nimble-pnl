import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useTimePunches } from '@/hooks/useTimePunches';

// Regression test: `useTimePunches` previously returned `data || []`, which
// allocates a brand-new empty array literal on every render while the query
// is still loading (data === undefined). Combined with a consumer that
// depends on that array in a useMemo/useEffect chain and writes state back
// (see src/pages/Tips.tsx's punch-derived-hours effects), this produced a
// genuine "Maximum update depth exceeded" infinite render loop — the loop
// runs synchronously, faster than the underlying network fetch, so it never
// gets a chance to resolve and break the cycle on its own.
//
// The fix returns a module-level stable empty array while loading, so any
// memo/effect keyed on `punches` only re-runs when the data actually
// changes.

// `useTimePunches` chains `.select().eq().gte().lte().order().order().range()`,
// so the mock has to be chainable all the way down; only awaiting it hangs,
// which is what pins the query in its loading state.
vi.mock('@/integrations/supabase/client', async () => {
  const { neverResolvingBuilder } = await import('../helpers/supabaseBuilderMock');
  return { supabase: { from: () => neverResolvingBuilder() } };
});

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe('useTimePunches — referential stability while loading', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  // The mocked query never resolves, so tear the cache down between tests to
  // avoid leaking a pending observer into the next one.
  afterEach(() => {
    queryClient.clear();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it('returns the SAME array reference across re-renders while the query is still loading', () => {
    const startDate = new Date('2026-08-02T00:00:00Z');
    const endDate = new Date('2026-08-02T23:59:59Z');

    const { result, rerender } = renderHook(
      () => useTimePunches('restaurant-1', undefined, startDate, endDate),
      { wrapper },
    );

    const first = result.current.punches;
    expect(result.current.loading).toBe(true);
    expect(first).toEqual([]);

    rerender();
    rerender();
    rerender();

    expect(result.current.punches).toBe(first);
  });
});
