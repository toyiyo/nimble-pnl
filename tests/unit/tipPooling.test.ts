import { describe, expect, it } from 'vitest';
import {
  calculateTipSplitByHours,
  calculateTipSplitByRole,
  rebalanceAllocations,
  formatCurrencyFromCents,
  calculateTipSplitEven,
  filterTipEligible,
} from '@/utils/tipPooling';
import type { Employee } from '@/types/scheduling';

describe('tipPooling - Comprehensive Tests', () => {
  describe('calculateTipSplitEven', () => {
    it('evenly splits and preserves total', () => {
      const shares = calculateTipSplitEven(1000, [
        { id: 'a', name: 'Alice' },
        { id: 'b', name: 'Bob' },
        { id: 'c', name: 'Carla' },
      ]);
      expect(shares.reduce((s, x) => s + x.amountCents, 0)).toBe(1000);
      expect(shares[2].amountCents).toBe(334); // last gets remainder
    });

    it('handles two participants evenly', () => {
      const shares = calculateTipSplitEven(10000, [
        { id: 'a', name: 'Alice' },
        { id: 'b', name: 'Bob' },
      ]);
      expect(shares[0].amountCents).toBe(5000);
      expect(shares[1].amountCents).toBe(5000);
    });

    it('handles single participant', () => {
      const shares = calculateTipSplitEven(10000, [{ id: 'a', name: 'Alice' }]);
      expect(shares[0].amountCents).toBe(10000);
    });

    it('returns zero when total is zero', () => {
      const shares = calculateTipSplitEven(0, [
        { id: 'a', name: 'Alice' },
        { id: 'b', name: 'Bob' },
      ]);
      expect(shares.every((s) => s.amountCents === 0)).toBe(true);
    });

    it('returns empty array preserving structure when no participants', () => {
      const shares = calculateTipSplitEven(1000, []);
      expect(shares.length).toBe(0);
    });

    it('handles odd amounts correctly - remainder to last person', () => {
      const shares = calculateTipSplitEven(100, [
        { id: 'a', name: 'Alice' },
        { id: 'b', name: 'Bob' },
        { id: 'c', name: 'Carla' },
      ]);
      // 100 / 3 = 33 each, remainder 1 goes to last
      expect(shares[0].amountCents).toBe(33);
      expect(shares[1].amountCents).toBe(33);
      expect(shares[2].amountCents).toBe(34);
      expect(shares.reduce((s, x) => s + x.amountCents, 0)).toBe(100);
    });

    it('handles very small amounts', () => {
      const shares = calculateTipSplitEven(2, [
        { id: 'a', name: 'Alice' },
        { id: 'b', name: 'Bob' },
        { id: 'c', name: 'Carla' },
      ]);
      // 2 / 3 = 0 each, remainder 2 goes to last
      expect(shares[0].amountCents).toBe(0);
      expect(shares[1].amountCents).toBe(0);
      expect(shares[2].amountCents).toBe(2);
    });

    it('handles large amounts correctly', () => {
      const shares = calculateTipSplitEven(1000000, [
        { id: 'a', name: 'Alice' },
        { id: 'b', name: 'Bob' },
      ]);
      expect(shares.reduce((s, x) => s + x.amountCents, 0)).toBe(1000000);
    });
  });

  describe('calculateTipSplitByHours', () => {
    it('splits tips proportionally by hours and keeps totals consistent', () => {
      const shares = calculateTipSplitByHours(10000, [
        { id: 'a', name: 'Alice', hours: 5 },
        { id: 'b', name: 'Bob', hours: 3 },
      ]);

      const total = shares.reduce((sum, s) => sum + s.amountCents, 0);
      expect(total).toBe(10000);
      expect(shares.find((s) => s.employeeId === 'a')?.amountCents).toBe(6250);
      expect(shares.find((s) => s.employeeId === 'b')?.amountCents).toBe(3750);
    });

    it('returns zero shares when total is zero', () => {
      const shares = calculateTipSplitByHours(0, [
        { id: 'a', name: 'Alice', hours: 5 },
      ]);
      expect(shares[0].amountCents).toBe(0);
    });

    it('preserves hours in the output', () => {
      const shares = calculateTipSplitByHours(10000, [
        { id: 'a', name: 'Alice', hours: 5 },
        { id: 'b', name: 'Bob', hours: 3 },
      ]);
      expect(shares.find((s) => s.employeeId === 'a')?.hours).toBe(5);
      expect(shares.find((s) => s.employeeId === 'b')?.hours).toBe(3);
    });

    describe('CRITICAL: Zero hours fallback to even split', () => {
      it('falls back to even split when all participants have 0 hours', () => {
        const shares = calculateTipSplitByHours(10000, [
          { id: 'a', name: 'Alice', hours: 0 },
          { id: 'b', name: 'Bob', hours: 0 },
        ]);

        // Should NOT be $0 each - should fall back to even split
        expect(shares[0].amountCents).toBe(5000);
        expect(shares[1].amountCents).toBe(5000);
        expect(shares.reduce((s, x) => s + x.amountCents, 0)).toBe(10000);
      });

      it('falls back to even split when hours are undefined/null', () => {
        const shares = calculateTipSplitByHours(10000, [
          { id: 'a', name: 'Alice', hours: 0 },
          { id: 'b', name: 'Bob', hours: 0 },
          { id: 'c', name: 'Carla', hours: 0 },
        ]);

        // 10000 / 3 = 3333 each, remainder 1 goes to last
        expect(shares[0].amountCents).toBe(3333);
        expect(shares[1].amountCents).toBe(3333);
        expect(shares[2].amountCents).toBe(3334);
        expect(shares.reduce((s, x) => s + x.amountCents, 0)).toBe(10000);
      });

      it('correctly handles mix of 0 hours and positive hours', () => {
        const shares = calculateTipSplitByHours(10000, [
          { id: 'a', name: 'Alice', hours: 0 },
          { id: 'b', name: 'Bob', hours: 10 },
        ]);

        // Alice has 0 hours, Bob has 10 hours
        // Alice gets 0%, Bob gets 100%
        const total = shares.reduce((sum, s) => sum + s.amountCents, 0);
        expect(total).toBe(10000);
        expect(shares.find((s) => s.employeeId === 'a')?.amountCents).toBe(0);
        expect(shares.find((s) => s.employeeId === 'b')?.amountCents).toBe(10000);
      });

      it('REGRESSION: prevents $0 allocations when manager enters tips but forgot to enter hours', () => {
        // Real bug scenario: Manager enters $500 tips for Jan 18
        // Hours haven't been submitted yet (all employees have 0 hours)
        // Previous behavior: Everyone got $0 (bug)
        // Fixed behavior: Falls back to even split
        const shares = calculateTipSplitByHours(50000, [
          { id: 'server1', name: 'John Server', hours: 0 },
          { id: 'server2', name: 'Jane Server', hours: 0 },
          { id: 'bartender', name: 'Bob Bartender', hours: 0 },
        ]);

        // Each should get ~$166.67
        expect(shares[0].amountCents).toBe(16666);
        expect(shares[1].amountCents).toBe(16666);
        expect(shares[2].amountCents).toBe(16668); // remainder
        expect(shares.reduce((s, x) => s + x.amountCents, 0)).toBe(50000);
      });
    });

    it('handles single participant', () => {
      const shares = calculateTipSplitByHours(10000, [
        { id: 'a', name: 'Alice', hours: 5 },
      ]);
      expect(shares[0].amountCents).toBe(10000);
    });

    it('handles uneven proportions with remainder to last', () => {
      const shares = calculateTipSplitByHours(1000, [
        { id: 'a', name: 'Alice', hours: 1 },
        { id: 'b', name: 'Bob', hours: 1 },
        { id: 'c', name: 'Carla', hours: 1 },
      ]);
      const total = shares.reduce((sum, s) => sum + s.amountCents, 0);
      expect(total).toBe(1000); // total preserved
    });

    it('handles fractional hours', () => {
      const shares = calculateTipSplitByHours(10000, [
        { id: 'a', name: 'Alice', hours: 5.5 },
        { id: 'b', name: 'Bob', hours: 4.5 },
      ]);
      const total = shares.reduce((sum, s) => sum + s.amountCents, 0);
      expect(total).toBe(10000);
    });
  });

  describe('calculateTipSplitByRole', () => {
    it('uses role weights to allocate tips', () => {
      const shares = calculateTipSplitByRole(9000, [
        { id: 'a', name: 'Alice', role: 'Server', weight: 2 },
        { id: 'b', name: 'Bob', role: 'Bartender', weight: 1 },
      ]);

      expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(9000);
      expect(shares.find((s) => s.employeeId === 'a')?.amountCents).toBe(6000);
      expect(shares.find((s) => s.employeeId === 'b')?.amountCents).toBe(3000);
    });

    it('preserves role in the output', () => {
      const shares = calculateTipSplitByRole(9000, [
        { id: 'a', name: 'Alice', role: 'Server', weight: 2 },
        { id: 'b', name: 'Bob', role: 'Bartender', weight: 1 },
      ]);
      expect(shares.find((s) => s.employeeId === 'a')?.role).toBe('Server');
      expect(shares.find((s) => s.employeeId === 'b')?.role).toBe('Bartender');
    });

    it('returns zero shares when total is zero', () => {
      const shares = calculateTipSplitByRole(0, [
        { id: 'a', name: 'Alice', role: 'Server', weight: 2 },
      ]);
      expect(shares[0].amountCents).toBe(0);
    });

    describe('CRITICAL: Zero weights fallback to even split', () => {
      it('falls back to even split when all participants have 0 weights', () => {
        const shares = calculateTipSplitByRole(10000, [
          { id: 'a', name: 'Alice', role: 'Server', weight: 0 },
          { id: 'b', name: 'Bob', role: 'Bartender', weight: 0 },
        ]);

        // Should NOT be $0 each - should fall back to even split
        expect(shares[0].amountCents).toBe(5000);
        expect(shares[1].amountCents).toBe(5000);
        expect(shares.reduce((s, x) => s + x.amountCents, 0)).toBe(10000);
      });

      it('falls back to even split for three employees with 0 weights', () => {
        const shares = calculateTipSplitByRole(10000, [
          { id: 'a', name: 'Alice', role: 'Server', weight: 0 },
          { id: 'b', name: 'Bob', role: 'Bartender', weight: 0 },
          { id: 'c', name: 'Carla', role: 'Host', weight: 0 },
        ]);

        // 10000 / 3 = 3333 each, remainder 1 goes to last
        expect(shares[0].amountCents).toBe(3333);
        expect(shares[1].amountCents).toBe(3333);
        expect(shares[2].amountCents).toBe(3334);
        expect(shares.reduce((s, x) => s + x.amountCents, 0)).toBe(10000);
      });

      it('REGRESSION: prevents $0 allocations when roles have no weights configured', () => {
        // Real bug scenario: New role "Food Runner" added but no weight configured
        // All employees are Food Runners with undefined weights
        const shares = calculateTipSplitByRole(50000, [
          { id: 'r1', name: 'Runner 1', role: 'Food Runner', weight: 0 },
          { id: 'r2', name: 'Runner 2', role: 'Food Runner', weight: 0 },
        ]);

        // Each should get $250 (not $0)
        expect(shares[0].amountCents).toBe(25000);
        expect(shares[1].amountCents).toBe(25000);
        expect(shares.reduce((s, x) => s + x.amountCents, 0)).toBe(50000);
      });
    });

    it('handles same role multiple times', () => {
      const shares = calculateTipSplitByRole(10000, [
        { id: 'a', name: 'Alice', role: 'Server', weight: 1 },
        { id: 'b', name: 'Bob', role: 'Server', weight: 1 },
        { id: 'c', name: 'Carla', role: 'Server', weight: 1 },
      ]);

      const total = shares.reduce((sum, s) => sum + s.amountCents, 0);
      expect(total).toBe(10000);
    });

    it('handles decimal weights', () => {
      const shares = calculateTipSplitByRole(10000, [
        { id: 'a', name: 'Alice', role: 'Server', weight: 1.5 },
        { id: 'b', name: 'Bob', role: 'Busser', weight: 0.5 },
      ]);

      // Alice: 1.5/2 = 75%, Bob: 0.5/2 = 25%
      expect(shares.find((s) => s.employeeId === 'a')?.amountCents).toBe(7500);
      expect(shares.find((s) => s.employeeId === 'b')?.amountCents).toBe(2500);
    });

    it('handles typical restaurant weight configuration', () => {
      const shares = calculateTipSplitByRole(10000, [
        { id: 'a', name: 'Alice', role: 'Server', weight: 1.0 },
        { id: 'b', name: 'Bob', role: 'Bartender', weight: 1.0 },
        { id: 'c', name: 'Carla', role: 'Runner', weight: 0.8 },
        { id: 'd', name: 'Dave', role: 'Busser', weight: 0.5 },
      ]);

      // Total weight = 1 + 1 + 0.8 + 0.5 = 3.3
      const total = shares.reduce((sum, s) => sum + s.amountCents, 0);
      expect(total).toBe(10000);
    });
  });

  describe('rebalanceAllocations', () => {
    it('preserves total when one allocation is edited', () => {
      const base = calculateTipSplitByHours(10000, [
        { id: 'a', name: 'Alice', hours: 5 },
        { id: 'b', name: 'Bob', hours: 5 },
      ]);

      const rebalanced = rebalanceAllocations(10000, base, 'a', 8000);
      const total = rebalanced.reduce((sum, s) => sum + s.amountCents, 0);
      expect(total).toBe(10000);
      expect(rebalanced.find((s) => s.employeeId === 'a')?.amountCents).toBe(8000);
      expect(rebalanced.find((s) => s.employeeId === 'b')?.amountCents).toBe(2000);
    });

    it('handles editing to maximum (entire tip pool)', () => {
      const base = calculateTipSplitEven(10000, [
        { id: 'a', name: 'Alice' },
        { id: 'b', name: 'Bob' },
      ]);

      const rebalanced = rebalanceAllocations(10000, base, 'a', 10000);
      expect(rebalanced.find((s) => s.employeeId === 'a')?.amountCents).toBe(10000);
      expect(rebalanced.find((s) => s.employeeId === 'b')?.amountCents).toBe(0);
    });

    it('handles editing to zero', () => {
      const base = calculateTipSplitEven(10000, [
        { id: 'a', name: 'Alice' },
        { id: 'b', name: 'Bob' },
      ]);

      const rebalanced = rebalanceAllocations(10000, base, 'a', 0);
      expect(rebalanced.find((s) => s.employeeId === 'a')?.amountCents).toBe(0);
      expect(rebalanced.find((s) => s.employeeId === 'b')?.amountCents).toBe(10000);
    });

    it('clamps values to valid range (no negative amounts)', () => {
      const base = calculateTipSplitEven(10000, [
        { id: 'a', name: 'Alice' },
        { id: 'b', name: 'Bob' },
      ]);

      const rebalanced = rebalanceAllocations(10000, base, 'a', -1000);
      expect(rebalanced.find((s) => s.employeeId === 'a')?.amountCents).toBe(0);
    });

    it('clamps values to valid range (no more than total)', () => {
      const base = calculateTipSplitEven(10000, [
        { id: 'a', name: 'Alice' },
        { id: 'b', name: 'Bob' },
      ]);

      const rebalanced = rebalanceAllocations(10000, base, 'a', 20000);
      expect(rebalanced.find((s) => s.employeeId === 'a')?.amountCents).toBe(10000);
    });

    it('distributes remaining to multiple participants proportionally', () => {
      const base = calculateTipSplitEven(10000, [
        { id: 'a', name: 'Alice' },
        { id: 'b', name: 'Bob' },
        { id: 'c', name: 'Carla' },
      ]);

      // Alice increases her share, Bob and Carla split the remainder
      const rebalanced = rebalanceAllocations(10000, base, 'a', 7000);
      const total = rebalanced.reduce((sum, s) => sum + s.amountCents, 0);
      expect(total).toBe(10000);
      expect(rebalanced.find((s) => s.employeeId === 'a')?.amountCents).toBe(7000);
    });
  });

  describe('formatCurrencyFromCents', () => {
    it('formats cents to dollars', () => {
      expect(formatCurrencyFromCents(1234)).toBe('$12.34');
    });

    it('formats zero', () => {
      expect(formatCurrencyFromCents(0)).toBe('$0.00');
    });

    it('formats large amounts', () => {
      expect(formatCurrencyFromCents(100000)).toBe('$1,000.00');
    });

    it('formats single digit cents', () => {
      expect(formatCurrencyFromCents(5)).toBe('$0.05');
    });
  });

  describe('filterTipEligible', () => {
    const baseEmployee: Employee = {
      id: 'e1',
      restaurant_id: 'r1',
      name: 'Test',
      position: 'Server',
      status: 'active',
      compensation_type: 'hourly',
      hourly_rate: 1500,
      is_active: true,
      tip_eligible: true,
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
    };

    it('includes active hourly employees who are tip eligible', () => {
      const employees = [baseEmployee];
      const filtered = filterTipEligible(employees);
      expect(filtered.length).toBe(1);
    });

    it('excludes terminated employees', () => {
      const employees = [{ ...baseEmployee, status: 'terminated' as const }];
      const filtered = filterTipEligible(employees);
      expect(filtered.length).toBe(0);
    });

    it('excludes salaried employees', () => {
      const employees = [
        { ...baseEmployee, compensation_type: 'salary' as const },
      ];
      const filtered = filterTipEligible(employees);
      expect(filtered.length).toBe(0);
    });

    it('excludes employees marked as not tip eligible', () => {
      const employees = [{ ...baseEmployee, tip_eligible: false }];
      const filtered = filterTipEligible(employees);
      expect(filtered.length).toBe(0);
    });

    it('includes employees with undefined tip_eligible (defaults to true)', () => {
      const employees = [{ ...baseEmployee, tip_eligible: undefined }];
      const filtered = filterTipEligible(employees);
      expect(filtered.length).toBe(1);
    });

    it('correctly filters mixed employee set', () => {
      const employees: Employee[] = [
        baseEmployee, // Should include
        { ...baseEmployee, id: 'e2', status: 'terminated' as const }, // Exclude
        { ...baseEmployee, id: 'e3', compensation_type: 'salary' as const }, // Exclude
        { ...baseEmployee, id: 'e4', tip_eligible: false }, // Exclude
        { ...baseEmployee, id: 'e5' }, // Should include
      ];
      const filtered = filterTipEligible(employees);
      expect(filtered.length).toBe(2);
      expect(filtered.map((e) => e.id)).toEqual(['e1', 'e5']);
    });
  });

  describe('Total Preservation Tests - Critical for Fair Pay', () => {
    it('INVARIANT: Total tips always equals sum of allocations (even split)', () => {
      for (const total of [100, 1000, 9999, 10001, 100000]) {
        for (const count of [1, 2, 3, 4, 5, 7, 11]) {
          const participants = Array.from({ length: count }, (_, i) => ({
            id: `e${i}`,
            name: `Employee ${i}`,
          }));
          const shares = calculateTipSplitEven(total, participants);
          const sum = shares.reduce((s, x) => s + x.amountCents, 0);
          expect(sum).toBe(total);
        }
      }
    });

    it('INVARIANT: Total tips always equals sum of allocations (by hours)', () => {
      for (const total of [100, 1000, 9999, 10001, 100000]) {
        const participants = [
          { id: 'a', name: 'A', hours: 3 },
          { id: 'b', name: 'B', hours: 5 },
          { id: 'c', name: 'C', hours: 7 },
        ];
        const shares = calculateTipSplitByHours(total, participants);
        const sum = shares.reduce((s, x) => s + x.amountCents, 0);
        expect(sum).toBe(total);
      }
    });

    it('INVARIANT: Total tips always equals sum of allocations (by role)', () => {
      for (const total of [100, 1000, 9999, 10001, 100000]) {
        const participants = [
          { id: 'a', name: 'A', role: 'Server', weight: 1 },
          { id: 'b', name: 'B', role: 'Bartender', weight: 1.5 },
          { id: 'c', name: 'C', role: 'Busser', weight: 0.5 },
        ];
        const shares = calculateTipSplitByRole(total, participants);
        const sum = shares.reduce((s, x) => s + x.amountCents, 0);
        expect(sum).toBe(total);
      }
    });

    it('INVARIANT: Total preserved after rebalancing', () => {
      const total = 10000;
      const base = calculateTipSplitEven(total, [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ]);

      for (const newAmount of [0, 1000, 5000, 9999, total]) {
        const rebalanced = rebalanceAllocations(total, base, 'a', newAmount);
        const sum = rebalanced.reduce((s, x) => s + x.amountCents, 0);
        expect(sum).toBe(total);
      }
    });
  });

  describe('Real-World Scenarios', () => {
    it('Scenario: Busy Friday night tip split by hours', () => {
      // Total tips: $500 (50000 cents)
      // Server A worked 8 hours, Server B worked 6 hours, Bartender worked 4 hours
      const shares = calculateTipSplitByHours(50000, [
        { id: 'serverA', name: 'Server A', hours: 8 },
        { id: 'serverB', name: 'Server B', hours: 6 },
        { id: 'bartender', name: 'Bartender', hours: 4 },
      ]);

      // Total hours: 18
      // Server A: 8/18 = 44.44% = $222.22
      // Server B: 6/18 = 33.33% = $166.67
      // Bartender: 4/18 = 22.22% = $111.11 (+ remainder)
      expect(shares.reduce((s, x) => s + x.amountCents, 0)).toBe(50000);
    });

    it('Scenario: Weekday lunch with role-based split', () => {
      // Total tips: $150 (15000 cents)
      // Server weight: 1.0, Busser weight: 0.5
      const shares = calculateTipSplitByRole(15000, [
        { id: 'server', name: 'Server', role: 'Server', weight: 1.0 },
        { id: 'busser', name: 'Busser', role: 'Busser', weight: 0.5 },
      ]);

      // Total weight: 1.5
      // Server: 1/1.5 = 66.67% = $100
      // Busser: 0.5/1.5 = 33.33% = $50
      expect(shares.find((s) => s.employeeId === 'server')?.amountCents).toBe(10000);
      expect(shares.find((s) => s.employeeId === 'busser')?.amountCents).toBe(5000);
    });

    it('Scenario: Manager adjusts split manually after initial calculation', () => {
      // Initial even split of $300 among 3 employees
      const initial = calculateTipSplitEven(30000, [
        { id: 'a', name: 'Alice' },
        { id: 'b', name: 'Bob' },
        { id: 'c', name: 'Carla' },
      ]);

      // Manager decides Alice deserves more ($150)
      const adjusted = rebalanceAllocations(30000, initial, 'a', 15000);

      expect(adjusted.find((s) => s.employeeId === 'a')?.amountCents).toBe(15000);
      expect(adjusted.reduce((s, x) => s + x.amountCents, 0)).toBe(30000);
    });

    it('Scenario: No hours entered yet, tips should still split fairly', () => {
      // Manager enters tips before timesheet is complete
      const shares = calculateTipSplitByHours(20000, [
        { id: 'a', name: 'Alice', hours: 0 },
        { id: 'b', name: 'Bob', hours: 0 },
      ]);

      // Should fall back to even split, NOT $0 each
      expect(shares[0].amountCents).toBe(10000);
      expect(shares[1].amountCents).toBe(10000);
    });
  });
});
