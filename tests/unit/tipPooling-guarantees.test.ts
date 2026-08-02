import { describe, it, expect } from 'vitest';
import {
  calculateTipSplitWithGuarantees,
  calculateTipSplitByHours,
  calculateTipSplitEven,
  rebalanceAllocations,
  type GuaranteedParticipant,
  type RoleAllocationRule,
  type TipShare,
} from '@/utils/tipPooling';

const byHours = (poolCents: number, subset: GuaranteedParticipant[]): TipShare[] =>
  calculateTipSplitByHours(
    poolCents,
    subset.map(p => ({ id: p.id, name: p.name, hours: p.hours ?? 0 })),
  );

const evenly = (poolCents: number, subset: GuaranteedParticipant[]): TipShare[] =>
  calculateTipSplitEven(poolCents, subset.map(p => ({ id: p.id, name: p.name })));

const atLeast = (percentage: number): RoleAllocationRule => ({ mode: 'at_least', percentage });
const exactly = (percentage: number): RoleAllocationRule => ({ mode: 'exactly', percentage });

const person = (
  id: string,
  hours: number,
  rule?: RoleAllocationRule,
): GuaranteedParticipant => ({ id, name: `Person ${id}`, hours, role: 'Server', rule });

const amountOf = (result: { shares: TipShare[] }, id: string) =>
  result.shares.find(s => s.employeeId === id)?.amountCents;

const sumOf = (result: { shares: TipShare[] }) =>
  result.shares.reduce((sum, s) => sum + s.amountCents, 0);

describe('calculateTipSplitWithGuarantees', () => {
  describe('pass-through behaviour', () => {
    it('matches the plain hours split when no rules are configured', () => {
      const participants = [person('a', 6), person('b', 4)];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(result.shares.map(s => s.amountCents)).toEqual([6000, 4000]);
      expect(result.scaledDownFactor).toBeNull();
      expect(result.redistributedLeftoverCents).toBe(0);
    });

    it('treats a 0% rule as no rule', () => {
      const participants = [person('a', 6, atLeast(0)), person('b', 4)];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(result.shares.map(s => s.amountCents)).toEqual([6000, 4000]);
    });

    it('returns an empty array for no participants', () => {
      const result = calculateTipSplitWithGuarantees(10000, [], byHours);
      expect(result.shares).toEqual([]);
    });

    it('allocates zero to everyone when the pool is zero', () => {
      const participants = [person('a', 6, atLeast(10)), person('b', 4)];
      const result = calculateTipSplitWithGuarantees(0, participants, byHours);

      expect(result.shares.map(s => s.amountCents)).toEqual([0, 0]);
    });

    it('allocates zero to everyone when the pool is negative', () => {
      const participants = [person('a', 6, atLeast(10))];
      const result = calculateTipSplitWithGuarantees(-500, participants, byHours);

      expect(result.shares.map(s => s.amountCents)).toEqual([0]);
    });

    it('preserves participant order', () => {
      const participants = [person('a', 1), person('b', 9, atLeast(50)), person('c', 2)];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(result.shares.map(s => s.employeeId)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('at_least floors', () => {
    it('lifts a participant whose hours share falls below the floor', () => {
      // 2h of 12h = 16.6% without the rule; the 30% floor lifts them.
      const participants = [person('mgr', 2, atLeast(30)), person('a', 5), person('b', 5)];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(amountOf(result, 'mgr')).toBe(3000);
      expect(amountOf(result, 'a')).toBe(3500);
      expect(amountOf(result, 'b')).toBe(3500);
      expect(sumOf(result)).toBe(10000);
    });

    it('marks a lifted participant', () => {
      const participants = [person('mgr', 2, atLeast(30)), person('a', 10)];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(result.shares.find(s => s.employeeId === 'mgr')?.lifted).toBe(true);
      expect(result.shares.find(s => s.employeeId === 'a')?.lifted).toBeUndefined();
    });

    it('does not cap someone already above their floor', () => {
      // 10h of 12h = 83.3%, well above the 30% floor.
      const participants = [person('mgr', 10, atLeast(30)), person('a', 2)];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(amountOf(result, 'mgr')).toBe(8333);
      expect(result.shares.find(s => s.employeeId === 'mgr')?.lifted).toBeUndefined();
    });

    it('gives the whole pool to a lone at_least participant', () => {
      const participants = [person('mgr', 3, atLeast(10))];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(amountOf(result, 'mgr')).toBe(10000);
    });

    it('applies the floor per person, not per role', () => {
      // Two managers at 10% each commit 20% of the pool.
      const participants = [
        person('mgr1', 1, atLeast(10)),
        person('mgr2', 1, atLeast(10)),
        person('a', 18),
      ];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(amountOf(result, 'mgr1')).toBe(1000);
      expect(amountOf(result, 'mgr2')).toBe(1000);
      expect(amountOf(result, 'a')).toBe(8000);
      expect(sumOf(result)).toBe(10000);
    });

    it('lifts iteratively when locking one floor pushes another below its own', () => {
      // Pool 10000. c has a 40% floor; a has a 30% floor.
      // Pass 1 by hours (1/1/8): a=1000 (<3000), c=8000 (ok) -> lock a at 3000.
      // Pass 2 over b,c with 7000 (1/8): b=778, c=6222 -> stable.
      const participants = [person('a', 1, atLeast(30)), person('b', 1), person('c', 8, atLeast(40))];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(amountOf(result, 'a')).toBe(3000);
      expect(amountOf(result, 'c')).toBeGreaterThanOrEqual(4000);
      expect(sumOf(result)).toBe(10000);
    });

    it('falls back to an even remainder split when nobody logged hours', () => {
      const participants = [person('mgr', 0, atLeast(50)), person('a', 0), person('b', 0)];
      const result = calculateTipSplitWithGuarantees(9000, participants, byHours);

      expect(amountOf(result, 'mgr')).toBe(4500);
      expect(sumOf(result)).toBe(9000);
    });
  });

  describe('exactly shares', () => {
    it('reserves the fixed share off the top', () => {
      const participants = [person('mgr', 1, exactly(20)), person('a', 5), person('b', 5)];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(amountOf(result, 'mgr')).toBe(2000);
      expect(amountOf(result, 'a')).toBe(4000);
      expect(amountOf(result, 'b')).toBe(4000);
      expect(sumOf(result)).toBe(10000);
    });

    it('caps an exactly participant even when their hours would earn more', () => {
      const participants = [person('mgr', 20, exactly(20)), person('a', 1)];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(amountOf(result, 'mgr')).toBe(2000);
      expect(amountOf(result, 'a')).toBe(8000);
    });

    it('mixes exactly and at_least in one split', () => {
      const participants = [
        person('fixed', 10, exactly(20)),
        person('floor', 1, atLeast(30)),
        person('hourly', 9),
      ];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(amountOf(result, 'fixed')).toBe(2000);
      expect(amountOf(result, 'floor')).toBe(3000);
      expect(amountOf(result, 'hourly')).toBe(5000);
      expect(sumOf(result)).toBe(10000);
    });

    it('redistributes the leftover when only exactly participants worked', () => {
      const participants = [person('a', 5, exactly(30)), person('b', 5, exactly(20))];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(result.redistributedLeftoverCents).toBe(5000);
      // 5000 leftover split 30:20 -> 3000 / 2000 on top of 3000 / 2000.
      expect(amountOf(result, 'a')).toBe(6000);
      expect(amountOf(result, 'b')).toBe(4000);
      expect(sumOf(result)).toBe(10000);
    });

    it('leaves no leftover when exactly shares total 100%', () => {
      const participants = [person('a', 5, exactly(60)), person('b', 5, exactly(40))];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(result.redistributedLeftoverCents).toBe(0);
      expect(amountOf(result, 'a')).toBe(6000);
      expect(amountOf(result, 'b')).toBe(4000);
    });
  });

  describe('overshoot', () => {
    it('scales guarantees down proportionally when they exceed the pool', () => {
      const participants = [
        person('a', 1, exactly(60)),
        person('b', 1, exactly(60)),
      ];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(result.scaledDownFactor).toBeCloseTo(10000 / 12000, 6);
      expect(amountOf(result, 'a')).toBe(5000);
      expect(amountOf(result, 'b')).toBe(5000);
      expect(sumOf(result)).toBe(10000);
    });

    it('reports no scaling when guarantees total exactly 100%', () => {
      const participants = [person('a', 1, atLeast(50)), person('b', 1, atLeast(50))];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(result.scaledDownFactor).toBeNull();
      expect(sumOf(result)).toBe(10000);
    });
  });

  describe('provenance', () => {
    it('attaches the applied rule to the share', () => {
      const participants = [person('mgr', 1, atLeast(30)), person('a', 9)];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(result.shares.find(s => s.employeeId === 'mgr')?.appliedRule).toEqual({
        mode: 'at_least',
        percentage: 30,
      });
      expect(result.shares.find(s => s.employeeId === 'a')?.appliedRule).toBeUndefined();
    });

    it('survives a manual override through rebalanceAllocations', () => {
      const participants = [person('mgr', 1, atLeast(30)), person('a', 9)];
      const { shares } = calculateTipSplitWithGuarantees(10000, participants, byHours);
      const rebalanced = rebalanceAllocations(10000, shares, 'a', 8000);

      expect(rebalanced.find(s => s.employeeId === 'mgr')?.appliedRule).toEqual({
        mode: 'at_least',
        percentage: 30,
      });
    });
  });

  describe('cent exactness', () => {
    it('allocates every cent across an awkward participant count', () => {
      const participants = [
        person('a', 1, atLeast(11)),
        person('b', 1),
        person('c', 1),
        person('d', 1, exactly(7)),
        person('e', 1),
        person('f', 1),
        person('g', 1),
      ];
      const result = calculateTipSplitWithGuarantees(10001, participants, byHours);

      expect(sumOf(result)).toBe(10001);
      expect(result.shares.every(s => s.amountCents >= 0)).toBe(true);
    });

    it('allocates every cent with an even remainder splitter', () => {
      const participants = [person('a', 0, atLeast(33)), person('b', 0), person('c', 0)];
      const result = calculateTipSplitWithGuarantees(10001, participants, evenly);

      expect(sumOf(result)).toBe(10001);
    });

    // The residual reconciliation spills a negative residual across candidates
    // rather than clamping it at zero, so both invariants have to survive every
    // shape at once: shares sum to the pool exactly (Approve is gated on it) and
    // nobody is shown a negative payout.
    it('never produces a negative share and always sums exactly, across awkward pools and rule mixes', () => {
      const rules: Array<RoleAllocationRule | undefined> = [
        undefined,
        atLeast(0),
        atLeast(1),
        atLeast(60),
        exactly(0),
        exactly(1),
        exactly(99),
      ];
      const pools = [0, 1, 2, 3, 7, 99, 101, 10001];
      const hourSets = [
        [0, 0, 0],
        [0, 1, 0],
        [1, 1, 1],
        [7, 0, 3],
      ];

      for (const pool of pools) {
        for (const hours of hourSets) {
          for (const ruleA of rules) {
            for (const ruleB of rules) {
              const participants = [
                person('a', hours[0], ruleA),
                person('b', hours[1], ruleB),
                person('c', hours[2]),
              ];
              for (const splitter of [byHours, evenly]) {
                const result = calculateTipSplitWithGuarantees(pool, participants, splitter);
                const context = `pool=${pool} hours=${hours} a=${ruleA?.mode ?? 'none'}:${
                  ruleA?.percentage ?? '-'
                } b=${ruleB?.mode ?? 'none'}:${ruleB?.percentage ?? '-'}`;

                expect(sumOf(result), context).toBe(pool);
                expect(
                  result.shares.every(s => s.amountCents >= 0),
                  `${context} produced a negative share`,
                ).toBe(true);
                expect(result.shares).toHaveLength(3);
              }
            }
          }
        }
      }
    });
  });
});
