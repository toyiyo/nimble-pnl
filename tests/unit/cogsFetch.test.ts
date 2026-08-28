import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { COGS_MAX_PAGES, fetchFinancialCOGSRows } from '@/services/cogsFetch';

const BANK_SELECT = 'transaction_date, amount, chart_of_accounts!category_id(account_subtype)';
const PARENT_SELECT = 'id, transaction_date';
const SPLIT_SELECT = 'transaction_id, amount, chart_of_accounts!category_id(account_subtype)';
const PENDING_SELECT = 'issue_date, amount, chart_of_accounts!category_id(account_subtype)';

const bankRow = {
  transaction_date: '2026-08-01',
  amount: -40,
  chart_of_accounts: { account_subtype: 'food_cost' },
};

type Page = unknown[];

interface TableSpec {
  pages: Page[];
  calls: Array<[string, ...unknown[]]>;
  ranges: Array<[number, number]>;
}

const spec = (pages: Page[]): TableSpec => ({ pages, calls: [], ranges: [] });

// Query specs are keyed by `${table}|${selectColumns}`, because the helper
// runs two different queries against bank_transactions.
function makeClient(specs: Record<string, TableSpec>): SupabaseClient {
  const from = (table: string) => {
    let active: TableSpec | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {};
    chain.select = (columns: string) => {
      active = specs[`${table}|${columns}`];
      if (!active) throw new Error(`unexpected query: ${table}|${columns}`);
      return chain;
    };
    ['eq', 'in', 'is', 'lt', 'gte', 'lte', 'order'].forEach((method) => {
      chain[method] = (...args: unknown[]) => {
        active?.calls.push([method, ...args]);
        return chain;
      };
    });
    chain.range = (fromIdx: number, toIdx: number) => {
      active?.ranges.push([fromIdx, toIdx]);
      const page = active?.pages.shift() ?? [];
      return Promise.resolve({ data: page, error: null });
    };
    return chain;
  };
  return { from } as unknown as SupabaseClient;
}

describe('fetchFinancialCOGSRows', () => {
  it('pages all four sources, keeps the filters, and maps parent dates', async () => {
    const specs = {
      [`bank_transactions|${BANK_SELECT}`]: spec([Array(1000).fill(bankRow), [bankRow]]),
      [`bank_transactions|${PARENT_SELECT}`]: spec([
        [{ id: 'parent-1', transaction_date: '2026-08-03T00:00:00' }],
      ]),
      [`bank_transaction_splits|${SPLIT_SELECT}`]: spec([
        [{ transaction_id: 'parent-1', amount: -12, chart_of_accounts: { account_subtype: 'food_cost' } }],
      ]),
      [`pending_outflows|${PENDING_SELECT}`]: spec([
        [{ issue_date: '2026-08-04', amount: -9, chart_of_accounts: { account_subtype: 'beverage_cost' } }],
      ]),
    };

    const result = await fetchFinancialCOGSRows(makeClient(specs), 'rest-1', '2026-08-01', '2026-08-31');

    expect(result.bankTxns).toHaveLength(1001);
    expect(specs[`bank_transactions|${BANK_SELECT}`].ranges).toEqual([[0, 999], [1000, 1999]]);
    expect(result.parentDateMap.get('parent-1')).toBe('2026-08-03');
    expect(result.splitItems).toHaveLength(1);
    expect(result.pendingTxns).toHaveLength(1);
    expect(result.capped).toBe(false);

    expect(specs[`bank_transactions|${BANK_SELECT}`].calls).toEqual(
      expect.arrayContaining([
        ['eq', 'restaurant_id', 'rest-1'],
        ['in', 'status', ['posted', 'pending']],
        ['eq', 'is_transfer', false],
        ['eq', 'is_split', false],
        ['lt', 'amount', 0],
      ])
    );
    expect(specs[`pending_outflows|${PENDING_SELECT}`].calls).toEqual(
      expect.arrayContaining([
        ['in', 'status', ['pending', 'stale_30', 'stale_60', 'stale_90']],
        ['is', 'linked_bank_transaction_id', null],
      ])
    );
  });

  it('skips the splits query when there are no split parents', async () => {
    // No spec entry exists for bank_transaction_splits: a query against it
    // would throw "unexpected query".
    const specs = {
      [`bank_transactions|${BANK_SELECT}`]: spec([[bankRow]]),
      [`bank_transactions|${PARENT_SELECT}`]: spec([[]]),
      [`pending_outflows|${PENDING_SELECT}`]: spec([[]]),
    };

    const result = await fetchFinancialCOGSRows(makeClient(specs), 'rest-1', '2026-08-01', '2026-08-31');

    expect(result.splitItems).toEqual([]);
    expect(result.parentDateMap.size).toBe(0);
    expect(result.capped).toBe(false);
  });

  it('reports capped when a source exhausts the page budget', async () => {
    const specs = {
      [`bank_transactions|${BANK_SELECT}`]: spec(
        Array.from({ length: COGS_MAX_PAGES + 5 }, () => Array(1000).fill(bankRow))
      ),
      [`bank_transactions|${PARENT_SELECT}`]: spec([[]]),
      [`pending_outflows|${PENDING_SELECT}`]: spec([[]]),
    };

    const result = await fetchFinancialCOGSRows(makeClient(specs), 'rest-1', '2026-08-01', '2026-08-31');

    expect(result.capped).toBe(true);
    expect(specs[`bank_transactions|${BANK_SELECT}`].ranges).toHaveLength(COGS_MAX_PAGES);
  });
});
