import { describe, it, expect } from 'vitest';
import {
  resolveLaborBasis,
  combineDailyCosts,
  type CombinedDailyCost,
} from '@/lib/combineCosts';

describe('resolveLaborBasis', () => {
  it('returns accrued when any time-punch labor exists', () => {
    expect(resolveLaborBasis(1234.56)).toBe('accrued');
  });
  it('falls back to paid when accrued is exactly zero', () => {
    expect(resolveLaborBasis(0)).toBe('paid');
  });
});

describe('combineDailyCosts', () => {
  const cogs = [{ date: '2026-04-01', amount: 100 }, { date: '2026-04-02', amount: 50 }];
  const pending = [{ date: '2026-04-01', total_labor_cost: 200 }]; // accrued, only day 1 has punches
  const actual = [
    { date: '2026-04-01', labor_cost: 180 },
    { date: '2026-04-02', labor_cost: 90 }, // bank payroll posted on a no-punch day
  ];

  it('does NOT sum accrued + paid — accrued basis uses pending only', () => {
    const rows = combineDailyCosts(cogs, pending, actual, 'accrued');
    const total = rows.reduce((s, r) => s + r.labor_cost, 0);
    // pending total is 200; the double-count bug returned 200 + 270 = 470
    expect(total).toBe(200);
  });

  it('applies the period basis uniformly — a no-punch day contributes 0 under accrued', () => {
    const rows = combineDailyCosts(cogs, pending, actual, 'accrued');
    const day2 = rows.find((r) => r.date === '2026-04-02') as CombinedDailyCost;
    // day 2 has paid labor 90 but no punches; per-period accrued basis => 0, not 90
    expect(day2.labor_cost).toBe(0);
  });

  it('paid basis uses actual (bank) labor', () => {
    const rows = combineDailyCosts(cogs, [], actual, 'paid');
    const total = rows.reduce((s, r) => s + r.labor_cost, 0);
    expect(total).toBe(270); // 180 + 90
  });

  it('always preserves the pending/actual breakdown regardless of basis', () => {
    const rows = combineDailyCosts(cogs, pending, actual, 'accrued');
    const day1 = rows.find((r) => r.date === '2026-04-01') as CombinedDailyCost;
    expect(day1.pending_labor_cost).toBe(200);
    expect(day1.actual_labor_cost).toBe(180);
  });

  it('total_cost = food_cost + basis labor_cost, and rows are date-sorted', () => {
    const rows = combineDailyCosts(cogs, pending, actual, 'accrued');
    expect(rows.map((r) => r.date)).toEqual(['2026-04-01', '2026-04-02']);
    expect(rows[0].total_cost).toBe(100 + 200);
    expect(rows[1].total_cost).toBe(50 + 0);
  });

  it('leaves food cost untouched by the labor basis', () => {
    const accrued = combineDailyCosts(cogs, pending, actual, 'accrued');
    const paid = combineDailyCosts(cogs, pending, actual, 'paid');
    expect(accrued.reduce((s, r) => s + r.food_cost, 0)).toBe(150);
    expect(paid.reduce((s, r) => s + r.food_cost, 0)).toBe(150);
  });
});
