import { describe, it, expect } from 'vitest';
import {
  defaultInterval,
  computeTotals,
  bucketSeries,
  payeeFor,
  topCategories,
  breakdown,
  type CashFlowRow,
  type CashFlowPeriod,
} from '@/lib/cashflowInsights';

function makeRow(overrides: Partial<CashFlowRow>): CashFlowRow {
  return {
    transaction_date: '2026-08-01',
    amount: 100,
    is_transfer: false,
    normalized_payee: 'Acme Foods',
    merchant_name: null,
    description: null,
    category: { id: 'cat-1', name: 'Food' },
    ...overrides,
  };
}

function period(fromStr: string, toStr: string): CashFlowPeriod {
  const [fy, fm, fd] = fromStr.split('-').map(Number);
  const [ty, tm, td] = toStr.split('-').map(Number);
  return { from: new Date(fy, fm - 1, fd), to: new Date(ty, tm - 1, td) };
}

describe('defaultInterval', () => {
  it('returns day for periods up to 31 days', () => {
    expect(defaultInterval(period('2026-08-01', '2026-08-31'))).toBe('day');
    expect(defaultInterval(period('2026-08-01', '2026-08-01'))).toBe('day');
  });

  it('returns week for periods between 32 and 120 days', () => {
    expect(defaultInterval(period('2026-06-01', '2026-08-31'))).toBe('week');
  });

  it('returns month for periods above 120 days', () => {
    expect(defaultInterval(period('2025-01-01', '2026-08-01'))).toBe('month');
  });
});

describe('computeTotals', () => {
  it('sums money in, money out, and net', () => {
    const rows = [
      makeRow({ amount: 500 }),
      makeRow({ amount: -200 }),
      makeRow({ amount: -50 }),
    ];

    const totals = computeTotals(rows);

    expect(totals.moneyIn).toBe(500);
    expect(totals.moneyOut).toBe(-250);
    expect(totals.net).toBe(250);
  });

  it('drops transfer rows when excludeTransfers is set', () => {
    const rows = [
      makeRow({ amount: 500 }),
      makeRow({ amount: -300, is_transfer: true }),
      makeRow({ amount: -50 }),
    ];

    const totals = computeTotals(rows, { excludeTransfers: true });

    expect(totals.moneyIn).toBe(500);
    expect(totals.moneyOut).toBe(-50);
    expect(totals.net).toBe(450);
  });

  it('keeps transfer rows when excludeTransfers is not set', () => {
    const rows = [makeRow({ amount: 500 }), makeRow({ amount: -300, is_transfer: true })];

    const totals = computeTotals(rows);

    expect(totals.moneyIn).toBe(500);
    expect(totals.moneyOut).toBe(-300);
    expect(totals.net).toBe(200);
  });

  it('returns zero totals for an empty row list', () => {
    const totals = computeTotals([]);

    expect(totals).toEqual({ moneyIn: 0, moneyOut: 0, net: 0 });
  });
});

describe('bucketSeries', () => {
  it('groups rows into day buckets with per-category signed sums', () => {
    const rows = [
      makeRow({ transaction_date: '2026-08-01', amount: 100, category: { id: 'c1', name: 'Food' } }),
      makeRow({ transaction_date: '2026-08-01', amount: -30, category: { id: 'c2', name: 'Rent' } }),
      makeRow({ transaction_date: '2026-08-02', amount: 50, category: { id: 'c1', name: 'Food' } }),
    ];

    const buckets = bucketSeries(rows, period('2026-08-01', '2026-08-02'), 'day');

    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toEqual({
      bucketStart: '2026-08-01',
      moneyIn: 100,
      moneyOut: -30,
      byCategory: { Food: 100, Rent: -30 },
    });
    expect(buckets[1]).toEqual({
      bucketStart: '2026-08-02',
      moneyIn: 50,
      moneyOut: 0,
      byCategory: { Food: 50 },
    });
  });

  it('folds transfer rows into a Transfers category', () => {
    const rows = [makeRow({ amount: -75, is_transfer: true, category: { id: 'c1', name: 'Food' } })];

    const buckets = bucketSeries(rows, period('2026-08-01', '2026-08-01'), 'day');

    expect(buckets[0].byCategory).toEqual({ Transfers: -75 });
  });

  it('folds rows with no category into Uncategorized', () => {
    const rows = [makeRow({ amount: 40, category: null })];

    const buckets = bucketSeries(rows, period('2026-08-01', '2026-08-01'), 'day');

    expect(buckets[0].byCategory).toEqual({ Uncategorized: 40 });
  });

  it('excludes rows outside the period', () => {
    const rows = [
      makeRow({ transaction_date: '2026-07-31', amount: 999 }),
      makeRow({ transaction_date: '2026-08-01', amount: 10 }),
      makeRow({ transaction_date: '2026-08-03', amount: 999 }),
    ];

    const buckets = bucketSeries(rows, period('2026-08-01', '2026-08-01'), 'day');

    expect(buckets).toHaveLength(1);
    expect(buckets[0].moneyIn).toBe(10);
  });

  it('groups rows into week buckets starting on Monday', () => {
    const rows = [
      // Monday 2026-08-03 and Wednesday 2026-08-05 fall in the same ISO week.
      makeRow({ transaction_date: '2026-08-03', amount: 100 }),
      makeRow({ transaction_date: '2026-08-05', amount: 20 }),
      // Monday 2026-08-10 starts the next week.
      makeRow({ transaction_date: '2026-08-10', amount: 5 }),
    ];

    const buckets = bucketSeries(rows, period('2026-08-03', '2026-08-10'), 'week');

    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toMatchObject({ bucketStart: '2026-08-03', moneyIn: 120 });
    expect(buckets[1]).toMatchObject({ bucketStart: '2026-08-10', moneyIn: 5 });
  });

  it('groups rows into month buckets', () => {
    const rows = [
      makeRow({ transaction_date: '2026-06-15', amount: 100 }),
      makeRow({ transaction_date: '2026-06-28', amount: -40 }),
      makeRow({ transaction_date: '2026-07-02', amount: 60 }),
    ];

    const buckets = bucketSeries(rows, period('2026-06-01', '2026-07-31'), 'month');

    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toMatchObject({ bucketStart: '2026-06-01', moneyIn: 100, moneyOut: -40 });
    expect(buckets[1]).toMatchObject({ bucketStart: '2026-07-01', moneyIn: 60, moneyOut: 0 });
  });

  it('returns an empty series for an empty row list', () => {
    const buckets = bucketSeries([], period('2026-08-01', '2026-08-31'), 'day');

    expect(buckets).toEqual([]);
  });
});

describe('payeeFor', () => {
  it('prefers normalized_payee', () => {
    const row = makeRow({ normalized_payee: 'Acme', merchant_name: 'Other Co', description: 'desc' });

    expect(payeeFor(row)).toBe('Acme');
  });

  it('falls back to merchant_name when normalized_payee is null', () => {
    const row = makeRow({ normalized_payee: null, merchant_name: 'Merchant Co', description: 'desc' });

    expect(payeeFor(row)).toBe('Merchant Co');
  });

  it('falls back to description when normalized_payee and merchant_name are null', () => {
    const row = makeRow({ normalized_payee: null, merchant_name: null, description: 'Check #100' });

    expect(payeeFor(row)).toBe('Check #100');
  });

  it('falls back to Unknown when all three fields are null', () => {
    const row = makeRow({ normalized_payee: null, merchant_name: null, description: null });

    expect(payeeFor(row)).toBe('Unknown');
  });
});

describe('topCategories', () => {
  it('returns every category signed sum when there are 5 or fewer', () => {
    const rows = [
      makeRow({ amount: 100, category: { id: 'c1', name: 'Food' } }),
      makeRow({ amount: -50, category: { id: 'c2', name: 'Rent' } }),
    ];

    expect(topCategories(rows)).toEqual([
      { name: 'Food', amount: 100 },
      { name: 'Rent', amount: -50 },
    ]);
  });

  it('folds categories beyond the top 5 by absolute sum into Other', () => {
    const rows = [
      makeRow({ amount: 500, category: { id: 'c1', name: 'A' } }),
      makeRow({ amount: -400, category: { id: 'c2', name: 'B' } }),
      makeRow({ amount: 300, category: { id: 'c3', name: 'C' } }),
      makeRow({ amount: -200, category: { id: 'c4', name: 'D' } }),
      makeRow({ amount: 100, category: { id: 'c5', name: 'E' } }),
      makeRow({ amount: -50, category: { id: 'c6', name: 'F' } }),
      makeRow({ amount: -10, category: { id: 'c7', name: 'G' } }),
    ];

    expect(topCategories(rows)).toEqual([
      { name: 'A', amount: 500 },
      { name: 'B', amount: -400 },
      { name: 'C', amount: 300 },
      { name: 'D', amount: -200 },
      { name: 'E', amount: 100 },
      { name: 'Other', amount: -60 },
    ]);
  });

  it('folds transfer rows into Transfers', () => {
    const rows = [makeRow({ amount: -75, is_transfer: true, category: { id: 'c1', name: 'Food' } })];

    expect(topCategories(rows)).toEqual([{ name: 'Transfers', amount: -75 }]);
  });

  it('folds rows with no category into Uncategorized', () => {
    const rows = [makeRow({ amount: 40, category: null })];

    expect(topCategories(rows)).toEqual([{ name: 'Uncategorized', amount: 40 }]);
  });

  it('returns an empty list for an empty row list', () => {
    expect(topCategories([])).toEqual([]);
  });
});

describe('breakdown', () => {
  it('groups money-in rows by payee with pctOfTotal, dropping outflows', () => {
    const rows = [
      makeRow({ amount: 300, normalized_payee: 'Client A' }),
      makeRow({ amount: 100, normalized_payee: 'Client B' }),
      makeRow({ amount: -50, normalized_payee: 'Client A' }),
    ];

    expect(breakdown(rows, 'in', 'payee')).toEqual([
      { label: 'Client A', amount: 300, pctOfTotal: 75 },
      { label: 'Client B', amount: 100, pctOfTotal: 25 },
    ]);
  });

  it('groups money-out rows by category with pctOfTotal, dropping inflows', () => {
    const rows = [
      makeRow({ amount: -300, category: { id: 'c1', name: 'Rent' } }),
      makeRow({ amount: -100, category: { id: 'c2', name: 'Food' } }),
      makeRow({ amount: 200, category: { id: 'c1', name: 'Rent' } }),
    ];

    expect(breakdown(rows, 'out', 'category')).toEqual([
      { label: 'Rent', amount: -300, pctOfTotal: 75 },
      { label: 'Food', amount: -100, pctOfTotal: 25 },
    ]);
  });

  it('folds payees beyond the top 8 into a Remaining row', () => {
    const rows = Array.from({ length: 9 }, (_, i) => makeRow({ amount: -(100 - i * 5), normalized_payee: `Payee ${i}` }));

    const result = breakdown(rows, 'out', 'payee');

    expect(result).toHaveLength(9);
    expect(result[8]).toEqual({ label: 'Remaining', amount: -60, pctOfTotal: (60 / 720) * 100 });
  });

  it('returns an empty list when no rows match the direction', () => {
    const rows = [makeRow({ amount: 100 })];

    expect(breakdown(rows, 'out', 'payee')).toEqual([]);
  });
});
