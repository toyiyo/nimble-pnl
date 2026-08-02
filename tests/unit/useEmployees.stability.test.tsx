import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useEmployees } from '@/hooks/useEmployees';

// Regression test: `useEmployees` previously returned `data || []`, which
// allocates a brand-new empty array literal on every render while the query
// is still loading (data === undefined). A consumer that derives a useMemo
// from `employees` and writes state back inside a useEffect keyed on that
// memo (see src/pages/Tips.tsx) would see a "new" eligible-employees list on
// every single render, re-run its effect, write state, and never converge —
// a genuine "Maximum update depth exceeded" infinite render loop that fires
// before the underlying query even has a chance to resolve.
//
// The fix returns a module-level stable empty array while loading, so any
// memo/effect keyed on `employees` only re-runs when the data actually
// changes.

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => new Promise(() => {}), // never resolves — stays "loading" forever
      }),
    }),
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe('useEmployees — referential stability while loading', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it('returns the SAME array reference across re-renders while the query is still loading', () => {
    const { result, rerender } = renderHook(
      () => useEmployees('restaurant-1', { status: 'active' }),
      { wrapper },
    );

    const first = result.current.employees;
    expect(result.current.loading).toBe(true);
    expect(first).toEqual([]);

    // Force several re-renders (mirrors the extra renders a parent component
    // like Tips.tsx produces while other state settles) without the query
    // ever resolving.
    rerender();
    rerender();
    rerender();

    expect(result.current.employees).toBe(first);
  });

  it('is stable even when a fresh options object literal is passed on every render (the real Tips.tsx call shape)', () => {
    const { result, rerender } = renderHook(
      () => useEmployees('restaurant-1', { status: 'active' }), // new object every call
      { wrapper },
    );

    const first = result.current.employees;
    rerender();
    rerender();

    expect(result.current.employees).toBe(first);
  });
});
