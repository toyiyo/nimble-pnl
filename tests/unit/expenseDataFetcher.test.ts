import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Supabase client BEFORE importing the module under test.
const txnRows = [
  {
    id: 'tx-expense-1',
    transaction_date: '2026-04-15',
    amount: -100,
    status: 'posted',
    description: 'Real expense',
    merchant_name: null,
    normalized_payee: null,
    category_id: 'cat-expense',
    is_split: false,
    ai_confidence: null,
    chart_of_accounts: {
      account_name: 'Office Supplies',
      account_subtype: 'office_supplies',
      account_type: 'expense',
    },
  },
  {
    id: 'tx-transfer-1',
    transaction_date: '2026-04-15',
    amount: -500,
    status: 'posted',
    description: 'Transfer to savings',
    merchant_name: null,
    normalized_payee: null,
    category_id: 'cat-transfer',
    is_split: false,
    ai_confidence: null,
    chart_of_accounts: {
      account_name: 'Transfer Clearing Account',
      account_subtype: 'cash',
      account_type: 'asset',
    },
  },
];

const pendingOutflowRows = [
  {
    amount: 200,
    category_id: 'cat-expense',
    issue_date: '2026-04-10',
    status: 'pending',
    chart_account: {
      account_name: 'Office Supplies',
      account_subtype: 'office_supplies',
      account_type: 'expense',
    },
  },
  {
    amount: 800,
    category_id: 'cat-transfer',
    issue_date: '2026-04-10',
    status: 'pending',
    chart_account: {
      account_name: 'Transfer Clearing Account',
      account_subtype: 'cash',
      account_type: 'asset',
    },
  },
];

const splitRows = [
  {
    transaction_id: 'tx-split-parent',
    amount: 50,
    category_id: 'cat-expense',
    chart_of_accounts: {
      account_name: 'Office Supplies',
      account_subtype: 'office_supplies',
      account_type: 'expense',
    },
  },
  {
    transaction_id: 'tx-split-parent',
    amount: 70,
    category_id: 'cat-equity',
    chart_of_accounts: {
      account_name: 'Inter-Account Transfer',
      account_subtype: 'owners_equity',
      account_type: 'equity',
    },
  },
];

// We need the mocked builder to be readable by the test, so define it once
// and reuse across the three .from() calls.
function makeQuery(returnRows: unknown) {
  const builder: Record<string, unknown> = {};
  const passthrough = () => builder;
  for (const m of ['select', 'eq', 'in', 'is', 'lt', 'lte', 'gte']) {
    builder[m] = vi.fn(passthrough);
  }
  builder.order = vi.fn().mockResolvedValue({ data: returnRows, error: null });
  // For pending_outflows / splits the call doesn't end in .order — return data directly.
  // We make these chainable methods also resolve when awaited as the terminal call.
  for (const m of ['eq', 'in', 'is', 'lte', 'gte']) {
    (builder[m] as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Object.assign(builder, {
        then: (cb: (v: { data: unknown; error: null }) => unknown) =>
          cb({ data: returnRows, error: null }),
      }),
    );
  }
  return builder;
}

vi.mock('@/integrations/supabase/client', () => {
  return {
    supabase: {
      from: vi.fn((table: string) => {
        if (table === 'bank_transactions') return makeQuery(txnRows);
        if (table === 'pending_outflows') return makeQuery(pendingOutflowRows);
        if (table === 'bank_transaction_splits') return makeQuery(splitRows);
        throw new Error(`Unexpected table: ${table}`);
      }),
    },
  };
});

import { fetchExpenseData } from '@/lib/expenseDataFetcher';

describe('fetchExpenseData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('excludes bank transactions whose category is asset/liability/equity-typed', async () => {
    const result = await fetchExpenseData({
      restaurantId: 'r-1',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-04-30'),
    });

    const ids = result.transactions.map((t) => t.id);
    expect(ids).toContain('tx-expense-1');
    expect(ids).not.toContain('tx-transfer-1');
  });

  it('excludes pending outflows whose category is asset/liability/equity-typed', async () => {
    const result = await fetchExpenseData({
      restaurantId: 'r-1',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-04-30'),
    });

    const amounts = result.pendingOutflows.map((p) => p.amount);
    expect(amounts).toContain(200);
    expect(amounts).not.toContain(800);
  });

  it('excludes split line items whose category is asset/liability/equity-typed', async () => {
    // Make the parent appear as a split-parent so split lookup runs.
    txnRows.push({
      id: 'tx-split-parent',
      transaction_date: '2026-04-15',
      amount: -120,
      status: 'posted',
      description: 'Split parent',
      merchant_name: null,
      normalized_payee: null,
      category_id: null,
      is_split: true,
      ai_confidence: null,
      chart_of_accounts: null,
    } as never);

    const result = await fetchExpenseData({
      restaurantId: 'r-1',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-04-30'),
    });

    const splitAmounts = result.splitDetails.map((s) => s.amount);
    expect(splitAmounts).toContain(50);
    expect(splitAmounts).not.toContain(70);

    txnRows.pop();
  });
});
