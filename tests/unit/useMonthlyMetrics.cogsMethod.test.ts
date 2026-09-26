/**
 * Regression test for `useMonthlyMetrics`'s handling of the removed
 * 'combined' COGS method (plan:
 * docs/superpowers/plans/2026-08-30-remove-combined-cogs-method-plan.md,
 * Task 4).
 *
 * A legacy row can still store `cogs_calculation_method: 'combined'` until
 * the data migration runs. The hook must normalize that value with
 * `normalizeCOGSMethod` (falling back to 'inventory') instead of treating
 * 'combined' as "use both sources" — summing inventory and financial COGS
 * would double-count food cost.
 */
import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { timezone: 'UTC' } },
  }),
}));

const RESTAURANT = 'rest-cogs-method-1';
const DATE_FROM = new Date('2026-04-01T00:00:00.000Z');
const DATE_TO = new Date('2026-04-30T00:00:00.000Z');

// Generic chainable Supabase query-builder mock for tables/RPCs we don't
// assert on — resolves to a fixed payload regardless of which chain methods
// were called (mirrors the pattern used by useMonthlyMetrics.pagination.test.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChainable(data: unknown = []): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  ['select', 'eq', 'in', 'order', 'gte', 'lte', 'lt', 'is', 'or', 'limit', 'range'].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data, error: null }));
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data, error: null });
  return chain;
}

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

describe('useMonthlyMetrics COGS method normalization', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('treats a legacy "combined" setting as inventory-only, never summing both sources', async () => {
    const fromMock = vi.fn((table: string) => {
      if (table === 'restaurant_financial_settings') {
        return makeChainable({ cogs_calculation_method: 'combined' });
      }
      // The hook reads inventory COGS from the get_inventory_usage_by_day
      // RPC, not from the inventory_transactions table. The RPC mock below
      // supplies the $100 inventory fixture.
      if (table === 'bank_transactions') {
        // Distinguish the split-parents query (`.eq('is_split', true)`) from
        // every other bank_transactions query (COGS, labor) by tracking the
        // last `is_split` filter applied to this chain instance.
        let lastIsSplit: unknown;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chain: any = {};
        ['select', 'in', 'gte', 'lte', 'lt', 'limit', 'order', 'range', 'or', 'is'].forEach((m) => {
          chain[m] = vi.fn(() => chain);
        });
        chain.eq = vi.fn((col: string, val: unknown) => {
          if (col === 'is_split') lastIsSplit = val;
          return chain;
        });
        // Route to the right fixed payload once all chain calls are done.
        chain.then = (resolve: (v: { data: unknown; error: null }) => void) => {
          if (lastIsSplit === false) {
            return resolve({
              data: [
                {
                  transaction_date: '2026-04-15T00:00:00+00:00',
                  amount: -50,
                  chart_of_accounts: { account_subtype: 'food_cost' },
                },
              ],
              error: null,
            });
          }
          return resolve({ data: [], error: null });
        };
        return chain;
      }
      return makeChainable([]);
    });

    vi.doMock('@/integrations/supabase/client', () => ({
      supabase: {
        from: fromMock,
        rpc: vi.fn((name: string) => {
          if (name === 'get_inventory_usage_by_day') {
            return Promise.resolve({
              data: [{ day: '2026-04-10', food_cost: 100 }],
              error: null,
            });
          }
          if (name === 'get_revenue_by_account') return Promise.resolve({ data: [], error: null });
          if (name === 'get_pass_through_totals') return Promise.resolve({ data: [], error: null });
          if (name === 'get_unified_sales_totals') {
            return Promise.resolve({
              data: [{ total_count: 0, revenue: 0, discounts: 0, pass_through_amount: 0, unique_items: 0, collected_at_pos: 0 }],
              error: null,
            });
          }
          return Promise.resolve({ data: [], error: null });
        }),
      },
    }));

    const { useMonthlyMetrics } = await import('@/hooks/useMonthlyMetrics');

    const { result } = renderHook(() => useMonthlyMetrics(RESTAURANT, DATE_FROM, DATE_TO), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      if (result.current.error) throw result.current.error;
      expect(result.current.isLoading).toBe(false);
      expect(result.current.data).not.toBeNull();
    });

    const april = result.current.data?.find((m) => m.period === '2026-04');
    expect(april).toBeDefined();
    // Inventory cost only: $100. If 'combined' were still treated as "use
    // both sources", this would be $150 (100 inventory + 50 financial).
    expect(april!.food_cost).toBe(100);
  });
});
