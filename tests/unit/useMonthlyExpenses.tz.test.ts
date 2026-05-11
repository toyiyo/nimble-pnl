/**
 * Regression: useMonthlyExpenses must bucket each row by the UTC day stored on
 * the row, not by the host-local day.
 *
 * Russo's Pizzeria (America/Chicago) had a $216.75 COGS bank transaction stored
 * as `transaction_date = '2026-05-01T00:00:00+00:00'`. The previous
 * implementation called `format(new Date(t.transaction_date), 'yyyy-MM')`,
 * which parses UTC then re-formats in the host TZ. In Chicago that yielded
 * `'2026-04'`, so the row landed in April's bucket and Monthly Performance
 * reported $3,787 of COGS instead of $4,003.73 for May.
 *
 * The same bug affects split parents and pending_outflows (issue_date DATE).
 *
 * Pin TZ=America/Chicago and assert each row buckets into '2026-05'.
 *
 * Companion to tests/unit/cogsCalculations.tz.test.ts which covers the
 * shared day-level helper used by useCOGSFromFinancials.
 */

process.env.TZ = 'America/Chicago';

import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Mocks — stub fetchExpenseData so we can drive the hook with synthetic rows
// ---------------------------------------------------------------------------

const mockFetchExpenseData = vi.hoisted(() => vi.fn());

vi.mock('@/lib/expenseDataFetcher', () => ({
  fetchExpenseData: mockFetchExpenseData,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { useMonthlyExpenses } from '@/hooks/useMonthlyExpenses';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

const DATE_FROM = new Date('2026-04-01T00:00:00Z');
const DATE_TO = new Date('2026-05-31T23:59:59Z');

describe('useMonthlyExpenses — TZ bucketing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('confirms the host process is on America/Chicago (Russo TZ)', () => {
    // Defensive: if this fails, the rest of the suite will produce false
    // negatives because the bug is host-TZ-dependent.
    expect(new Date().getTimezoneOffset()).toBeGreaterThan(0);
  });

  it('buckets a 00:00 UTC bank txn into its UTC month (2026-05), not the host-local month', async () => {
    mockFetchExpenseData.mockResolvedValue({
      transactions: [
        {
          id: 'bt-may-1',
          transaction_date: '2026-05-01T00:00:00+00:00',
          amount: -216.75,
          is_split: false,
          category_id: 'cat-cogs',
          chart_of_accounts: { account_name: 'Food Cost', account_subtype: 'food_cost' },
        },
      ],
      pendingOutflows: [],
      splitDetails: [],
    });

    const { result } = renderHook(
      () => useMonthlyExpenses('rest-russo', DATE_FROM, DATE_TO),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const may = result.current.data?.find(m => m.period === '2026-05');
    const april = result.current.data?.find(m => m.period === '2026-04');

    expect(may).toBeDefined();
    expect(may?.foodCost).toBeCloseTo(216.75, 2);
    expect(may?.totalExpenses).toBeCloseTo(216.75, 2);
    // The bug would have produced an April row; assert it's not there.
    expect(april).toBeUndefined();
  });

  it('buckets a split parent at 00:00 UTC into the UTC month (2026-05)', async () => {
    mockFetchExpenseData.mockResolvedValue({
      transactions: [
        {
          id: 'bt-split-parent',
          transaction_date: '2026-05-01T00:00:00+00:00',
          amount: -300,
          is_split: true,
          category_id: null,
          chart_of_accounts: null,
        },
      ],
      pendingOutflows: [],
      splitDetails: [
        {
          transaction_id: 'bt-split-parent',
          amount: 200,
          category_id: 'cat-food',
          chart_of_accounts: { account_name: 'Food Cost', account_subtype: 'food_cost' },
        },
        {
          transaction_id: 'bt-split-parent',
          amount: 100,
          category_id: 'cat-rent',
          chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
        },
      ],
    });

    const { result } = renderHook(
      () => useMonthlyExpenses('rest-russo', DATE_FROM, DATE_TO),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const may = result.current.data?.find(m => m.period === '2026-05');
    const april = result.current.data?.find(m => m.period === '2026-04');

    expect(may).toBeDefined();
    expect(may?.foodCost).toBeCloseTo(200, 2);
    expect(may?.totalExpenses).toBeCloseTo(300, 2);
    expect(april).toBeUndefined();
  });

  it('buckets a pending_outflows DATE issue_date by the calendar day in the string', async () => {
    // pending_outflows.issue_date is a Postgres DATE → string 'YYYY-MM-DD'.
    // `new Date('2026-05-01')` ⇒ 00:00 UTC. In Chicago that renders as
    // '2026-04-30' → buggy code would bucket into April.
    mockFetchExpenseData.mockResolvedValue({
      transactions: [],
      pendingOutflows: [
        {
          amount: 55.65,
          category_id: 'cat-labor',
          issue_date: '2026-05-01',
          status: 'pending',
          chart_account: { account_name: 'Labor', account_subtype: 'labor' },
        },
      ],
      splitDetails: [],
    });

    const { result } = renderHook(
      () => useMonthlyExpenses('rest-russo', DATE_FROM, DATE_TO),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const may = result.current.data?.find(m => m.period === '2026-05');
    const april = result.current.data?.find(m => m.period === '2026-04');

    expect(may).toBeDefined();
    expect(may?.laborCost).toBeCloseTo(55.65, 2);
    expect(may?.totalExpenses).toBeCloseTo(55.65, 2);
    expect(april).toBeUndefined();
  });

  it('aggregates Russo May 1 production rows into the correct month bucket', async () => {
    // Composite case mirroring the production discrepancy:
    //   COGS:  $189.05 + $27.70 = $216.75
    //   Labor: $335.36 + $55.65 = $391.01
    mockFetchExpenseData.mockResolvedValue({
      transactions: [
        {
          id: 'bt-cogs-1', transaction_date: '2026-05-01T00:00:00+00:00',
          amount: -189.05, is_split: false, category_id: 'cat-cogs',
          chart_of_accounts: { account_name: 'Food Cost', account_subtype: 'food_cost' },
        },
        {
          id: 'bt-cogs-2', transaction_date: '2026-05-01T00:00:00+00:00',
          amount: -27.70, is_split: false, category_id: 'cat-cogs',
          chart_of_accounts: { account_name: 'Food Cost', account_subtype: 'food_cost' },
        },
        {
          id: 'bt-labor-1', transaction_date: '2026-05-01T00:00:00+00:00',
          amount: -335.36, is_split: false, category_id: 'cat-labor',
          chart_of_accounts: { account_name: 'Labor', account_subtype: 'labor' },
        },
      ],
      pendingOutflows: [
        {
          amount: 55.65, category_id: 'cat-labor', issue_date: '2026-05-01',
          status: 'pending',
          chart_account: { account_name: 'Labor', account_subtype: 'labor' },
        },
      ],
      splitDetails: [],
    });

    const { result } = renderHook(
      () => useMonthlyExpenses('rest-russo', DATE_FROM, DATE_TO),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const may = result.current.data?.find(m => m.period === '2026-05');
    expect(may).toBeDefined();
    expect(may?.foodCost).toBeCloseTo(216.75, 2);
    expect(may?.laborCost).toBeCloseTo(391.01, 2);
    expect(may?.totalExpenses).toBeCloseTo(607.76, 2);

    // No row should have leaked into April.
    expect(result.current.data?.find(m => m.period === '2026-04')).toBeUndefined();
  });

  it('keeps mid-month rows in the same month regardless of host TZ', async () => {
    // Control: a mid-month row is unambiguous; bug or no bug, it stays put.
    mockFetchExpenseData.mockResolvedValue({
      transactions: [
        {
          id: 'bt-mid-may', transaction_date: '2026-05-15T18:00:00+00:00',
          amount: -100, is_split: false, category_id: 'cat-cogs',
          chart_of_accounts: { account_name: 'Food Cost', account_subtype: 'food_cost' },
        },
      ],
      pendingOutflows: [],
      splitDetails: [],
    });

    const { result } = renderHook(
      () => useMonthlyExpenses('rest-russo', DATE_FROM, DATE_TO),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data?.[0].period).toBe('2026-05');
    expect(result.current.data?.[0].foodCost).toBe(100);
  });
});
