import { describe, it, expect } from 'vitest';
import {
  getDatesWithApprovedSplits,
  aggregateTipsWithDateFiltering,
  computeTipTotalsWithFiltering,
  type TipSplitItem,
  type EmployeeTip,
} from '@/utils/tipAggregation';

describe('tipAggregation - Double-Counting Prevention', () => {
  const employee1 = '11111111-1111-1111-1111-111111111111';
  const employee2 = '22222222-2222-2222-2222-222222222222';

  describe('getDatesWithApprovedSplits', () => {
    it('returns empty set when no split items', () => {
      const dates = getDatesWithApprovedSplits([]);
      expect(dates.size).toBe(0);
    });

    it('returns unique dates from split items', () => {
      const items: TipSplitItem[] = [
        { employee_id: employee1, amount: 1000, split_date: '2026-01-04' },
        { employee_id: employee2, amount: 1500, split_date: '2026-01-04' },
        { employee_id: employee1, amount: 2000, split_date: '2026-01-05' },
      ];
      
      const dates = getDatesWithApprovedSplits(items);
      expect(dates.size).toBe(2);
      expect(dates.has('2026-01-04')).toBe(true);
      expect(dates.has('2026-01-05')).toBe(true);
    });

    it('handles split items without dates', () => {
      const items: TipSplitItem[] = [
        { employee_id: employee1, amount: 1000 },
        { employee_id: employee2, amount: 1500, split_date: '2026-01-04' },
      ];
      
      const dates = getDatesWithApprovedSplits(items);
      expect(dates.size).toBe(1);
      expect(dates.has('2026-01-04')).toBe(true);
    });
  });

  describe('aggregateTipsWithDateFiltering', () => {
    it('returns empty map when no tips', () => {
      const result = aggregateTipsWithDateFiltering([], []);
      expect(result.size).toBe(0);
    });

    it('includes all employee-declared tips when no approved splits', () => {
      const employeeTips: EmployeeTip[] = [
        { employee_id: employee1, amount: 1000, tip_date: '2026-01-04' },
        { employee_id: employee1, amount: 2000, tip_date: '2026-01-05' },
        { employee_id: employee2, amount: 1500, tip_date: '2026-01-04' },
      ];

      const result = aggregateTipsWithDateFiltering([], employeeTips);
      
      expect(result.get(employee1)?.total).toBe(3000); // 1000 + 2000
      expect(result.get(employee1)?.fromDeclaration).toBe(3000);
      expect(result.get(employee1)?.fromSplit).toBe(0);
      
      expect(result.get(employee2)?.total).toBe(1500);
      expect(result.get(employee2)?.fromDeclaration).toBe(1500);
      expect(result.get(employee2)?.fromSplit).toBe(0);
    });

    it('includes only approved split tips when splits exist', () => {
      const splitItems: TipSplitItem[] = [
        { employee_id: employee1, amount: 1500, split_date: '2026-01-04' },
        { employee_id: employee2, amount: 1500, split_date: '2026-01-04' },
      ];

      const result = aggregateTipsWithDateFiltering(splitItems, []);
      
      expect(result.get(employee1)?.total).toBe(1500);
      expect(result.get(employee1)?.fromSplit).toBe(1500);
      expect(result.get(employee1)?.fromDeclaration).toBe(0);
      
      expect(result.get(employee2)?.total).toBe(1500);
      expect(result.get(employee2)?.fromSplit).toBe(1500);
      expect(result.get(employee2)?.fromDeclaration).toBe(0);
    });

    it('CRITICAL: excludes employee tips for dates with approved splits (prevents double-counting)', () => {
      // Employee declares $10 and $20 on Jan 4
      const employeeTips: EmployeeTip[] = [
        { employee_id: employee1, amount: 1000, tip_date: '2026-01-04' }, // $10
        { employee_id: employee1, amount: 2000, tip_date: '2026-01-04' }, // $20
        { employee_id: employee2, amount: 1000, tip_date: '2026-01-04' }, // $10
        { employee_id: employee2, amount: 2000, tip_date: '2026-01-04' }, // $20
      ];

      // Manager approves split: $30 total → $15 each
      const splitItems: TipSplitItem[] = [
        { employee_id: employee1, amount: 1500, split_date: '2026-01-04' }, // $15
        { employee_id: employee2, amount: 1500, split_date: '2026-01-04' }, // $15
      ];

      const result = aggregateTipsWithDateFiltering(splitItems, employeeTips);
      
      // Should be $15 each (from split), NOT $25 and $35 (would be double-counting)
      expect(result.get(employee1)?.total).toBe(1500); // $15 (correct)
      expect(result.get(employee1)?.fromSplit).toBe(1500);
      expect(result.get(employee1)?.fromDeclaration).toBe(0); // Excluded!
      
      expect(result.get(employee2)?.total).toBe(1500); // $15 (correct)
      expect(result.get(employee2)?.fromSplit).toBe(1500);
      expect(result.get(employee2)?.fromDeclaration).toBe(0); // Excluded!
    });

    it('includes employee tips for dates WITHOUT approved splits', () => {
      // Employee declares tips on Jan 4 and Jan 5
      const employeeTips: EmployeeTip[] = [
        { employee_id: employee1, amount: 1000, tip_date: '2026-01-04' },
        { employee_id: employee1, amount: 2000, tip_date: '2026-01-05' },
      ];

      // Manager only approved split for Jan 4
      const splitItems: TipSplitItem[] = [
        { employee_id: employee1, amount: 1500, split_date: '2026-01-04' },
      ];

      const result = aggregateTipsWithDateFiltering(splitItems, employeeTips);
      
      // Jan 4: $15 from split (employee tips excluded)
      // Jan 5: $20 from declaration (no split for this date)
      // Total: $35
      expect(result.get(employee1)?.total).toBe(3500); // $35
      expect(result.get(employee1)?.fromSplit).toBe(1500); // $15
      expect(result.get(employee1)?.fromDeclaration).toBe(2000); // $20
    });

    it('handles multiple employees with mixed split and declared tips', () => {
      const employeeTips: EmployeeTip[] = [
        { employee_id: employee1, amount: 1000, tip_date: '2026-01-04' },
        { employee_id: employee1, amount: 1500, tip_date: '2026-01-05' },
        { employee_id: employee2, amount: 2000, tip_date: '2026-01-04' },
        { employee_id: employee2, amount: 2500, tip_date: '2026-01-06' },
      ];

      const splitItems: TipSplitItem[] = [
        { employee_id: employee1, amount: 1200, split_date: '2026-01-04' },
        { employee_id: employee2, amount: 1800, split_date: '2026-01-04' },
      ];

      const result = aggregateTipsWithDateFiltering(splitItems, employeeTips);
      
      // Employee 1: Jan 4 split ($12) + Jan 5 declaration ($15) = $27
      expect(result.get(employee1)?.total).toBe(2700);
      expect(result.get(employee1)?.fromSplit).toBe(1200);
      expect(result.get(employee1)?.fromDeclaration).toBe(1500);
      
      // Employee 2: Jan 4 split ($18) + Jan 6 declaration ($25) = $43
      expect(result.get(employee2)?.total).toBe(4300);
      expect(result.get(employee2)?.fromSplit).toBe(1800);
      expect(result.get(employee2)?.fromDeclaration).toBe(2500);
    });

    it('handles multiple splits for the same employee on different dates', () => {
      const splitItems: TipSplitItem[] = [
        { employee_id: employee1, amount: 1000, split_date: '2026-01-04' },
        { employee_id: employee1, amount: 2000, split_date: '2026-01-05' },
        { employee_id: employee1, amount: 1500, split_date: '2026-01-06' },
      ];

      const result = aggregateTipsWithDateFiltering(splitItems, []);
      
      expect(result.get(employee1)?.total).toBe(4500); // $45
      expect(result.get(employee1)?.fromSplit).toBe(4500);
    });

    it('handles edge case: zero amount tips', () => {
      const employeeTips: EmployeeTip[] = [
        { employee_id: employee1, amount: 0, tip_date: '2026-01-04' },
      ];

      const splitItems: TipSplitItem[] = [
        { employee_id: employee2, amount: 0, split_date: '2026-01-05' },
      ];

      const result = aggregateTipsWithDateFiltering(splitItems, employeeTips);
      
      expect(result.get(employee1)?.total).toBe(0);
      expect(result.get(employee2)?.total).toBe(0);
    });
  });

  describe('computeTipTotalsWithFiltering', () => {
    it('returns totals from aggregation', () => {
      const employeeTips: EmployeeTip[] = [
        { employee_id: employee1, amount: 1000, tip_date: '2026-01-04' },
        { employee_id: employee2, amount: 2000, tip_date: '2026-01-04' },
      ];

      const result = computeTipTotalsWithFiltering([], employeeTips);
      
      expect(result.get(employee1)).toBe(1000);
      expect(result.get(employee2)).toBe(2000);
    });

    it('prevents double-counting by excluding employee tips for split dates', () => {
      const employeeTips: EmployeeTip[] = [
        { employee_id: employee1, amount: 1000, tip_date: '2026-01-04' },
        { employee_id: employee2, amount: 2000, tip_date: '2026-01-04' },
      ];

      const splitItems: TipSplitItem[] = [
        { employee_id: employee1, amount: 1500, split_date: '2026-01-04' },
        { employee_id: employee2, amount: 1500, split_date: '2026-01-04' },
      ];

      const result = computeTipTotalsWithFiltering(splitItems, employeeTips);
      
      // Should use split amounts, not declarations
      expect(result.get(employee1)).toBe(1500);
      expect(result.get(employee2)).toBe(1500);
    });

    it('falls back to POS data when no manual tips exist', () => {
      const posTips = new Map([
        [employee1, 3000],
        [employee2, 4000],
      ]);

      const result = computeTipTotalsWithFiltering([], [], posTips);
      
      expect(result.get(employee1)).toBe(3000);
      expect(result.get(employee2)).toBe(4000);
    });

    it('uses manual tips over POS fallback when manual tips exist', () => {
      const employeeTips: EmployeeTip[] = [
        { employee_id: employee1, amount: 1000, tip_date: '2026-01-04' },
      ];

      const posTips = new Map([
        [employee1, 3000],
        [employee2, 4000],
      ]);

      const result = computeTipTotalsWithFiltering([], employeeTips, posTips);
      
      // Should use manual tip, not POS
      expect(result.get(employee1)).toBe(1000);
      // Employee 2 has no manual tip, so no value (POS only used if NO manual tips at all)
      expect(result.has(employee2)).toBe(false);
    });

    it('handles complex scenario with multiple dates and employees', () => {
      // Scenario:
      // Jan 4: Employee 1 declares $10, Employee 2 declares $20 → Manager splits $30 → $15 each
      // Jan 5: Employee 1 declares $25 (no split)
      // Jan 6: Employee 2 declares $30 (no split)
      
      const employeeTips: EmployeeTip[] = [
        { employee_id: employee1, amount: 1000, tip_date: '2026-01-04' },
        { employee_id: employee2, amount: 2000, tip_date: '2026-01-04' },
        { employee_id: employee1, amount: 2500, tip_date: '2026-01-05' },
        { employee_id: employee2, amount: 3000, tip_date: '2026-01-06' },
      ];

      const splitItems: TipSplitItem[] = [
        { employee_id: employee1, amount: 1500, split_date: '2026-01-04' },
        { employee_id: employee2, amount: 1500, split_date: '2026-01-04' },
      ];

      const result = computeTipTotalsWithFiltering(splitItems, employeeTips);
      
      // Employee 1: Jan 4 split ($15) + Jan 5 declaration ($25) = $40
      expect(result.get(employee1)).toBe(4000);
      
      // Employee 2: Jan 4 split ($15) + Jan 6 declaration ($30) = $45
      expect(result.get(employee2)).toBe(4500);
    });
  });

  describe('Regression Tests - Previous Bug Scenarios', () => {
    it('does not divide by 100 (cents handling bug)', () => {
      // Previous bug: tips were divided by 100 twice
      const employeeTips: EmployeeTip[] = [
        { employee_id: employee1, amount: 1000, tip_date: '2026-01-04' }, // $10 in cents
      ];

      const result = computeTipTotalsWithFiltering([], employeeTips);
      
      // Should be 1000 cents ($10), not 10 cents ($0.10)
      expect(result.get(employee1)).toBe(1000);
    });

    it('preserves total when splitting evenly with remainder', () => {
      // If $31 split 3 ways → $10.33, $10.33, $10.34
      // In cents: 3100 / 3 = 1033 each, remainder 1
      const splitItems: TipSplitItem[] = [
        { employee_id: employee1, amount: 1033, split_date: '2026-01-04' },
        { employee_id: employee2, amount: 1033, split_date: '2026-01-04' },
        { employee_id: '33333333-3333-3333-3333-333333333333', amount: 1034, split_date: '2026-01-04' },
      ];

      const result = computeTipTotalsWithFiltering(splitItems, []);
      
      const total = Array.from(result.values()).reduce((sum, val) => sum + val, 0);
      expect(total).toBe(3100); // Total preserved
    });
  });
});
