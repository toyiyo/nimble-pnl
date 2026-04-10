import { describe, it, expect } from 'vitest';
import { calculateLaborBudget, type LaborBudgetData } from '@/hooks/useScheduleLaborBudget';
import type { OperatingCost, BreakEvenData } from '@/types/operatingCosts';

// Helper to create a minimal labor operating cost entry
function makeLaborEntry(overrides: Partial<OperatingCost> = {}): OperatingCost {
  return {
    id: 'labor-1',
    restaurantId: 'rest-1',
    costType: 'variable',
    category: 'labor',
    name: 'Labor Target',
    entryType: 'percentage',
    monthlyValue: 0,
    percentageValue: 0.32,
    isAutoCalculated: false,
    manualOverride: false,
    averagingMonths: 3,
    displayOrder: 2,
    isActive: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

// Helper to create minimal break-even data
function makeBreakEvenData(overrides: Partial<BreakEvenData> = {}): BreakEvenData {
  return {
    dailyBreakEven: 3000,
    monthlyBreakEven: 90000,
    yearlyBreakEven: 1080000,
    totalVariablePercent: 0.40,
    contributionMargin: 0.60,
    todaySales: 3500,
    todayStatus: 'above',
    todayDelta: 500,
    fixedCosts: { items: [], totalDaily: 1800, totalMonthly: 54000, totalYearly: 648000 },
    variableCosts: { items: [], totalDaily: 1120, avgDailySales: 2800 },
    history: [],
    daysAbove: 10,
    daysBelow: 4,
    avgSurplus: 300,
    avgShortfall: -200,
    ...overrides,
  };
}

describe('calculateLaborBudget', () => {
  describe('no labor entry configured', () => {
    it('returns hasBudget: false when no labor entry exists', () => {
      const result = calculateLaborBudget(1000, [], null);
      expect(result.hasBudget).toBe(false);
      expect(result.weeklyTarget).toBe(0);
      expect(result.laborEntry).toBeNull();
    });
  });

  describe('fixed amount budget', () => {
    it('calculates weekly target from monthly value in cents', () => {
      const entry = makeLaborEntry({
        entryType: 'value',
        monthlyValue: 600000, // $6,000/mo in cents
        percentageValue: 0,
      });
      const result = calculateLaborBudget(1000, [entry], null);
      expect(result.hasBudget).toBe(true);
      expect(result.source).toBe('fixed');
      // $6,000/mo ÷ 100 (cents) ÷ 30 days × 7 days = $1,400/wk
      expect(result.weeklyTarget).toBeCloseTo(1400, 0);
    });

    it('calculates percentage and variance correctly', () => {
      const entry = makeLaborEntry({
        entryType: 'value',
        monthlyValue: 600000, // → $1,400/wk
      });
      const result = calculateLaborBudget(1050, [entry], null);
      // 1050 / 1400 = 75%
      expect(result.percentage).toBeCloseTo(75, 0);
      expect(result.variance).toBeCloseTo(350, 0); // 1400 - 1050 = 350 under budget
      expect(result.tier).toBe('success');
    });
  });

  describe('percentage budget with sales data', () => {
    it('uses avgDailySales when available', () => {
      const entry = makeLaborEntry({ percentageValue: 0.32 });
      const breakEven = makeBreakEvenData({
        variableCosts: { items: [], totalDaily: 896, avgDailySales: 2800 },
      });
      const result = calculateLaborBudget(4000, [entry], breakEven);
      expect(result.hasBudget).toBe(true);
      expect(result.source).toBe('sales');
      // $2,800/day × 0.32 × 7 = $6,272/wk
      expect(result.weeklyTarget).toBeCloseTo(6272, 0);
      // 4000 / 6272 ≈ 63.8%
      expect(result.percentage).toBeCloseTo(63.8, 0);
      expect(result.tier).toBe('success');
    });
  });

  describe('percentage budget without sales data (break-even fallback)', () => {
    it('uses dailyBreakEven when avgDailySales is 0', () => {
      const entry = makeLaborEntry({ percentageValue: 0.32 });
      const breakEven = makeBreakEvenData({
        dailyBreakEven: 3000,
        variableCosts: { items: [], totalDaily: 0, avgDailySales: 0 },
      });
      const result = calculateLaborBudget(5000, [entry], breakEven);
      expect(result.hasBudget).toBe(true);
      expect(result.source).toBe('breakeven');
      // $3,000/day × 0.32 × 7 = $6,720/wk
      expect(result.weeklyTarget).toBeCloseTo(6720, 0);
    });

    it('returns hasBudget false when break-even is Infinity', () => {
      const entry = makeLaborEntry({ percentageValue: 0.32 });
      const breakEven = makeBreakEvenData({
        dailyBreakEven: Infinity,
        variableCosts: { items: [], totalDaily: 0, avgDailySales: 0 },
      });
      const result = calculateLaborBudget(5000, [entry], breakEven);
      expect(result.hasBudget).toBe(false);
    });

    it('returns hasBudget false when no break-even data at all', () => {
      const entry = makeLaborEntry({ percentageValue: 0.32 });
      const result = calculateLaborBudget(5000, [entry], null);
      expect(result.hasBudget).toBe(false);
    });
  });

  describe('tier classification', () => {
    it('returns success tier when under 80%', () => {
      const entry = makeLaborEntry({ entryType: 'value', monthlyValue: 600000 }); // $1,400/wk
      const result = calculateLaborBudget(700, [entry], null); // 50%
      expect(result.tier).toBe('success');
    });

    it('returns warning tier when 80-100%', () => {
      const entry = makeLaborEntry({ entryType: 'value', monthlyValue: 600000 }); // $1,400/wk
      const result = calculateLaborBudget(1260, [entry], null); // 90%
      expect(result.tier).toBe('warning');
    });

    it('returns danger tier when over 100%', () => {
      const entry = makeLaborEntry({ entryType: 'value', monthlyValue: 600000 }); // $1,400/wk
      const result = calculateLaborBudget(1540, [entry], null); // 110%
      expect(result.tier).toBe('danger');
    });
  });

  describe('edge cases', () => {
    it('handles zero scheduled labor cost', () => {
      const entry = makeLaborEntry({ entryType: 'value', monthlyValue: 600000 });
      const result = calculateLaborBudget(0, [entry], null);
      expect(result.percentage).toBe(0);
      expect(result.variance).toBeCloseTo(1400, 0);
      expect(result.tier).toBe('success');
    });

    it('handles zero monthly value for fixed budget', () => {
      const entry = makeLaborEntry({ entryType: 'value', monthlyValue: 0 });
      const result = calculateLaborBudget(1000, [entry], null);
      expect(result.hasBudget).toBe(false);
    });

    it('picks first labor entry when multiple exist', () => {
      const entries = [
        makeLaborEntry({ id: 'first', percentageValue: 0.30, displayOrder: 1 }),
        makeLaborEntry({ id: 'second', percentageValue: 0.40, displayOrder: 2 }),
      ];
      const breakEven = makeBreakEvenData({
        variableCosts: { items: [], totalDaily: 840, avgDailySales: 2800 },
      });
      const result = calculateLaborBudget(4000, entries, breakEven);
      // Uses first entry: 2800 × 0.30 × 7 = $5,880
      expect(result.weeklyTarget).toBeCloseTo(5880, 0);
      expect(result.laborEntry?.id).toBe('first');
    });
  });
});
