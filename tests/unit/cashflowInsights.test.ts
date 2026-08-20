import { describe, it, expect } from 'vitest';
import {
  defaultInterval,
  computeTotals,
  bucketSeries,
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
