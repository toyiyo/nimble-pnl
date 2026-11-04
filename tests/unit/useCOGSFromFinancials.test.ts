import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Mocks
//
// useCOGSFromFinancials no longer builds its own supabase queries — it
// delegates row fetching to fetchFinancialCOGSRows (tested against a real
// supabase chain in cogsFetch.test.ts). This file mocks that helper and
// keeps only the assertions that belong to the hook: does it feed the
// helper's rows into aggregateFinancialCOGSByDate correctly, and does it
// shape the result the way callers expect.
// ---------------------------------------------------------------------------

const mockFetchFinancialCOGSRows = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

vi.mock('@/services/cogsFetch', () => ({
  COGS_MAX_PAGES: 50,
  fetchFinancialCOGSRows: mockFetchFinancialCOGSRows,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { useCOGSFromFinancials } from '@/hooks/useCOGSFromFinancials';
import { toUtcDayKey } from '@/services/cogsCalculations';
import { format } from 'date-fns';

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
    account_subtype?: string | null;
  } = {},
) {
  return {
    id: overrides.id ?? 'bt-1',
    transaction_date: overrides.transaction_date ?? '2026-03-02T00:00:00Z',
    amount: overrides.amount ?? -150,
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
 * Points the mocked fetchFinancialCOGSRows at the given rows, matching the
 * shape the real helper returns (parentDateMap keyed by the UTC day of each
 * split parent, same as the hook expects).
 */
function setupMocks(options: {
  bankTxns?: unknown[];
  splitParents?: { id: string; transaction_date: string }[];
  splitItems?: unknown[];
  pendingOutflows?: unknown[];
  capped?: boolean;
}) {
  const {
    bankTxns = [],
    splitParents = [],
    splitItems = [],
    pendingOutflows = [],
    capped = false,
  } = options;

  const parentDateMap = new Map<string, string>();
  for (const p of splitParents) {
    parentDateMap.set(p.id, toUtcDayKey(p.transaction_date));
  }

  mockFetchFinancialCOGSRows.mockResolvedValue({
    bankTxns,
    splitItems,
    parentDateMap,
    pendingTxns: pendingOutflows,
    capped,
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

  it('calls fetchFinancialCOGSRows with the restaurant id and formatted date range', async () => {
    setupMocks({});

    const { result } = renderHook(
      () => useCOGSFromFinancials('rest-123', DATE_FROM, DATE_TO),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockFetchFinancialCOGSRows).toHaveBeenCalledWith(
      expect.anything(),
      'rest-123',
      format(DATE_FROM, 'yyyy-MM-dd'),
      format(DATE_TO, 'yyyy-MM-dd'),
    );
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

  it('passes the capped flag through from the helper', async () => {
    setupMocks({
      bankTxns: [bankTxn({ id: 'bt-1', amount: -10, account_subtype: 'food_cost' })],
      capped: true,
    });

    const { result } = renderHook(
      () => useCOGSFromFinancials('rest-123', DATE_FROM, DATE_TO),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.capped).toBe(true);
  });

  it('returns empty when restaurantId is null', async () => {
    // Should NOT call the fetch helper at all
    const { result } = renderHook(
      () => useCOGSFromFinancials(null, DATE_FROM, DATE_TO),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.dailyCosts).toEqual([]);
    expect(result.current.totalCost).toBe(0);
    expect(result.current.capped).toBe(false);
    expect(mockFetchFinancialCOGSRows).not.toHaveBeenCalled();
  });
});
