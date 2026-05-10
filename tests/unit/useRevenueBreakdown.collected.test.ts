/**
 * Regression: useRevenueBreakdown.totals.total_collected_at_pos must equal
 * the deposit-matching SUM(unified_sales.total_price) over the period —
 * i.e. the value returned by `get_unified_sales_totals` and shown on the
 * POS Sales page.
 *
 * The old formula `gross + tax + tips + other_liabilities` excluded
 * void/discount offset rows and produced a value that diverged from the
 * deposit and from the POS Sales page collected total.
 *
 * For Russo's Pizzeria May 2026 the canonical value is $31,596.36.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';

const mockRpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: vi.fn(),
  },
}));

const createWrapper = () => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
};

describe('useRevenueBreakdown — Collected at POS source of truth', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockRpc.mockImplementation((name: string) => {
      if (name === 'get_revenue_by_account') {
        return Promise.resolve({
          data: [
            {
              account_id: 'food',
              account_code: '4000',
              account_name: 'Food Sales',
              account_type: 'revenue',
              account_subtype: 'food_sales',
              total_amount: 26903.04,
              transaction_count: 362,
              is_categorized: true,
            },
          ],
          error: null,
        });
      }
      if (name === 'get_pass_through_totals') {
        return Promise.resolve({
          data: [
            { adjustment_type: 'tax',      total_amount: 2101.05, transaction_count: 100 },
            { adjustment_type: 'tip',      total_amount: 3946.71, transaction_count: 80 },
            { adjustment_type: 'discount', total_amount: -625.04, transaction_count: 5 },
          ],
          error: null,
        });
      }
      if (name === 'get_unified_sales_totals') {
        return Promise.resolve({
          data: [
            {
              total_count: 800,
              revenue: 26903.04,
              discounts: 625.04,
              pass_through_amount: 6047.76,
              unique_items: 362,
              collected_at_pos: 31596.36,
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
  });

  it('returns total_collected_at_pos = $31,596.36 for Russo May 2026', async () => {
    const { useRevenueBreakdown } = await import('@/hooks/useRevenueBreakdown');

    const dateFrom = new Date(2026, 4, 1);  // 2026-05-01 local
    const dateTo = new Date(2026, 4, 31);   // 2026-05-31 local

    const { result } = renderHook(
      () => useRevenueBreakdown('adbd9392-928a-4a46-80d7-f7e453aa1956', dateFrom, dateTo),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toBeDefined();
    expect(result.current.data!.totals.total_collected_at_pos).toBeCloseTo(31596.36, 2);
    expect(result.current.data!.totals.gross_revenue).toBeCloseTo(26903.04, 2);
    expect(result.current.data!.totals.net_revenue).toBeCloseTo(26278.00, 2);
  });
});
