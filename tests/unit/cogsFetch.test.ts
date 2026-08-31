import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { COGS_MAX_PAGES, SPLIT_PARENT_ID_BATCH, fetchFinancialCOGSRows } from '@/services/cogsFetch';

const BANK_SELECT = 'transaction_date, amount, chart_of_accounts!category_id(account_subtype)';
const PARENT_SELECT = 'id, transaction_date';
const SPLIT_SELECT =
  'transaction_id, amount, chart_of_accounts!category_id(account_subtype), bank_transactions!inner(restaurant_id)';
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

  it('chunks the split parent ids so the .in() filter stays under the URL limit', async () => {
    // 1,000 parent UUIDs in one .in() serialize to ~37,000 URL chars —
    // far past PostgREST's 8,000-char limit. The fetch must chunk.
    const parentCount = 1000;
    const parentRows = Array.from({ length: parentCount }, (_, i) => ({
      id: `parent-${i}`,
      transaction_date: '2026-08-03T00:00:00',
    }));
    const expectedChunks = Math.ceil(parentCount / SPLIT_PARENT_ID_BATCH);
    const splitRow = (i: number) => ({
      transaction_id: `parent-${i * SPLIT_PARENT_ID_BATCH}`,
      amount: -5,
      chart_of_accounts: { account_subtype: 'food_cost' },
    });

    const specs = {
      [`bank_transactions|${BANK_SELECT}`]: spec([[bankRow]]),
      // A full 1,000-row page asks for a second page; serve it empty.
      [`bank_transactions|${PARENT_SELECT}`]: spec([parentRows, []]),
      // One small page per chunk — each chunk fetch stops after one range call.
      [`bank_transaction_splits|${SPLIT_SELECT}`]: spec(
        Array.from({ length: expectedChunks }, (_, i) => [splitRow(i)])
      ),
      [`pending_outflows|${PENDING_SELECT}`]: spec([[]]),
    };

    const result = await fetchFinancialCOGSRows(makeClient(specs), 'rest-1', '2026-08-01', '2026-08-31');

    // Every chunk's rows merge into one result.
    expect(result.splitItems).toHaveLength(expectedChunks);
    expect(result.capped).toBe(false);

    const splitCalls = specs[`bank_transaction_splits|${SPLIT_SELECT}`].calls;
    const inCalls = splitCalls.filter(
      (call) => call[0] === 'in' && call[1] === 'transaction_id'
    );
    expect(inCalls).toHaveLength(expectedChunks);
    const seenIds = new Set<string>();
    for (const call of inCalls) {
      const ids = call[2] as string[];
      expect(ids.length).toBeLessThanOrEqual(SPLIT_PARENT_ID_BATCH);
      ids.forEach((id) => seenIds.add(id));
    }
    // The chunk union covers every parent id exactly once.
    expect(seenIds.size).toBe(parentCount);

    // Every chunk query carries the tenant scope.
    const tenantCalls = splitCalls.filter(
      (call) => call[0] === 'eq' && call[1] === 'bank_transactions.restaurant_id'
    );
    expect(tenantCalls).toHaveLength(expectedChunks);
    expect(tenantCalls[0][2]).toBe('rest-1');
  });

  it('reports capped when a split chunk exhausts the page budget', async () => {
    const fullSplitPage = Array(1000).fill({
      transaction_id: 'parent-1',
      amount: -5,
      chart_of_accounts: { account_subtype: 'food_cost' },
    });
    const specs = {
      [`bank_transactions|${BANK_SELECT}`]: spec([[bankRow]]),
      [`bank_transactions|${PARENT_SELECT}`]: spec([
        [{ id: 'parent-1', transaction_date: '2026-08-03T00:00:00' }],
      ]),
      [`bank_transaction_splits|${SPLIT_SELECT}`]: spec(
        Array.from({ length: COGS_MAX_PAGES + 5 }, () => fullSplitPage)
      ),
      [`pending_outflows|${PENDING_SELECT}`]: spec([[]]),
    };

    const result = await fetchFinancialCOGSRows(makeClient(specs), 'rest-1', '2026-08-01', '2026-08-31');

    expect(result.capped).toBe(true);
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

  it('applies the inclusive day-end bound to both transaction_date filters', async () => {
    const specs = {
      [`bank_transactions|${BANK_SELECT}`]: spec([[bankRow]]),
      [`bank_transactions|${PARENT_SELECT}`]: spec([[]]),
      [`pending_outflows|${PENDING_SELECT}`]: spec([[]]),
    };

    await fetchFinancialCOGSRows(makeClient(specs), 'rest-1', '2026-08-01', '2026-08-31');

    // The start bound stays a bare date string. Postgres reads it as
    // midnight UTC, the correct inclusive start of the first day.
    expect(specs[`bank_transactions|${BANK_SELECT}`].calls).toContainEqual([
      'gte',
      'transaction_date',
      '2026-08-01',
    ]);
    expect(specs[`bank_transactions|${PARENT_SELECT}`].calls).toContainEqual([
      'gte',
      'transaction_date',
      '2026-08-01',
    ]);
    expect(specs[`bank_transactions|${BANK_SELECT}`].calls).toContainEqual([
      'lte',
      'transaction_date',
      '2026-08-31T23:59:59.999Z',
    ]);
    expect(specs[`bank_transactions|${PARENT_SELECT}`].calls).toContainEqual([
      'lte',
      'transaction_date',
      '2026-08-31T23:59:59.999Z',
    ]);
    expect(specs[`pending_outflows|${PENDING_SELECT}`].calls).toContainEqual([
      'lte',
      'issue_date',
      '2026-08-31',
    ]);
  });
});
