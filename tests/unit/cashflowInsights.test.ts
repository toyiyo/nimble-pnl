import { describe, it, expect } from 'vitest';
import {
  defaultInterval,
  computeTotals,
  computeCashFlowAggregates,
  bucketSeries,
  dayKeyOf,
  formatCompactCurrency,
  isInternalTransfer,
  payeeFor,
  topCategories,
  breakdown,
  buildSankey,
  computeInsights,
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
    category: { id: 'cat-1', name: 'Food', account_type: 'expense', account_subtype: null },
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
  it('CRITICAL: sums money in, money out, and net', () => {
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
      makeRow({ transaction_date: '2026-08-01', amount: 100, category: { id: 'c1', name: 'Food', account_type: 'expense', account_subtype: null } }),
      makeRow({ transaction_date: '2026-08-01', amount: -30, category: { id: 'c2', name: 'Rent', account_type: 'expense', account_subtype: null } }),
      makeRow({ transaction_date: '2026-08-02', amount: 50, category: { id: 'c1', name: 'Food', account_type: 'expense', account_subtype: null } }),
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
    const rows = [makeRow({ amount: -75, is_transfer: true, category: { id: 'c1', name: 'Food', account_type: 'expense', account_subtype: null } })];

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
      makeRow({ amount: 100, category: { id: 'c1', name: 'Food', account_type: 'expense', account_subtype: null } }),
      makeRow({ amount: -50, category: { id: 'c2', name: 'Rent', account_type: 'expense', account_subtype: null } }),
    ];

    expect(topCategories(rows)).toEqual([
      { name: 'Food', amount: 100 },
      { name: 'Rent', amount: -50 },
    ]);
  });

  it('folds categories beyond the top 5 by absolute sum into Other', () => {
    const rows = [
      makeRow({ amount: 500, category: { id: 'c1', name: 'A', account_type: 'expense', account_subtype: null } }),
      makeRow({ amount: -400, category: { id: 'c2', name: 'B', account_type: 'expense', account_subtype: null } }),
      makeRow({ amount: 300, category: { id: 'c3', name: 'C', account_type: 'expense', account_subtype: null } }),
      makeRow({ amount: -200, category: { id: 'c4', name: 'D', account_type: 'expense', account_subtype: null } }),
      makeRow({ amount: 100, category: { id: 'c5', name: 'E', account_type: 'expense', account_subtype: null } }),
      makeRow({ amount: -50, category: { id: 'c6', name: 'F', account_type: 'expense', account_subtype: null } }),
      makeRow({ amount: -10, category: { id: 'c7', name: 'G', account_type: 'expense', account_subtype: null } }),
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
    const rows = [makeRow({ amount: -75, is_transfer: true, category: { id: 'c1', name: 'Food', account_type: 'expense', account_subtype: null } })];

    expect(topCategories(rows)).toEqual([{ name: 'Transfers', amount: -75 }]);
  });

  it('folds rows with no category into Uncategorized', () => {
    const rows = [makeRow({ amount: 40, category: null })];

    expect(topCategories(rows)).toEqual([{ name: 'Uncategorized', amount: 40 }]);
  });

  it('returns an empty list for an empty row list', () => {
    expect(topCategories([])).toEqual([]);
  });

  it('folds the remainder into a real category already named Other', () => {
    const rows = [
      makeRow({ amount: 500, category: { id: 'c1', name: 'A', account_type: 'expense', account_subtype: null } }),
      makeRow({ amount: -400, category: { id: 'c2', name: 'B', account_type: 'expense', account_subtype: null } }),
      makeRow({ amount: 300, category: { id: 'c3', name: 'C', account_type: 'expense', account_subtype: null } }),
      makeRow({ amount: -200, category: { id: 'c4', name: 'D', account_type: 'expense', account_subtype: null } }),
      makeRow({ amount: 190, category: { id: 'c5', name: 'Other', account_type: 'expense', account_subtype: null } }),
      makeRow({ amount: -50, category: { id: 'c6', name: 'F', account_type: 'expense', account_subtype: null } }),
      makeRow({ amount: -10, category: { id: 'c7', name: 'G', account_type: 'expense', account_subtype: null } }),
    ];

    const result = topCategories(rows);

    // Exactly one 'Other' entry — the real category plus the folded rest.
    expect(result.filter((entry) => entry.name === 'Other')).toEqual([{ name: 'Other', amount: 130 }]);
  });

  it('folds the remainder into a real category named other in lower case', () => {
    const rows = [
      makeRow({ amount: 500, category: { id: 'c1', name: 'A', account_type: 'expense', account_subtype: null } }),
      makeRow({ amount: -400, category: { id: 'c2', name: 'B', account_type: 'expense', account_subtype: null } }),
      makeRow({ amount: 300, category: { id: 'c3', name: 'C', account_type: 'expense', account_subtype: null } }),
      makeRow({ amount: -200, category: { id: 'c4', name: 'D', account_type: 'expense', account_subtype: null } }),
      makeRow({ amount: 190, category: { id: 'c5', name: 'other', account_type: 'expense', account_subtype: null } }),
      makeRow({ amount: -50, category: { id: 'c6', name: 'F', account_type: 'expense', account_subtype: null } }),
      makeRow({ amount: -10, category: { id: 'c7', name: 'G', account_type: 'expense', account_subtype: null } }),
    ];

    const result = topCategories(rows);

    // One entry only, with the first-seen label 'other'.
    expect(result.filter((entry) => entry.name.toUpperCase() === 'OTHER')).toEqual([
      { name: 'other', amount: 130 },
    ]);
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
      makeRow({ amount: -300, category: { id: 'c1', name: 'Rent', account_type: 'expense', account_subtype: null } }),
      makeRow({ amount: -100, category: { id: 'c2', name: 'Food', account_type: 'expense', account_subtype: null } }),
      makeRow({ amount: 200, category: { id: 'c1', name: 'Rent', account_type: 'expense', account_subtype: null } }),
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

describe('buildSankey', () => {
  it('builds left payees + Transfers in, a Money in center, and right payees + Transfers out + Net savings', () => {
    const rows = [
      makeRow({ amount: 300, normalized_payee: 'Client A' }),
      makeRow({ amount: 200, normalized_payee: 'Client B' }),
      makeRow({ amount: 50, normalized_payee: 'Bank Transfer', is_transfer: true }),
      makeRow({ amount: -120, normalized_payee: 'Vendor X' }),
      makeRow({ amount: -80, normalized_payee: 'Vendor Y' }),
      makeRow({ amount: -30, normalized_payee: 'Bank Transfer', is_transfer: true }),
    ];

    const sankey = buildSankey(rows);

    expect(sankey.nodes).toEqual([
      { name: 'Money in' },
      { name: 'Client A' },
      { name: 'Client B' },
      { name: 'Transfers in' },
      { name: 'Vendor X' },
      { name: 'Vendor Y' },
      { name: 'Transfers out' },
      { name: 'Net savings' },
    ]);
    expect(sankey.links).toEqual([
      { source: 1, target: 0, value: 300 },
      { source: 2, target: 0, value: 200 },
      { source: 3, target: 0, value: 50 },
      { source: 0, target: 4, value: 120 },
      { source: 0, target: 5, value: 80 },
      { source: 0, target: 6, value: 30 },
      { source: 0, target: 7, value: 320 },
    ]);
  });

  it('folds payees beyond the top five into Other income and Other expenses', () => {
    const rows = [
      ...Array.from({ length: 7 }, (_, i) => makeRow({ amount: 100 - i * 5, normalized_payee: `Client ${i}` })),
      ...Array.from({ length: 7 }, (_, i) => makeRow({ amount: -(90 - i * 5), normalized_payee: `Vendor ${i}` })),
    ];

    const sankey = buildSankey(rows);

    expect(sankey.nodes.map((n) => n.name)).toContain('Other income');
    expect(sankey.nodes.map((n) => n.name)).toContain('Other expenses');
  });

  it('conserves flow: the sum of left links equals the sum of right links', () => {
    const rows = [
      makeRow({ amount: 400, normalized_payee: 'Client A' }),
      makeRow({ amount: 250, normalized_payee: 'Client B' }),
      makeRow({ amount: 90, normalized_payee: 'Client C' }),
      makeRow({ amount: 60, normalized_payee: 'Bank Transfer', is_transfer: true }),
      makeRow({ amount: -180, normalized_payee: 'Vendor X' }),
      makeRow({ amount: -95, normalized_payee: 'Vendor Y' }),
      makeRow({ amount: -40, normalized_payee: 'Vendor Z' }),
      makeRow({ amount: -25, normalized_payee: 'Bank Transfer', is_transfer: true }),
    ];

    const sankey = buildSankey(rows);
    const centerIndex = sankey.nodes.findIndex((n) => n.name === 'Money in');

    const leftTotal = sankey.links.filter((l) => l.target === centerIndex).reduce((sum, l) => sum + l.value, 0);
    const rightTotal = sankey.links.filter((l) => l.source === centerIndex).reduce((sum, l) => sum + l.value, 0);

    expect(leftTotal).toBe(rightTotal);
  });

  it('conserves flow in a loss period by adding a From savings link on the left', () => {
    const rows = [
      makeRow({ amount: 1000, normalized_payee: 'Client A' }),
      makeRow({ amount: -1500, normalized_payee: 'Vendor X' }),
    ];

    const sankey = buildSankey(rows);
    const centerIndex = sankey.nodes.findIndex((n) => n.name === 'Money in');

    expect(sankey.nodes.map((n) => n.name)).toContain('From savings');
    expect(sankey.nodes.map((n) => n.name)).not.toContain('Net savings');

    const leftTotal = sankey.links.filter((l) => l.target === centerIndex).reduce((sum, l) => sum + l.value, 0);
    const rightTotal = sankey.links.filter((l) => l.source === centerIndex).reduce((sum, l) => sum + l.value, 0);

    expect(leftTotal).toBe(rightTotal);
    expect(leftTotal).toBe(1500);
  });
});

function subscriptionCharges(payee: string, dates: string[], amount: number): CashFlowRow[] {
  return dates.map((date) =>
    makeRow({ transaction_date: date, amount: -amount, normalized_payee: payee, is_transfer: false }),
  );
}

function inflowRow(date: string, payee: string, amount: number): CashFlowRow {
  return makeRow({ transaction_date: date, amount, normalized_payee: payee, is_transfer: false });
}

describe('computeInsights', () => {
  it('finds a subscription: 3+ charges, 25-35 day cadence, under 10% amount variance', () => {
    const rows = subscriptionCharges('Netflix', ['2026-06-01', '2026-07-01', '2026-08-01'], 15.99);

    const insights = computeInsights(rows, period('2026-08-01', '2026-08-19'));

    expect(insights).toContainEqual({
      id: 'subscriptions',
      title: '1 notable transaction',
      body: 'We noticed 1 subscription you may want to review',
    });
  });

  it('emits no subscription insight for an irregular cadence', () => {
    const rows = subscriptionCharges('Gym', ['2026-06-01', '2026-06-10', '2026-08-01'], 40);

    const insights = computeInsights(rows, period('2026-08-01', '2026-08-19'));

    expect(insights.find((i) => i.id === 'subscriptions')).toBeUndefined();
  });

  it('reports a revenue change: last full calendar month vs the mean of the three before it', () => {
    const rows = [
      inflowRow('2026-04-15', 'Client A', 1000),
      inflowRow('2026-05-15', 'Client A', 1000),
      inflowRow('2026-06-15', 'Client A', 1000),
      inflowRow('2026-07-15', 'Client A', 1500),
    ];

    // period.to on the last day of July makes July the last full calendar month.
    const insights = computeInsights(rows, period('2026-01-01', '2026-07-31'));

    const revenue = insights.find((i) => i.id === 'revenue-change');
    expect(revenue?.title).toBe('Revenue increased');
    expect(revenue?.body).toContain('July 2026');
    expect(revenue?.body).toContain('$1,500');
    expect(revenue?.body).toContain('$1,000');
  });

  it('reports "stayed flat" when last month exactly matches the preceding mean', () => {
    const rows = [
      inflowRow('2026-04-15', 'Client A', 1000),
      inflowRow('2026-05-15', 'Client A', 1000),
      inflowRow('2026-06-15', 'Client A', 1000),
      inflowRow('2026-07-15', 'Client A', 1000),
    ];

    const insights = computeInsights(rows, period('2026-01-01', '2026-07-31'));

    const revenue = insights.find((i) => i.id === 'revenue-change');
    // A zero delta is neither growth nor decline, so the title must say
    // neither "increased" nor "decreased".
    expect(revenue?.title).toBe('Revenue stayed flat');
  });

  it('emits a top-source insight only when the delta is 20% or more', () => {
    const flatRows = [
      inflowRow('2026-04-15', 'Payee B', 700),
      inflowRow('2026-05-15', 'Payee B', 700),
      inflowRow('2026-06-15', 'Payee B', 700),
      inflowRow('2026-07-15', 'Payee A', 100),
      inflowRow('2026-07-15', 'Payee B', 830), // (830-700)/700 = 18.6%, below the 20% floor
    ];
    const flat = computeInsights(flatRows, period('2026-01-01', '2026-07-31'));
    expect(flat.find((i) => i.id === 'top-source-change')).toBeUndefined();

    const spikeRows = [
      inflowRow('2026-04-15', 'Payee B', 700),
      inflowRow('2026-05-15', 'Payee B', 700),
      inflowRow('2026-06-15', 'Payee B', 700),
      inflowRow('2026-07-15', 'Payee A', 100),
      inflowRow('2026-07-15', 'Payee B', 1000), // (1000-700)/700 = 42.9%, above the floor
    ];
    const spike = computeInsights(spikeRows, period('2026-01-01', '2026-07-31'));
    const topSource = spike.find((i) => i.id === 'top-source-change');
    expect(topSource?.title).toBe('Payee B increased');
    expect(topSource?.body).toContain('$1,000');
    expect(topSource?.body).toContain('$700');
  });

  it('returns an empty list when no rule clears its data threshold', () => {
    const rows = [inflowRow('2026-07-15', 'Client A', 250), inflowRow('2026-07-20', 'Vendor X', -60)];

    const insights = computeInsights(rows, period('2026-07-01', '2026-07-31'));

    expect(insights).toEqual([]);
  });

  it('anchors every time window to period.to, not to today', () => {
    const rows = [
      inflowRow('2026-03-15', 'Client A', 1000),
      inflowRow('2026-04-15', 'Client A', 1000),
      inflowRow('2026-05-15', 'Client A', 1000),
      inflowRow('2026-06-15', 'Client A', 1000),
      inflowRow('2026-07-15', 'Client A', 2000),
    ];

    const julyAnchored = computeInsights(rows, period('2026-01-01', '2026-07-31'));
    const juneAnchored = computeInsights(rows, period('2026-01-01', '2026-06-30'));

    expect(julyAnchored.find((i) => i.id === 'revenue-change')?.body).toContain('July 2026');
    expect(juneAnchored.find((i) => i.id === 'revenue-change')?.body).toContain('June 2026');
  });
});

describe('isInternalTransfer', () => {
  it('returns true for a row with the is_transfer flag', () => {
    expect(isInternalTransfer(makeRow({ is_transfer: true, category: null }))).toBe(true);
  });

  it('CRITICAL: returns true for an unflagged row in a non-P&L cash account', () => {
    // Production: categorize_bank_transaction assigns "Transfer Clearing
    // Account" (asset/cash) without setting is_transfer.
    const row = makeRow({
      is_transfer: false,
      category: { id: 'c1', name: 'Transfer Clearing Account', account_type: 'asset', account_subtype: 'cash' },
    });

    expect(isInternalTransfer(row)).toBe(true);
  });

  it('returns true for a non-P&L account with "transfer" in its name', () => {
    const row = makeRow({
      is_transfer: false,
      category: { id: 'c2', name: 'Inter-Account Transfer', account_type: 'equity', account_subtype: 'owners_equity' },
    });

    expect(isInternalTransfer(row)).toBe(true);
  });

  it('CRITICAL: returns false for real external non-P&L cash movement', () => {
    // An owner contribution, a loan payment, and an equipment purchase are
    // non-P&L, but they are real money in or out.
    const contribution = makeRow({
      category: { id: 'c3', name: 'Owner Contributions', account_type: 'equity', account_subtype: 'owners_equity' },
    });
    const loan = makeRow({
      category: { id: 'c4', name: 'SBA Loan Payable', account_type: 'liability', account_subtype: null },
    });
    const equipment = makeRow({
      category: { id: 'c5', name: 'Kitchen Equipment', account_type: 'asset', account_subtype: 'fixed_assets' },
    });

    expect(isInternalTransfer(contribution)).toBe(false);
    expect(isInternalTransfer(loan)).toBe(false);
    expect(isInternalTransfer(equipment)).toBe(false);
  });

  it('returns false for a P&L row and for an uncategorized row', () => {
    expect(isInternalTransfer(makeRow({}))).toBe(false);
    expect(isInternalTransfer(makeRow({ category: null }))).toBe(false);
  });
});

describe('dayKeyOf', () => {
  it('returns a bare date key unchanged', () => {
    expect(dayKeyOf('2026-08-19')).toBe('2026-08-19');
  });

  it('CRITICAL: strips the time from a timestamptz ISO string', () => {
    expect(dayKeyOf('2026-08-19T12:47:12+00:00')).toBe('2026-08-19');
    expect(dayKeyOf('2026-08-19T00:00:00.000Z')).toBe('2026-08-19');
  });
});

describe('bucketSeries with timestamptz dates', () => {
  it('CRITICAL: buckets a full ISO timestamp by its date, not by local time parsing', () => {
    const rows = [makeRow({ transaction_date: '2026-08-01T23:30:00+00:00', amount: 10 })];

    const buckets = bucketSeries(rows, period('2026-08-01', '2026-08-01'), 'day');

    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({ bucketStart: '2026-08-01', moneyIn: 10 });
  });
});

describe('payeeFor with bank-format descriptions', () => {
  it('CRITICAL: keeps the first segment of a semicolon description', () => {
    const row = makeRow({
      normalized_payee: null,
      merchant_name: null,
      description: 'SYGMA Network; Payment; CAMILUKE FLAVORS LLC - The SYGMA Net',
    });

    expect(payeeFor(row)).toBe('SYGMA Network');
  });

  it('collapses repeated whitespace inside the payee', () => {
    const row = makeRow({ normalized_payee: null, merchant_name: null, description: '  OLO   #  24329  ; deposit' });

    expect(payeeFor(row)).toBe('OLO # 24329');
  });

  it('returns Unknown for a description that is only separators', () => {
    const row = makeRow({ normalized_payee: null, merchant_name: null, description: ' ; Payment' });

    expect(payeeFor(row)).toBe('Unknown');
  });
});

describe('breakdown case folding', () => {
  it('CRITICAL: groups case variants of one payee into one row', () => {
    const rows = [
      makeRow({ amount: 100, normalized_payee: 'OLO # 24329' }),
      makeRow({ amount: 50, normalized_payee: 'Olo # 24329' }),
    ];

    const result = breakdown(rows, 'in', 'payee');

    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('OLO # 24329');
    expect(result[0].amount).toBe(150);
  });
});

describe('breakdown transfer exclusion', () => {
  it('excludes unflagged clearing-account rows', () => {
    const rows = [
      makeRow({ amount: 500, normalized_payee: 'Client A' }),
      makeRow({
        amount: 400,
        normalized_payee: 'Sweep',
        category: { id: 'c9', name: 'Transfer Clearing Account', account_type: 'asset', account_subtype: 'cash' },
      }),
    ];

    const result = breakdown(rows, 'in', 'payee');

    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Client A');
  });
});

describe('formatCompactCurrency', () => {
  it('formats thousands and millions in short form', () => {
    expect(formatCompactCurrency(48000)).toBe('$48K');
    expect(formatCompactCurrency(1200000)).toBe('$1.2M');
    expect(formatCompactCurrency(-2500)).toBe('-$2.5K');
    expect(formatCompactCurrency(0)).toBe('$0');
  });
});

describe('computeCashFlowAggregates', () => {
  it('CRITICAL: drops internal transfers from totals and series when excludeTransfers is set', () => {
    const rows = [
      makeRow({ transaction_date: '2026-08-01', amount: 500 }),
      makeRow({
        transaction_date: '2026-08-01',
        amount: -400,
        is_transfer: false,
        category: { id: 'c9', name: 'Transfer Clearing Account', account_type: 'asset', account_subtype: 'cash' },
      }),
    ];

    const aggregates = computeCashFlowAggregates(rows, period('2026-08-01', '2026-08-01'), 'day', {
      excludeTransfers: true,
    });

    expect(aggregates.totals).toEqual({ moneyIn: 500, moneyOut: 0, net: 500 });
    expect(aggregates.series[0].byCategory).toEqual({ Food: 500 });
  });

  it('keeps internal transfers when excludeTransfers is not set', () => {
    const rows = [
      makeRow({ transaction_date: '2026-08-01', amount: 500 }),
      makeRow({ transaction_date: '2026-08-01', amount: -400, is_transfer: true }),
    ];

    const aggregates = computeCashFlowAggregates(rows, period('2026-08-01', '2026-08-01'), 'day');

    expect(aggregates.totals).toEqual({ moneyIn: 500, moneyOut: -400, net: 100 });
  });
});
