import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// useLaborCostsFromTransactions must pass the loader's `capped` flag to the
// caller, so a truncated bank labor read is not silent.
const { loadPeriodBankLabor } = vi.hoisted(() => ({
  loadPeriodBankLabor: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../../supabase/functions/_shared/labor/periodLaborCost', () => ({
  loadPeriodBankLabor,
}));

import { useLaborCostsFromTransactions } from '@/hooks/useLaborCostsFromTransactions';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

describe('useLaborCostsFromTransactions capped', () => {
  it.each([true, false])('returns capped = %s from the loader', async (capped) => {
    loadPeriodBankLabor.mockResolvedValueOnce({ dailyCosts: [], totalCost: 0, capped });
    const { result } = renderHook(
      () => useLaborCostsFromTransactions('rest-1', new Date(2026, 6, 1), new Date(2026, 6, 31)),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.capped).toBe(capped);
  });
});
