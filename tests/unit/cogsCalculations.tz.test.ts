/**
 * Regression: aggregateFinancialCOGSByDate must bucket each row by the UTC
 * day stored on the row, not by the host-local day.
 *
 * Russo's Pizzeria (America/Chicago) had a $216.75 COGS bank transaction
 * stored as `transaction_date = '2026-05-01T00:00:00+00:00'`. The previous
 * implementation called `format(new Date(txn.transaction_date), 'yyyy-MM-dd')`,
 * which parses UTC then re-formats in the host TZ. In Chicago that
 * yielded `'2026-04-30'`, so the row landed in April's bucket and
 * Monthly Performance reported $3,787 instead of $4,003.73 for May.
 *
 * Pin TZ=America/Chicago and assert the row buckets to '2026-05-01'.
 */

process.env.TZ = 'America/Chicago';

import { describe, it, expect } from 'vitest';
import {
  aggregateFinancialCOGSByDate,
  type BankTransactionRow,
  type PendingOutflowRow,
  type SplitItemRow,
} from '@/services/cogsCalculations';

describe('aggregateFinancialCOGSByDate — TZ bucketing', () => {
  it('buckets a 00:00 UTC bank txn to its UTC date even when host TZ is west of UTC', () => {
    // Sanity: confirm Chicago really is the host TZ for this test.
    expect(new Date().getTimezoneOffset()).toBeGreaterThan(0);

    const bankTxns: BankTransactionRow[] = [
      {
        transaction_date: '2026-05-01T00:00:00+00:00',
        amount: -216.75,
        chart_of_accounts: { account_subtype: 'food_cost' },
      },
    ];

    const result = aggregateFinancialCOGSByDate({
      bankTxns,
      splitItems: [],
      parentDateMap: new Map(),
      pendingTxns: [],
    });

    // Bug behavior: result.get('2026-04-30') === 216.75
    // Correct behavior: row buckets under May 1.
    expect(result.get('2026-05-01')).toBeCloseTo(216.75, 2);
    expect(result.has('2026-04-30')).toBe(false);
  });

  it('buckets split-parent txns by their UTC date (parentDateMap path)', () => {
    const splitItems: SplitItemRow[] = [
      {
        transaction_id: 'parent-1',
        amount: -100,
        chart_of_accounts: { account_subtype: 'food_cost' },
      },
    ];
    const parentDateMap = new Map<string, string>([
      // Day key produced by the calling hook — must already be the canonical
      // UTC date. With the fix, both call-sites build this from
      // `parent.transaction_date.slice(0, 10)`.
      ['parent-1', '2026-05-01'],
    ]);

    const result = aggregateFinancialCOGSByDate({
      bankTxns: [],
      splitItems,
      parentDateMap,
      pendingTxns: [],
    });

    expect(result.get('2026-05-01')).toBeCloseTo(100, 2);
  });

  it('passes through pending_outflows.issue_date (DATE column) unchanged', () => {
    // pending_outflows.issue_date is a DATE — already a 'yyyy-MM-dd' string
    // with no time component. It must round-trip identically.
    const pendingTxns: PendingOutflowRow[] = [
      {
        issue_date: '2026-05-01',
        amount: -50,
        chart_of_accounts: { account_subtype: 'cost_of_goods_sold' },
      },
    ];

    const result = aggregateFinancialCOGSByDate({
      bankTxns: [],
      splitItems: [],
      parentDateMap: new Map(),
      pendingTxns,
    });

    expect(result.get('2026-05-01')).toBeCloseTo(50, 2);
  });

  it('aggregates multiple sources for the same UTC date', () => {
    const bankTxns: BankTransactionRow[] = [
      {
        transaction_date: '2026-05-01T00:00:00+00:00',
        amount: -100,
        chart_of_accounts: { account_subtype: 'food_cost' },
      },
    ];
    const splitItems: SplitItemRow[] = [
      {
        transaction_id: 'p-1',
        amount: -50,
        chart_of_accounts: { account_subtype: 'beverage_cost' },
      },
    ];
    const parentDateMap = new Map([['p-1', '2026-05-01']]);
    const pendingTxns: PendingOutflowRow[] = [
      {
        issue_date: '2026-05-01',
        amount: -25,
        chart_of_accounts: { account_subtype: 'packaging_cost' },
      },
    ];

    const result = aggregateFinancialCOGSByDate({
      bankTxns,
      splitItems,
      parentDateMap,
      pendingTxns,
    });

    expect(result.get('2026-05-01')).toBeCloseTo(175, 2);
  });
});
