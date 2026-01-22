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

    describe('CRITICAL: $0 splits should NOT count as having a split', () => {
      it('does NOT include dates where all split items have $0 amount', () => {
        const items: TipSplitItem[] = [
          { employee_id: employee1, amount: 0, split_date: '2026-01-04' },
          { employee_id: employee2, amount: 0, split_date: '2026-01-04' },
        ];

        const dates = getDatesWithApprovedSplits(items);
        expect(dates.size).toBe(0);
        expect(dates.has('2026-01-04')).toBe(false);
      });

      it('includes dates only when at least one split item has amount > 0', () => {
        const items: TipSplitItem[] = [
          { employee_id: employee1, amount: 0, split_date: '2026-01-04' },
          { employee_id: employee2, amount: 1500, split_date: '2026-01-04' }, // Has money
          { employee_id: employee1, amount: 0, split_date: '2026-01-05' }, // All $0
        ];

        const dates = getDatesWithApprovedSplits(items);
        expect(dates.size).toBe(1);
        expect(dates.has('2026-01-04')).toBe(true);
        expect(dates.has('2026-01-05')).toBe(false);
      });

      it('REGRESSION: $0 splits should allow employee declarations to be counted', () => {
        // Real bug scenario: Manager creates a split but forgets to allocate money
        // Employees have declared tips that should NOT be blocked
        const items: TipSplitItem[] = [
          { employee_id: employee1, amount: 0, split_date: '2026-01-18' },
          { employee_id: employee2, amount: 0, split_date: '2026-01-18' },
        ];

        const dates = getDatesWithApprovedSplits(items);
        // Jan 18 should NOT be in the set because all amounts are $0
        expect(dates.has('2026-01-18')).toBe(false);
      });
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

    describe('CRITICAL: $0 splits allow employee declarations', () => {
      it('includes employee declarations when split has $0 allocations', () => {
        // Scenario: Manager creates split but all allocations are $0
        // Employee declarations for that date should still be counted
        const splitItems: TipSplitItem[] = [
          { employee_id: employee1, amount: 0, split_date: '2026-01-18' },
          { employee_id: employee2, amount: 0, split_date: '2026-01-18' },
        ];

        const employeeTips: EmployeeTip[] = [
          { employee_id: employee1, amount: 5000, tip_date: '2026-01-18' }, // $50
          { employee_id: employee2, amount: 3000, tip_date: '2026-01-18' }, // $30
        ];

        const result = aggregateTipsWithDateFiltering(splitItems, employeeTips);

        // Employee declarations should be included since split has $0
        expect(result.get(employee1)?.total).toBe(5000);
        expect(result.get(employee1)?.fromDeclaration).toBe(5000);
        expect(result.get(employee1)?.fromSplit).toBe(0);

        expect(result.get(employee2)?.total).toBe(3000);
        expect(result.get(employee2)?.fromDeclaration).toBe(3000);
        expect(result.get(employee2)?.fromSplit).toBe(0);
      });

      it('REGRESSION: prevents lost tips when hours-based split yields $0 due to no hours', () => {
        // Real bug scenario from production:
        // - Manager enters $500 tips for Jan 18
        // - Hours split calculated but no one has hours logged = all $0 allocations
        // - Employee declarations of $80 were being blocked
        // - Fixed: $0 splits don't block employee declarations

        const splitItems: TipSplitItem[] = [
          { employee_id: employee1, amount: 0, split_date: '2026-01-18' },
          { employee_id: employee2, amount: 0, split_date: '2026-01-18' },
        ];

        const employeeTips: EmployeeTip[] = [
          { employee_id: employee1, amount: 4000, tip_date: '2026-01-18' }, // $40 cash
          { employee_id: employee1, amount: 4000, tip_date: '2026-01-18' }, // $40 credit
        ];

        const result = aggregateTipsWithDateFiltering(splitItems, employeeTips);

        // Employee 1 should get their $80 declaration
        expect(result.get(employee1)?.total).toBe(8000);
        expect(result.get(employee1)?.fromDeclaration).toBe(8000);
      });

      it('correctly blocks employee declarations when split HAS money', () => {
        // When a split has actual money allocated, employee declarations ARE blocked
        const splitItems: TipSplitItem[] = [
          { employee_id: employee1, amount: 5000, split_date: '2026-01-18' }, // $50
          { employee_id: employee2, amount: 5000, split_date: '2026-01-18' }, // $50
        ];

        const employeeTips: EmployeeTip[] = [
          { employee_id: employee1, amount: 4000, tip_date: '2026-01-18' }, // Should be excluded
          { employee_id: employee2, amount: 6000, tip_date: '2026-01-18' }, // Should be excluded
        ];

        const result = aggregateTipsWithDateFiltering(splitItems, employeeTips);

        // Should use split amounts, not declarations
        expect(result.get(employee1)?.total).toBe(5000);
        expect(result.get(employee1)?.fromSplit).toBe(5000);
        expect(result.get(employee1)?.fromDeclaration).toBe(0);

        expect(result.get(employee2)?.total).toBe(5000);
        expect(result.get(employee2)?.fromSplit).toBe(5000);
        expect(result.get(employee2)?.fromDeclaration).toBe(0);
      });

      it('handles mixed scenario: some dates with $0 splits, some with money', () => {
        const splitItems: TipSplitItem[] = [
          // Jan 18: All $0 (broken hours-based split)
          { employee_id: employee1, amount: 0, split_date: '2026-01-18' },
          { employee_id: employee2, amount: 0, split_date: '2026-01-18' },
          // Jan 19: Has money (working split)
          { employee_id: employee1, amount: 7500, split_date: '2026-01-19' },
          { employee_id: employee2, amount: 7500, split_date: '2026-01-19' },
        ];

        const employeeTips: EmployeeTip[] = [
          // Jan 18 declarations - should be included
          { employee_id: employee1, amount: 4000, tip_date: '2026-01-18' },
          { employee_id: employee2, amount: 3000, tip_date: '2026-01-18' },
          // Jan 19 declarations - should be EXCLUDED (split has money)
          { employee_id: employee1, amount: 10000, tip_date: '2026-01-19' },
          { employee_id: employee2, amount: 12000, tip_date: '2026-01-19' },
        ];

        const result = aggregateTipsWithDateFiltering(splitItems, employeeTips);

        // Employee 1: Jan 18 declaration ($40) + Jan 19 split ($75) = $115
        expect(result.get(employee1)?.total).toBe(11500);
        expect(result.get(employee1)?.fromDeclaration).toBe(4000);
        expect(result.get(employee1)?.fromSplit).toBe(7500);

        // Employee 2: Jan 18 declaration ($30) + Jan 19 split ($75) = $105
        expect(result.get(employee2)?.total).toBe(10500);
        expect(result.get(employee2)?.fromDeclaration).toBe(3000);
        expect(result.get(employee2)?.fromSplit).toBe(7500);
      });
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
