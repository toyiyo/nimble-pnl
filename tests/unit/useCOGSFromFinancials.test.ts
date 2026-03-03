import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { useCOGSFromFinancials } from '@/hooks/useCOGSFromFinancials';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

/**
 * Creates a fluent mock chain for supabase query builders.
 * Terminates with the given resolved value when the chain ends
 * (i.e. when no more chainable methods are called).
 *
 * Every method returns `this` so calls can be chained in any order.
 * The final `.limit()` call resolves the promise.
 */
function createChainBuilder(resolvedValue: { data: unknown; error: unknown }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};

  const self = () => builder;

  builder.select = vi.fn().mockImplementation(self);
  builder.eq = vi.fn().mockImplementation(self);
  builder.in = vi.fn().mockImplementation(self);
  builder.is = vi.fn().mockImplementation(self);
  builder.lt = vi.fn().mockImplementation(self);
  builder.gte = vi.fn().mockImplementation(self);
  builder.lte = vi.fn().mockImplementation(self);
  builder.order = vi.fn().mockImplementation(self);
  builder.limit = vi.fn().mockResolvedValue(resolvedValue);

  return builder;
}

const DATE_FROM = new Date('2026-03-01');
const DATE_TO = new Date('2026-03-07');

// ---------------------------------------------------------------------------
// Factory helpers for test data
// ---------------------------------------------------------------------------

function bankTxn(
  overrides: {
    id?: string;
    transaction_date?: string;
    amount?: number;
    is_split?: boolean;
    account_subtype?: string | null;
  } = {},
) {
  return {
    id: overrides.id ?? 'bt-1',
    transaction_date: overrides.transaction_date ?? '2026-03-02T00:00:00Z',
    amount: overrides.amount ?? -150,
    is_split: overrides.is_split ?? false,
    chart_of_accounts: overrides.account_subtype !== undefined
      ? overrides.account_subtype !== null
        ? { account_subtype: overrides.account_subtype }
        : null
      : { account_subtype: 'food_cost' },
  };
}

function splitParent(id: string, date: string) {
  return { id, transaction_date: date };
}

function splitItem(
  transactionId: string,
  amount: number,
  accountSubtype: string | null,
) {
  return {
    transaction_id: transactionId,
    amount,
    chart_of_accounts: accountSubtype !== null
      ? { account_subtype: accountSubtype }
      : null,
  };
}

function pendingOutflow(
  overrides: {
    id?: string;
    issue_date?: string;
    amount?: number;
    account_subtype?: string | null;
  } = {},
) {
  return {
    id: overrides.id ?? 'po-1',
    issue_date: overrides.issue_date ?? '2026-03-03',
    amount: overrides.amount ?? 80,
    chart_of_accounts: overrides.account_subtype !== undefined
      ? overrides.account_subtype !== null
        ? { account_subtype: overrides.account_subtype }
        : null
      : { account_subtype: 'cost_of_goods_sold' },
  };
}

/**
 * Sets up mockSupabase.from to return different chain builders per table.
 *
 * callIndex tracks sequential calls to `.from()` within a single queryFn invocation.
 * The hook makes calls in this order:
 *   0 → bank_transactions (non-split)
 *   1 → bank_transactions (split parents)
 *   2 → bank_transaction_splits (only if split parents exist)
 *   3 → pending_outflows
 */
function setupMocks(options: {
  bankTxns?: unknown[];
  splitParents?: unknown[];
  splitItems?: unknown[];
  pendingOutflows?: unknown[];
  bankError?: unknown;
  splitParentError?: unknown;
  splitsError?: unknown;
  pendingError?: unknown;
}) {
  const {
    bankTxns = [],
    splitParents = [],
    splitItems = [],
    pendingOutflows = [],
    bankError = null,
    splitParentError = null,
    splitsError = null,
    pendingError = null,
  } = options;

  const bankChain = createChainBuilder({ data: bankTxns, error: bankError });
  const splitParentChain = createChainBuilder({ data: splitParents, error: splitParentError });
  const splitsChain = createChainBuilder({ data: splitItems, error: splitsError });
  const pendingChain = createChainBuilder({ data: pendingOutflows, error: pendingError });

  let callIndex = 0;
  mockSupabase.from.mockImplementation((table: string) => {
    const idx = callIndex++;
    if (table === 'bank_transactions') {
      // First call (idx 0) is non-split bank txns, second call (idx 1) is split parents
      return idx === 0 ? bankChain : splitParentChain;
    }
    if (table === 'bank_transaction_splits') {
      return splitsChain;
    }
    if (table === 'pending_outflows') {
      return pendingChain;
    }
    // fallback
    return createChainBuilder({ data: [], error: null });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useCOGSFromFinancials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 0 when no COGS transactions exist', async () => {
    setupMocks({});

    const { result } = renderHook(
      () => useCOGSFromFinancials('rest-123', DATE_FROM, DATE_TO),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.dailyCosts).toEqual([]);
    expect(result.current.totalCost).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('sums bank transactions with COGS subtypes correctly (uses Math.abs)', async () => {
    setupMocks({
      bankTxns: [
        bankTxn({ id: 'bt-1', transaction_date: '2026-03-02T12:00:00Z', amount: -150, account_subtype: 'food_cost' }),
        bankTxn({ id: 'bt-2', transaction_date: '2026-03-02T15:00:00Z', amount: -50, account_subtype: 'beverage_cost' }),
        bankTxn({ id: 'bt-3', transaction_date: '2026-03-04T10:00:00Z', amount: -200, account_subtype: 'packaging_cost' }),
      ],
    });

    const { result } = renderHook(
      () => useCOGSFromFinancials('rest-123', DATE_FROM, DATE_TO),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // March 2: 150 + 50 = 200, March 4: 200
    expect(result.current.dailyCosts).toEqual([
      { date: '2026-03-02', total_cost: 200 },
      { date: '2026-03-04', total_cost: 200 },
    ]);
    expect(result.current.totalCost).toBe(400);
  });

  it('excludes bank transactions with non-COGS subtypes', async () => {
    setupMocks({
      bankTxns: [
        bankTxn({ id: 'bt-1', amount: -150, account_subtype: 'food_cost' }),
        bankTxn({ id: 'bt-2', amount: -300, account_subtype: 'labor' }),
        bankTxn({ id: 'bt-3', amount: -100, account_subtype: 'rent' }),
        bankTxn({ id: 'bt-4', amount: -75, account_subtype: null }), // uncategorised
      ],
    });

    const { result } = renderHook(
      () => useCOGSFromFinancials('rest-123', DATE_FROM, DATE_TO),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Only bt-1 (food_cost) should be included
    expect(result.current.totalCost).toBe(150);
  });

  it('includes split line items categorised as COGS', async () => {
    setupMocks({
      bankTxns: [],
      splitParents: [
        splitParent('sp-1', '2026-03-03T12:00:00Z'),
      ],
      splitItems: [
        splitItem('sp-1', -120, 'food_cost'),
        splitItem('sp-1', -80, 'beverage_cost'),
        splitItem('sp-1', -50, 'labor'), // not COGS — should be excluded
      ],
    });

    const { result } = renderHook(
      () => useCOGSFromFinancials('rest-123', DATE_FROM, DATE_TO),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // 120 + 80 = 200 (labor excluded)
    expect(result.current.dailyCosts).toEqual([
      { date: '2026-03-03', total_cost: 200 },
    ]);
    expect(result.current.totalCost).toBe(200);
  });

  it('includes pending outflows categorised as COGS', async () => {
    setupMocks({
      bankTxns: [],
      pendingOutflows: [
        pendingOutflow({ id: 'po-1', issue_date: '2026-03-05', amount: 90, account_subtype: 'cost_of_goods_sold' }),
        pendingOutflow({ id: 'po-2', issue_date: '2026-03-05', amount: 60, account_subtype: 'food_cost' }),
      ],
    });

    const { result } = renderHook(
      () => useCOGSFromFinancials('rest-123', DATE_FROM, DATE_TO),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.dailyCosts).toEqual([
      { date: '2026-03-05', total_cost: 150 },
    ]);
    expect(result.current.totalCost).toBe(150);
  });

  it('excludes transfer transactions (only non-split bank query has is_transfer=false filter)', async () => {
    // The hook explicitly filters is_transfer=false in both bank_transactions queries.
    // We verify the filter is applied by checking the .eq calls.
    setupMocks({});

    const { result } = renderHook(
      () => useCOGSFromFinancials('rest-123', DATE_FROM, DATE_TO),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // The first .from('bank_transactions') call should have eq('is_transfer', false)
    // Both bank_transactions calls should filter transfers
    const fromCalls = mockSupabase.from.mock.calls;
    expect(fromCalls[0][0]).toBe('bank_transactions');
    expect(fromCalls[1][0]).toBe('bank_transactions');

    // Verify is_transfer filter was applied (the chain builder .eq was called with 'is_transfer', false)
    // Since we use a shared chain builder, we can check the .eq calls on both chains.
    // The non-split chain (first from call) should have eq called with 'is_transfer', false
    const bankChain = mockSupabase.from.mock.results[0].value;
    const eqCalls = bankChain.eq.mock.calls;
    const hasTransferFilter = eqCalls.some(
      (call: unknown[]) => call[0] === 'is_transfer' && call[1] === false,
    );
    expect(hasTransferFilter).toBe(true);
  });

  it('returns daily aggregation by transaction_date', async () => {
    setupMocks({
      bankTxns: [
        bankTxn({ id: 'bt-1', transaction_date: '2026-03-01T08:00:00Z', amount: -100, account_subtype: 'food_cost' }),
        bankTxn({ id: 'bt-2', transaction_date: '2026-03-03T14:00:00Z', amount: -50, account_subtype: 'food_cost' }),
      ],
      splitParents: [
        splitParent('sp-1', '2026-03-01T12:00:00Z'),
      ],
      splitItems: [
        splitItem('sp-1', -30, 'beverage_cost'),
      ],
      pendingOutflows: [
        pendingOutflow({ id: 'po-1', issue_date: '2026-03-03', amount: 70, account_subtype: 'packaging_cost' }),
      ],
    });

    const { result } = renderHook(
      () => useCOGSFromFinancials('rest-123', DATE_FROM, DATE_TO),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // March 1: bank 100 + split 30 = 130
    // March 3: bank 50 + pending 70 = 120
    expect(result.current.dailyCosts).toEqual([
      { date: '2026-03-01', total_cost: 130 },
      { date: '2026-03-03', total_cost: 120 },
    ]);
    expect(result.current.totalCost).toBe(250);
  });

  it('returns empty when restaurantId is null', async () => {
    // Should NOT call supabase at all
    const { result } = renderHook(
      () => useCOGSFromFinancials(null, DATE_FROM, DATE_TO),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.dailyCosts).toEqual([]);
    expect(result.current.totalCost).toBe(0);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });
});
