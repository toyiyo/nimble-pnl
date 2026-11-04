import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

vi.mock('@/services/cogsFetch', () => ({
  COGS_MAX_PAGES: 50,
  fetchFinancialCOGSRows: async () => ({
    bankTxns: [
      { transaction_date: '2026-08-01', amount: -40, chart_of_accounts: { account_subtype: 'food_cost' } },
    ],
    splitItems: [],
    parentDateMap: new Map(),
    pendingTxns: [
      { issue_date: '2026-08-02', amount: -10, chart_of_accounts: { account_subtype: 'beverage_cost' } },
    ],
    capped: true,
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

describe('useCOGSFromFinancials with the paged helper', () => {
  it('aggregates the helper rows and passes the capped flag through', async () => {
    const { useCOGSFromFinancials } = await import('@/hooks/useCOGSFromFinancials');

    const { result } = renderHook(
      () =>
        useCOGSFromFinancials('rest-1', new Date('2026-08-01T12:00:00Z'), new Date('2026-08-27T12:00:00Z')),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.dailyCosts).toEqual([
      { date: '2026-08-01', total_cost: 40 },
      { date: '2026-08-02', total_cost: 10 },
    ]);
    expect(result.current.totalCost).toBe(50);
    expect(result.current.capped).toBe(true);
  });
});
