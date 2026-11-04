/**
 * tipsFetch: the shared tips-owed reader for the dashboard surfaces
 * (useLaborCostsFromTimeTracking + useMonthlyMetrics).
 *
 * Contract under test (CodeRabbit P1 on PR #779):
 * 1. fetchTipSplitRows counts only approved/archived parent splits —
 *    the same rule usePayroll applies. Draft splits are not owed.
 * 2. fetchTipPayoutRows reads tip_payouts windowed by payout_date.
 * 3. netTipsOwedByEmployee subtracts payouts per employee and floors at
 *    zero — mirror of payrollCalculations' `Math.max(0, tips - paidOut)`.
 */
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  fetchTipSplitRows,
  fetchTipPayoutRows,
  sumTipsOwedByEmployee,
  netTipsOwedByEmployee,
  OWED_TIP_SPLIT_STATUSES,
  type TipSplitRow,
  type TipPayoutRow,
} from '@/services/tipsFetch';

interface ChainCall {
  method: string;
  args: unknown[];
}

interface QueryChainMock {
  select: (columns: string) => QueryChainMock;
  eq: (column: string, value: unknown) => QueryChainMock;
  in: (column: string, values: unknown[]) => QueryChainMock;
  gte: (column: string, value: unknown) => QueryChainMock;
  lte: (column: string, value: unknown) => QueryChainMock;
  order: (column: string) => QueryChainMock;
  range: (from: number, to: number) => Promise<{ data: unknown[]; error: null }>;
}

/** Minimal recording client: every chain call is captured per table, and
 * `.range()` resolves the table's fixture rows (single page). */
function makeClient(rowsByTable: Record<string, unknown[]>) {
  const calls: Record<string, ChainCall[]> = {};
  const client = {
    from(table: string) {
      calls[table] = calls[table] ?? [];
      const record = (method: string, args: unknown[]) => {
        calls[table].push({ method, args });
      };
      const chain: QueryChainMock = {
        select: (...args) => { record('select', args); return chain; },
        eq: (...args) => { record('eq', args); return chain; },
        in: (...args) => { record('in', args); return chain; },
        gte: (...args) => { record('gte', args); return chain; },
        lte: (...args) => { record('lte', args); return chain; },
        order: (...args) => { record('order', args); return chain; },
        range: (from, to) => {
          record('range', [from, to]);
          return Promise.resolve({ data: rowsByTable[table] ?? [], error: null });
        },
      };
      return chain;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

function splitRow(employee_id: string, amount: number): TipSplitRow {
  return {
    amount,
    employee_id,
    tip_splits: { restaurant_id: 'rest-1', split_date: '2026-08-10' },
  };
}

function payoutRow(employee_id: string, amount: number): TipPayoutRow {
  return { amount, employee_id, payout_date: '2026-08-12' };
}

describe('fetchTipSplitRows', () => {
  it('filters parent splits to the owed statuses (approved/archived)', async () => {
    const rows = [splitRow('e1', 500)];
    const { client, calls } = makeClient({ tip_split_items: rows });

    const result = await fetchTipSplitRows(client, 'rest-1', '2026-08-01', '2026-08-31');

    expect(result.rows).toEqual(rows);
    expect(result.capped).toBe(false);
    expect(calls.tip_split_items).toContainEqual({
      method: 'in',
      args: ['tip_splits.status', OWED_TIP_SPLIT_STATUSES],
    });
    expect(calls.tip_split_items).toContainEqual({
      method: 'eq',
      args: ['tip_splits.restaurant_id', 'rest-1'],
    });
    expect(calls.tip_split_items).toContainEqual({
      method: 'gte',
      args: ['tip_splits.split_date', '2026-08-01'],
    });
    expect(calls.tip_split_items).toContainEqual({
      method: 'lte',
      args: ['tip_splits.split_date', '2026-08-31'],
    });
  });

  it('names only owed states in OWED_TIP_SPLIT_STATUSES', () => {
    expect(OWED_TIP_SPLIT_STATUSES).toEqual(['approved', 'archived']);
  });
});

describe('fetchTipPayoutRows', () => {
  it('reads tip_payouts for the restaurant, windowed by payout_date', async () => {
    const rows = [payoutRow('e1', 200)];
    const { client, calls } = makeClient({ tip_payouts: rows });

    const result = await fetchTipPayoutRows(client, 'rest-1', '2026-08-01', '2026-08-31');

    expect(result.rows).toEqual(rows);
    expect(result.capped).toBe(false);
    expect(calls.tip_payouts).toContainEqual({
      method: 'select',
      args: ['amount, employee_id, payout_date'],
    });
    expect(calls.tip_payouts).toContainEqual({
      method: 'eq',
      args: ['restaurant_id', 'rest-1'],
    });
    expect(calls.tip_payouts).toContainEqual({
      method: 'gte',
      args: ['payout_date', '2026-08-01'],
    });
    expect(calls.tip_payouts).toContainEqual({
      method: 'lte',
      args: ['payout_date', '2026-08-31'],
    });
  });
});

describe('sumTipsOwedByEmployee', () => {
  it('sums integer cents per employee', () => {
    const map = sumTipsOwedByEmployee([
      splitRow('e1', 300),
      splitRow('e1', 200),
      splitRow('e2', 100),
    ]);
    expect(map.get('e1')).toBe(500);
    expect(map.get('e2')).toBe(100);
  });
});

describe('netTipsOwedByEmployee', () => {
  it('subtracts payouts per employee', () => {
    const map = netTipsOwedByEmployee(
      [splitRow('e1', 300), splitRow('e1', 200), splitRow('e2', 100)],
      [payoutRow('e1', 200)]
    );
    expect(map.get('e1')).toBe(300);
    expect(map.get('e2')).toBe(100);
  });

  it('floors each employee at zero when payouts exceed splits', () => {
    const map = netTipsOwedByEmployee(
      [splitRow('e1', 100)],
      [payoutRow('e1', 250)]
    );
    expect(map.get('e1')).toBe(0);
  });

  it('ignores an employee with payouts and no splits', () => {
    const map = netTipsOwedByEmployee(
      [splitRow('e1', 100)],
      [payoutRow('e3', 400)]
    );
    expect(map.get('e1')).toBe(100);
    expect(map.has('e3')).toBe(false);
  });
});
