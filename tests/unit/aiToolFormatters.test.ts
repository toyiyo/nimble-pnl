import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  POS_SALE_PREVIEW_COLUMNS,
  buildCashFlowSummary,
  computeCashCoverage,
  incomeStatementBasis,
  mapTopSoldItems,
  monthlyPnlBasis,
} from '../../supabase/functions/_shared/aiToolFormatters';

/** Column names of unified_sales.Row in the generated Supabase types. */
function unifiedSalesColumns(): string[] {
  const src = readFileSync(resolve(__dirname, '../../src/integrations/supabase/types.ts'), 'utf8');
  const start = src.indexOf('      unified_sales: {');
  const rowStart = src.indexOf('Row: {', start);
  const rowEnd = src.indexOf('}', rowStart);
  return [...src.slice(rowStart, rowEnd).matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1]);
}

describe('POS_SALE_PREVIEW_COLUMNS', () => {
  it('selects only columns that exist on unified_sales', () => {
    const columns = unifiedSalesColumns();
    expect(columns).toContain('pos_system');
    for (const col of POS_SALE_PREVIEW_COLUMNS.split(',').map((c) => c.trim())) {
      expect(columns).toContain(col);
    }
  });

  it('selects pos_system, not the missing source column', () => {
    expect(POS_SALE_PREVIEW_COLUMNS).toMatch(/\bpos_system\b/);
    expect(POS_SALE_PREVIEW_COLUMNS).not.toMatch(/\bsource\b/);
  });
});

describe('mapTopSoldItems', () => {
  it('reports units from quantity and a unit price, not a row count', () => {
    // 8 sale rows of 10 burgers at $12 each.
    const out = mapTopSoldItems([{ item_name: 'Cheeseburger', revenue: 960, quantity: 80, sale_count: 8 }]);
    expect(out).toEqual([
      { item_name: 'Cheeseburger', quantity_sold: 80, line_count: 8, total_sales: 960, avg_price: 12 },
    ]);
  });

  it('gives avg_price 0 when quantity is 0', () => {
    const [row] = mapTopSoldItems([{ item_name: 'Comp', revenue: 0, quantity: 0, sale_count: 2 }]);
    expect(row.avg_price).toBe(0);
  });

  it('accepts null and numeric strings', () => {
    expect(mapTopSoldItems(null)).toEqual([]);
    const [row] = mapTopSoldItems([{ item_name: 'Fries', revenue: '20.5', quantity: '5', sale_count: '1' }]);
    expect(row).toMatchObject({ quantity_sold: 5, total_sales: 20.5, avg_price: 4.1, line_count: 1 });
  });
});

describe('buildCashFlowSummary', () => {
  const days = [
    { inflow: 130, outflow: 0, net: 130 },
    { inflow: 130, outflow: 3000, net: -2870 },
  ];

  it('names totals for the whole period, not 7 days', () => {
    const out = buildCashFlowSummary(days, '2026-08-27', '2026-09-26');
    expect(out).toMatchObject({ inflows: 260, outflows: 3000, net_cash_flow: -2740 });
    expect(Object.keys(out).some((k) => k.endsWith('_7d'))).toBe(false);
  });

  it('counts the end day in period_days', () => {
    expect(buildCashFlowSummary(days, '2026-09-01', '2026-09-30').period_days).toBe(30);
    expect(buildCashFlowSummary(days, '2026-09-26', '2026-09-26').period_days).toBe(1);
  });

  it('averages the net flow over period_days', () => {
    const out = buildCashFlowSummary(days, '2026-09-01', '2026-09-10');
    expect(out.avg_daily_cash_flow).toBeCloseTo(-274, 6);
  });

  it('gives the standard deviation of the daily net flow', () => {
    const out = buildCashFlowSummary(days, '2026-09-01', '2026-09-02');
    expect(out.volatility).toBeCloseTo(1500, 6);
  });

  it('handles null days', () => {
    expect(buildCashFlowSummary(null, '2026-09-01', '2026-09-02')).toMatchObject({
      inflows: 0, outflows: 0, net_cash_flow: 0, volatility: 0,
    });
  });
});

describe('computeCashCoverage', () => {
  it('is not applicable when labor cost is 0', () => {
    expect(computeCashCoverage(25000, 0)).toEqual({ multiplier: null, status: 'not_applicable', alert: null });
  });

  it('is critical with an alert below 1.5x', () => {
    const out = computeCashCoverage(1000, 1000);
    expect(out).toMatchObject({ multiplier: 1, status: 'critical' });
    expect(out.alert).toBe('Cash coverage before payroll is only 1.0x');
  });

  it('is caution from 1.5x and good from 2x', () => {
    expect(computeCashCoverage(1500, 1000)).toMatchObject({ status: 'caution', alert: null });
    expect(computeCashCoverage(2000, 1000)).toMatchObject({ status: 'good', alert: null });
  });
});

describe('P&L basis labels', () => {
  it('income statement names its sources and the closest UI view', () => {
    const b = incomeStatementBasis();
    expect(b.expenses).toMatch(/journal/i);
    expect(b.cogs).toMatch(/inventory usage/i);
    expect(b.closest_ui_view).toBe('Income Statement');
    expect(b.differences).toMatch(/uncategorized bank/i);
  });

  it('monthly P&L warns that bank outflows can overlap COGS', () => {
    const b = monthlyPnlBasis();
    expect(b.expenses).toMatch(/bank/i);
    expect(b.closest_ui_view).toBe('Dashboard monthly breakdown');
    expect(b.differences).toMatch(/inventory purchases/i);
    expect(b.differences).toMatch(/transfers/i);
  });
});
