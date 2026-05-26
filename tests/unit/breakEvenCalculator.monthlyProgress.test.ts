import { describe, it, expect } from 'vitest';
import { calculateBreakEven } from '@/lib/breakEvenCalculator';
import type { OperatingCost } from '@/types/operatingCosts';

function makeCost(partial: Partial<OperatingCost>): OperatingCost {
  return {
    id: partial.id ?? `c-${Math.random()}`,
    restaurantId: 'r1',
    costType: partial.costType ?? 'fixed',
    category: partial.category ?? 'rent',
    name: partial.name ?? 'Rent',
    entryType: partial.entryType ?? 'value',
    monthlyValue: partial.monthlyValue ?? 0,
    percentageValue: partial.percentageValue ?? 0,
    isAutoCalculated: partial.isAutoCalculated ?? false,
    manualOverride: partial.manualOverride ?? false,
    averagingMonths: partial.averagingMonths ?? 3,
    displayOrder: partial.displayOrder ?? 1,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

describe('calculateBreakEven — monthlyProgress field', () => {
  it('attaches monthlyProgress derived from MTD slice of salesData', () => {
    // Fixed: $10000/month rent => $333/day. Variable: 50% (food + labor).
    // contributionMargin = 0.5 => monthlyBreakEven = 10000 / 0.5 = 20000
    const costs: OperatingCost[] = [
      makeCost({
        id: 'rent',
        costType: 'fixed',
        entryType: 'value',
        monthlyValue: 1_000_000, // $10,000 in cents
      }),
      makeCost({
        id: 'food',
        costType: 'variable',
        entryType: 'percentage',
        percentageValue: 0.3,
      }),
      makeCost({
        id: 'labor',
        costType: 'variable',
        entryType: 'percentage',
        percentageValue: 0.2,
      }),
    ];

    // 10 days into May 2026 (31-day month). Sales: $1k/day for 10 days = $10k MTD.
    // Pre-month sales (before May 1) are still in the rolling window — they
    // must be EXCLUDED from MTD.
    const salesData = [
      { date: '2026-04-29', netRevenue: 99999, transactionCount: 50 }, // ignored
      { date: '2026-04-30', netRevenue: 99999, transactionCount: 50 }, // ignored
      { date: '2026-05-01', netRevenue: 1000, transactionCount: 5 },
      { date: '2026-05-02', netRevenue: 1000, transactionCount: 5 },
      { date: '2026-05-03', netRevenue: 1000, transactionCount: 5 },
      { date: '2026-05-04', netRevenue: 1000, transactionCount: 5 },
      { date: '2026-05-05', netRevenue: 1000, transactionCount: 5 },
      { date: '2026-05-06', netRevenue: 1000, transactionCount: 5 },
      { date: '2026-05-07', netRevenue: 1000, transactionCount: 5 },
      { date: '2026-05-08', netRevenue: 1000, transactionCount: 5 },
      { date: '2026-05-09', netRevenue: 1000, transactionCount: 5 },
      { date: '2026-05-10', netRevenue: 1000, transactionCount: 5 },
    ];

    const result = calculateBreakEven(costs, salesData, 0, '2026-05-10');

    expect(result.monthlyBreakEven).toBeCloseTo(20000, 1);
    expect(result.monthlyProgress).toBeTruthy();
    expect(result.monthlyProgress.mtdSales).toBe(10000); // only the May rows
    expect(result.monthlyProgress.monthlyBreakEven).toBeCloseTo(20000, 1);
    expect(result.monthlyProgress.daysInMonth).toBe(31);
    expect(result.monthlyProgress.dayOfMonth).toBe(10);
    // progress ≈ 50%, expected ≈ 32.3%, paceDelta ≈ +17.7pp => ahead
    expect(result.monthlyProgress.status).toBe('ahead');
  });

  it('emits status no_target when contribution margin <= 0 (variable costs >= 100%)', () => {
    const costs: OperatingCost[] = [
      makeCost({ costType: 'fixed', entryType: 'value', monthlyValue: 100000 }),
      makeCost({ costType: 'variable', entryType: 'percentage', percentageValue: 1.0 }),
    ];
    const salesData = [{ date: '2026-05-15', netRevenue: 500, transactionCount: 1 }];
    const result = calculateBreakEven(costs, salesData, 0, '2026-05-15');
    expect(result.monthlyProgress.status).toBe('no_target');
  });

  it('still produces monthlyProgress when no fixed costs are configured', () => {
    const costs: OperatingCost[] = [
      makeCost({ costType: 'variable', entryType: 'percentage', percentageValue: 0.3 }),
    ];
    const salesData = [{ date: '2026-05-15', netRevenue: 500, transactionCount: 1 }];
    const result = calculateBreakEven(costs, salesData, 0, '2026-05-15');
    expect(result.monthlyProgress.status).toBe('no_target');
    expect(result.monthlyProgress.monthLabel).toMatch(/May 2026/);
  });
});
