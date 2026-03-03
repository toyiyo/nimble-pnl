import { describe, it, expect } from 'vitest';
import { calculateBreakEven } from '@/lib/breakEvenCalculator';
import type { OperatingCost } from '@/types/operatingCosts';

function makeCost(overrides: Partial<OperatingCost>): OperatingCost {
  return {
    id: crypto.randomUUID(),
    restaurantId: 'r1',
    costType: 'fixed',
    category: 'test',
    name: 'Test',
    entryType: 'value',
    monthlyValue: 0,
    percentageValue: 0,
    isAutoCalculated: false,
    manualOverride: false,
    averagingMonths: 3,
    displayOrder: 1,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('calculateBreakEven', () => {
  it('computes contribution margin from percentage-based costs', () => {
    const costs = [
      makeCost({ entryType: 'percentage', percentageValue: 0.25, costType: 'variable', name: 'Food Cost' }),
      makeCost({ entryType: 'percentage', percentageValue: 0.25, costType: 'variable', name: 'Labor' }),
      makeCost({ entryType: 'percentage', percentageValue: 0.11, costType: 'variable', name: 'CC/Marketing' }),
    ];
    const salesData = [{ date: '2026-01-01', netRevenue: 1000, transactionCount: 10 }];

    const result = calculateBreakEven(costs, salesData, 0, '2026-01-01');

    expect(result.totalVariablePercent).toBeCloseTo(0.61, 2);
    expect(result.contributionMargin).toBeCloseTo(0.39, 2);
  });

  it('computes BEP = fixed costs / contribution margin (matches image example)', () => {
    const costs = [
      // Fixed: $10,000/month total
      makeCost({ entryType: 'value', monthlyValue: 1000000, costType: 'fixed', name: 'Rent' }),
      // Variable: 25% + 25% + 11% = 61%
      makeCost({ entryType: 'percentage', percentageValue: 0.25, costType: 'variable', name: 'Food' }),
      makeCost({ entryType: 'percentage', percentageValue: 0.25, costType: 'variable', name: 'Labor' }),
      makeCost({ entryType: 'percentage', percentageValue: 0.11, costType: 'variable', name: 'CC' }),
    ];
    const salesData = [{ date: '2026-01-01', netRevenue: 1000, transactionCount: 10 }];

    const result = calculateBreakEven(costs, salesData, 0, '2026-01-01');

    // Monthly BEP = $10,000 / 0.39 ≈ $25,641
    expect(result.monthlyBreakEven).toBeCloseTo(25641, -1);
    // Daily BEP = monthly / 30
    expect(result.dailyBreakEven).toBeCloseTo(25641 / 30, 0);
    // Yearly BEP = monthly * 12
    expect(result.yearlyBreakEven).toBeCloseTo(25641 * 12, -2);
  });

  it('groups dollar-amount costs (including semi_variable, custom) under fixedCosts', () => {
    const costs = [
      makeCost({ entryType: 'value', monthlyValue: 500000, costType: 'fixed', name: 'Rent' }),
      makeCost({ entryType: 'value', monthlyValue: 30000, costType: 'semi_variable', name: 'Electric', isAutoCalculated: true }),
      makeCost({ entryType: 'value', monthlyValue: 20000, costType: 'custom', name: 'Marketing' }),
    ];
    const salesData = [{ date: '2026-01-01', netRevenue: 1000, transactionCount: 10 }];

    const result = calculateBreakEven(costs, salesData, 0, '2026-01-01');

    expect(result.fixedCosts.items).toHaveLength(3);
    // Total monthly = $5000 + $300 + $200 = $5500
    expect(result.fixedCosts.totalMonthly).toBeCloseTo(5500, 0);
    expect(result.fixedCosts.totalDaily).toBeCloseTo(5500 / 30, 0);
    expect(result.fixedCosts.totalYearly).toBeCloseTo(5500 * 12, 0);
  });

  it('groups percentage costs under variableCosts regardless of cost_type', () => {
    const costs = [
      makeCost({ entryType: 'percentage', percentageValue: 0.28, costType: 'variable', name: 'Food' }),
      makeCost({ entryType: 'percentage', percentageValue: 0.05, costType: 'custom', name: 'Royalties' }),
    ];
    const salesData = [{ date: '2026-01-01', netRevenue: 2000, transactionCount: 10 }];

    const result = calculateBreakEven(costs, salesData, 0, '2026-01-01');

    expect(result.variableCosts.items).toHaveLength(2);
    expect(result.totalVariablePercent).toBeCloseTo(0.33, 2);
    expect(result.contributionMargin).toBeCloseTo(0.67, 2);
  });

  it('handles zero variable costs (contribution margin = 1)', () => {
    const costs = [
      makeCost({ entryType: 'value', monthlyValue: 300000, costType: 'fixed', name: 'Rent' }),
    ];
    const salesData = [{ date: '2026-01-01', netRevenue: 1000, transactionCount: 10 }];

    const result = calculateBreakEven(costs, salesData, 0, '2026-01-01');

    expect(result.totalVariablePercent).toBe(0);
    expect(result.contributionMargin).toBe(1);
    expect(result.monthlyBreakEven).toBeCloseTo(3000, 0);
  });

  it('handles 100% variable costs (contribution margin = 0, BEP = Infinity)', () => {
    const costs = [
      makeCost({ entryType: 'percentage', percentageValue: 1.0, costType: 'variable', name: 'Everything' }),
      makeCost({ entryType: 'value', monthlyValue: 100000, costType: 'fixed', name: 'Rent' }),
    ];
    const salesData = [{ date: '2026-01-01', netRevenue: 1000, transactionCount: 10 }];

    const result = calculateBreakEven(costs, salesData, 0, '2026-01-01');

    expect(result.contributionMargin).toBe(0);
    expect(result.monthlyBreakEven).toBe(Infinity);
  });

  it('uses auto-calculated utility value when provided', () => {
    const costs = [
      makeCost({
        entryType: 'value',
        monthlyValue: 0,
        costType: 'semi_variable',
        name: 'Electric',
        isAutoCalculated: true,
        manualOverride: false,
      }),
    ];
    const salesData = [{ date: '2026-01-01', netRevenue: 1000, transactionCount: 10 }];
    const autoUtilityCosts = 50000; // $500/month in cents

    const result = calculateBreakEven(costs, salesData, autoUtilityCosts, '2026-01-01');

    expect(result.fixedCosts.items).toHaveLength(1);
    expect(result.fixedCosts.totalMonthly).toBeCloseTo(500, 0);
  });

  it('classifies status as below when break-even is Infinity', () => {
    const costs = [
      makeCost({ entryType: 'percentage', percentageValue: 1.0, costType: 'variable', name: 'Everything' }),
      makeCost({ entryType: 'value', monthlyValue: 100000, costType: 'fixed', name: 'Rent' }),
    ];
    const salesData = [{ date: '2026-01-01', netRevenue: 5000, transactionCount: 10 }];

    const result = calculateBreakEven(costs, salesData, 0, '2026-01-01');

    expect(result.monthlyBreakEven).toBe(Infinity);
    expect(result.todayStatus).toBe('below');
    expect(result.history[0].status).toBe('below');
  });

  it('classifies status as at when break-even and sales are both zero', () => {
    const costs: OperatingCost[] = [];
    const salesData = [{ date: '2026-01-01', netRevenue: 0, transactionCount: 0 }];

    const result = calculateBreakEven(costs, salesData, 0, '2026-01-01');

    expect(result.dailyBreakEven).toBe(0);
    expect(result.todayStatus).toBe('at');
    expect(result.history[0].status).toBe('at');
  });

  it('classifies status as above when break-even is zero but sales are positive', () => {
    const costs: OperatingCost[] = [];
    const salesData = [{ date: '2026-01-01', netRevenue: 500, transactionCount: 5 }];

    const result = calculateBreakEven(costs, salesData, 0, '2026-01-01');

    expect(result.dailyBreakEven).toBe(0);
    expect(result.todayStatus).toBe('above');
  });

  it('builds correct history with daily BEP', () => {
    const costs = [
      makeCost({ entryType: 'value', monthlyValue: 300000, costType: 'fixed', name: 'Rent' }),
      makeCost({ entryType: 'percentage', percentageValue: 0.30, costType: 'variable', name: 'Food' }),
    ];
    const salesData = [
      { date: '2026-01-01', netRevenue: 500, transactionCount: 5 },
      { date: '2026-01-02', netRevenue: 200, transactionCount: 3 },
    ];

    const result = calculateBreakEven(costs, salesData, 0, '2026-01-02');

    expect(result.history).toHaveLength(2);
    expect(result.history[0].breakEven).toBe(result.dailyBreakEven);
    expect(result.history[1].breakEven).toBe(result.dailyBreakEven);
    expect(result.history[0].delta).toBeCloseTo(500 - result.dailyBreakEven, 0);
  });
});
