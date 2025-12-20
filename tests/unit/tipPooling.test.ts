import { describe, expect, it } from 'vitest';
import {
  calculateTipSplitByHours,
  calculateTipSplitByRole,
  rebalanceAllocations,
  formatCurrencyFromCents,
  calculateTipSplitEven,
} from '@/utils/tipPooling';

describe('tipPooling', () => {
  describe('calculateTipSplitByHours', () => {
    it('splits tips proportionally by hours and keeps totals consistent', () => {
      const shares = calculateTipSplitByHours(10000, [
        { id: 'a', name: 'Alice', hours: 5 },
        { id: 'b', name: 'Bob', hours: 3 },
      ]);

      const total = shares.reduce((sum, s) => sum + s.amountCents, 0);
      expect(total).toBe(10000);
      expect(shares.find(s => s.employeeId === 'a')?.amountCents).toBe(6250);
      expect(shares.find(s => s.employeeId === 'b')?.amountCents).toBe(3750);
    });

    it('returns zero shares when total or hours are zero', () => {
      const shares = calculateTipSplitByHours(0, [{ id: 'a', name: 'Alice', hours: 0 }]);
      expect(shares[0].amountCents).toBe(0);
    });
  });

  describe('calculateTipSplitByRole', () => {
    it('uses role weights to allocate tips', () => {
      const shares = calculateTipSplitByRole(9000, [
        { id: 'a', name: 'Alice', role: 'Server', weight: 2 },
        { id: 'b', name: 'Bob', role: 'Bartender', weight: 1 },
      ]);

      expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(9000);
      expect(shares.find(s => s.employeeId === 'a')?.amountCents).toBe(6000);
      expect(shares.find(s => s.employeeId === 'b')?.amountCents).toBe(3000);
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
      expect(rebalanced.find(s => s.employeeId === 'a')?.amountCents).toBe(8000);
      expect(rebalanced.find(s => s.employeeId === 'b')?.amountCents).toBe(2000);
    });
  });

  describe('formatCurrencyFromCents', () => {
    it('formats cents to dollars', () => {
      expect(formatCurrencyFromCents(1234)).toBe('$12.34');
    });
  });

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
  });
});
