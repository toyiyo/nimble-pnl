import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockTxns = [
  // Real revenue
  {
    transaction_date: '2026-04-10',
    amount: 1000,
    status: 'posted',
    description: 'Sales deposit',
    merchant_name: null,
    category_id: 'cat-revenue',
    is_split: false,
    chart_of_accounts: {
      account_name: 'Sales',
      account_subtype: 'food_revenue',
      account_type: 'revenue',
    },
  },
  // Inflow that's actually a transfer (should NOT be revenue)
  {
    transaction_date: '2026-04-11',
    amount: 500,
    status: 'posted',
    description: 'Transfer in from savings',
    merchant_name: null,
    category_id: 'cat-transfer',
    is_split: false,
    chart_of_accounts: {
      account_name: 'Transfer Clearing Account',
      account_subtype: 'cash',
      account_type: 'asset',
    },
  },
  // Real food cost
  {
    transaction_date: '2026-04-12',
    amount: -200,
    status: 'posted',
    description: 'Vendor invoice',
    merchant_name: null,
    category_id: 'cat-cogs',
    is_split: false,
    chart_of_accounts: {
      account_name: 'Food Cost',
      account_subtype: 'cost_of_goods_sold',
      account_type: 'expense',
    },
  },
  // Outflow that's actually a transfer (should NOT count as expense)
  {
    transaction_date: '2026-04-13',
    amount: -700,
    status: 'posted',
    description: 'Transfer to savings',
    merchant_name: null,
    category_id: 'cat-transfer',
    is_split: false,
    chart_of_accounts: {
      account_name: 'Transfer Clearing Account',
      account_subtype: 'cash',
      account_type: 'asset',
    },
  },
];

const txEqSpy = vi.fn();

function makeTxBuilder() {
  const builder: Record<string, unknown> = {};
  const passthrough = () => builder;
  builder.select = vi.fn(passthrough);
  builder.eq = vi.fn((...args: unknown[]) => {
    txEqSpy(...args);
    return builder;
  });
  builder.in = vi.fn(passthrough);
  builder.gte = vi.fn(passthrough);
  builder.lte = vi.fn(passthrough);
  // Make builder thenable so `await txQuery` resolves
  (builder as { then: (cb: (v: unknown) => unknown) => unknown }).then = (cb) =>
    cb({ data: mockTxns, error: null });
  return builder;
}

function makeBalanceBuilder() {
  const builder: Record<string, unknown> = {};
  const passthrough = () => builder;
  builder.select = vi.fn(passthrough);
  builder.eq = vi.fn(passthrough);
  (builder as { then: (cb: (v: unknown) => unknown) => unknown }).then = (cb) =>
    cb({ data: [], error: null });
  return builder;
}

vi.mock('@/integrations/supabase/client', () => {
  return {
    supabase: {
      from: vi.fn((table: string) => {
        if (table === 'bank_transactions') return makeTxBuilder();
        if (table === 'bank_account_balances') return makeBalanceBuilder();
        throw new Error(`Unexpected table: ${table}`);
      }),
    },
  };
});

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'r-1' },
  }),
}));

import { useExpenseHealth } from '@/hooks/useExpenseHealth';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useExpenseHealth', () => {
  beforeEach(() => {
    txEqSpy.mockClear();
  });

  it('applies is_transfer = false in the query', async () => {
    renderHook(
      () => useExpenseHealth(new Date('2026-04-01'), new Date('2026-04-30')),
      { wrapper },
    );

    await waitFor(() => {
      expect(txEqSpy).toHaveBeenCalledWith('is_transfer', false);
    });
  });

  it('excludes asset/liability/equity inflows from revenue and outflows from cost totals', async () => {
    const { result } = renderHook(
      () => useExpenseHealth(new Date('2026-04-01'), new Date('2026-04-30')),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const data = result.current.data!;
    // Revenue should be 1000 (the +500 transfer is excluded).
    // foodCost / revenue = 200 / 1000 = 20%
    expect(data.foodCostPercentage).toBeCloseTo(20, 5);
    // The +500 transfer must NOT have inflated revenue (else foodCostPct would be ~13.3%).
    expect(data.foodCostPercentage).not.toBeCloseTo((200 / 1500) * 100, 2);
  });
});
