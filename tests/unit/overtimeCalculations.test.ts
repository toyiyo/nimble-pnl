import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OVERTIME_RULES,
  calculateDailyOvertime,
  calculateWeeklyOvertime,
  applyOvertimeAdjustments,
  type OvertimeRules,
  type OvertimeResult,
  type OvertimeAdjustment,
} from '@/lib/overtimeCalculations';

describe('overtimeCalculations', () => {
  describe('DEFAULT_OVERTIME_RULES', () => {
    it('has federal FLSA defaults', () => {
      expect(DEFAULT_OVERTIME_RULES).toEqual({
        weeklyThresholdHours: 40,
        weeklyOtMultiplier: 1.5,
        dailyThresholdHours: null,
        dailyOtMultiplier: 1.5,
        dailyDoubleThresholdHours: null,
        dailyDoubleMultiplier: 2.0,
        excludeTipsFromOtRate: true,
      });
    });
  });

  describe('calculateDailyOvertime', () => {
    it('returns all regular hours when no daily threshold is set', () => {
      const result = calculateDailyOvertime(10, null, null);
      expect(result).toEqual({ regularHours: 10, dailyOvertimeHours: 0, doubleTimeHours: 0 });
    });

    it('returns all regular hours when under daily threshold', () => {
      const result = calculateDailyOvertime(7, 8, null);
      expect(result).toEqual({ regularHours: 7, dailyOvertimeHours: 0, doubleTimeHours: 0 });
    });

    it('returns daily OT hours when over daily threshold', () => {
      const result = calculateDailyOvertime(10, 8, null);
      expect(result).toEqual({ regularHours: 8, dailyOvertimeHours: 2, doubleTimeHours: 0 });
    });

    it('returns double-time hours when over double threshold', () => {
      const result = calculateDailyOvertime(13, 8, 12);
      expect(result).toEqual({ regularHours: 8, dailyOvertimeHours: 4, doubleTimeHours: 1 });
    });

    it('handles exactly at daily threshold (no OT)', () => {
      const result = calculateDailyOvertime(8, 8, null);
      expect(result).toEqual({ regularHours: 8, dailyOvertimeHours: 0, doubleTimeHours: 0 });
    });

    it('handles exactly at double-time threshold', () => {
      const result = calculateDailyOvertime(12, 8, 12);
      expect(result).toEqual({ regularHours: 8, dailyOvertimeHours: 4, doubleTimeHours: 0 });
    });

    it('handles zero hours', () => {
      const result = calculateDailyOvertime(0, 8, 12);
      expect(result).toEqual({ regularHours: 0, dailyOvertimeHours: 0, doubleTimeHours: 0 });
    });
  });

  describe('calculateWeeklyOvertime', () => {
    it('calculates weekly OT with federal defaults (40hr/1.5x, no daily)', () => {
      const dailyHours: Record<string, number> = {
        '2026-02-16': 9, '2026-02-17': 9, '2026-02-18': 9,
        '2026-02-19': 9, '2026-02-20': 9,
      };
      const result = calculateWeeklyOvertime(dailyHours, DEFAULT_OVERTIME_RULES);
      expect(result.regularHours).toBe(40);
      expect(result.weeklyOvertimeHours).toBe(5);
      expect(result.dailyOvertimeHours).toBe(0);
      expect(result.doubleTimeHours).toBe(0);
    });

    it('calculates with custom weekly threshold', () => {
      const rules: OvertimeRules = { ...DEFAULT_OVERTIME_RULES, weeklyThresholdHours: 35 };
      const dailyHours: Record<string, number> = {
        '2026-02-16': 8, '2026-02-17': 8, '2026-02-18': 8,
        '2026-02-19': 7, '2026-02-20': 7,
      };
      const result = calculateWeeklyOvertime(dailyHours, rules);
      expect(result.regularHours).toBe(35);
      expect(result.weeklyOvertimeHours).toBe(3);
    });

    it('no OT when under weekly threshold', () => {
      const dailyHours: Record<string, number> = {
        '2026-02-16': 8, '2026-02-17': 8, '2026-02-18': 8,
        '2026-02-19': 8, '2026-02-20': 7,
      };
      const result = calculateWeeklyOvertime(dailyHours, DEFAULT_OVERTIME_RULES);
      expect(result.regularHours).toBe(39);
      expect(result.weeklyOvertimeHours).toBe(0);
    });

    it('no OT when exactly at weekly threshold', () => {
      const dailyHours: Record<string, number> = {
        '2026-02-16': 8, '2026-02-17': 8, '2026-02-18': 8,
        '2026-02-19': 8, '2026-02-20': 8,
      };
      const result = calculateWeeklyOvertime(dailyHours, DEFAULT_OVERTIME_RULES);
      expect(result.regularHours).toBe(40);
      expect(result.weeklyOvertimeHours).toBe(0);
    });

    it('daily OT hours do NOT double-count toward weekly threshold', () => {
      const rules: OvertimeRules = { ...DEFAULT_OVERTIME_RULES, dailyThresholdHours: 8 };
      const dailyHours: Record<string, number> = {
        '2026-02-16': 10, '2026-02-17': 10, '2026-02-18': 10,
        '2026-02-19': 10, '2026-02-20': 10,
      };
      const result = calculateWeeklyOvertime(dailyHours, rules);
      expect(result.regularHours).toBe(40);
      expect(result.dailyOvertimeHours).toBe(10);
      expect(result.weeklyOvertimeHours).toBe(0);
    });

    it('combined daily + weekly OT when both thresholds exceeded', () => {
      const rules: OvertimeRules = { ...DEFAULT_OVERTIME_RULES, dailyThresholdHours: 8 };
      const dailyHours: Record<string, number> = {
        '2026-02-16': 9, '2026-02-17': 9, '2026-02-18': 9,
        '2026-02-19': 9, '2026-02-20': 9, '2026-02-21': 6,
      };
      const result = calculateWeeklyOvertime(dailyHours, rules);
      expect(result.dailyOvertimeHours).toBe(5);
      expect(result.regularHours).toBe(40);
      expect(result.weeklyOvertimeHours).toBe(6);
    });

    it('handles double-time combined with weekly OT', () => {
      const rules: OvertimeRules = {
        ...DEFAULT_OVERTIME_RULES, dailyThresholdHours: 8, dailyDoubleThresholdHours: 12,
      };
      const dailyHours: Record<string, number> = {
        '2026-02-16': 14, '2026-02-17': 8, '2026-02-18': 8,
        '2026-02-19': 8, '2026-02-20': 8,
      };
      const result = calculateWeeklyOvertime(dailyHours, rules);
      expect(result.regularHours).toBe(40);
      expect(result.dailyOvertimeHours).toBe(4);
      expect(result.doubleTimeHours).toBe(2);
      expect(result.weeklyOvertimeHours).toBe(0);
    });

    it('handles empty daily hours', () => {
      const result = calculateWeeklyOvertime({}, DEFAULT_OVERTIME_RULES);
      expect(result.regularHours).toBe(0);
      expect(result.weeklyOvertimeHours).toBe(0);
      expect(result.dailyOvertimeHours).toBe(0);
      expect(result.doubleTimeHours).toBe(0);
    });

    it('handles custom 2.0x weekly multiplier (just verifies hours, not pay)', () => {
      const rules: OvertimeRules = { ...DEFAULT_OVERTIME_RULES, weeklyOtMultiplier: 2.0 };
      const dailyHours: Record<string, number> = {
        '2026-02-16': 10, '2026-02-17': 10, '2026-02-18': 10,
        '2026-02-19': 10, '2026-02-20': 10,
      };
      const result = calculateWeeklyOvertime(dailyHours, rules);
      expect(result.regularHours).toBe(40);
      expect(result.weeklyOvertimeHours).toBe(10);
    });
  });

  describe('applyOvertimeAdjustments', () => {
    it('moves hours from regular to overtime', () => {
      const base: OvertimeResult = { regularHours: 40, weeklyOvertimeHours: 0, dailyOvertimeHours: 0, doubleTimeHours: 0 };
      const adjustments: OvertimeAdjustment[] = [{
        employeeId: 'emp-1', punchDate: '2026-02-16',
        adjustmentType: 'regular_to_overtime', hours: 3, reason: 'Missed clock-out correction',
      }];
      const result = applyOvertimeAdjustments(base, adjustments);
      expect(result.regularHours).toBe(37);
      expect(result.weeklyOvertimeHours).toBe(3);
    });

    it('moves hours from overtime to regular', () => {
      const base: OvertimeResult = { regularHours: 40, weeklyOvertimeHours: 5, dailyOvertimeHours: 0, doubleTimeHours: 0 };
      const adjustments: OvertimeAdjustment[] = [{
        employeeId: 'emp-1', punchDate: '2026-02-16',
        adjustmentType: 'overtime_to_regular', hours: 2, reason: 'Hours were lunch',
      }];
      const result = applyOvertimeAdjustments(base, adjustments);
      expect(result.regularHours).toBe(42);
      expect(result.weeklyOvertimeHours).toBe(3);
    });

    it('caps regular_to_overtime at available regular hours', () => {
      const base: OvertimeResult = { regularHours: 5, weeklyOvertimeHours: 0, dailyOvertimeHours: 0, doubleTimeHours: 0 };
      const adjustments: OvertimeAdjustment[] = [{
        employeeId: 'emp-1', punchDate: '2026-02-16',
        adjustmentType: 'regular_to_overtime', hours: 10, reason: 'Test cap',
      }];
      const result = applyOvertimeAdjustments(base, adjustments);
      expect(result.regularHours).toBe(0);
      expect(result.weeklyOvertimeHours).toBe(5);
    });

    it('caps overtime_to_regular at available weekly OT hours', () => {
      const base: OvertimeResult = { regularHours: 40, weeklyOvertimeHours: 3, dailyOvertimeHours: 0, doubleTimeHours: 0 };
      const adjustments: OvertimeAdjustment[] = [{
        employeeId: 'emp-1', punchDate: '2026-02-16',
        adjustmentType: 'overtime_to_regular', hours: 10, reason: 'Test cap',
      }];
      const result = applyOvertimeAdjustments(base, adjustments);
      expect(result.regularHours).toBe(43);
      expect(result.weeklyOvertimeHours).toBe(0);
    });

    it('applies multiple adjustments sequentially', () => {
      const base: OvertimeResult = { regularHours: 40, weeklyOvertimeHours: 5, dailyOvertimeHours: 0, doubleTimeHours: 0 };
      const adjustments: OvertimeAdjustment[] = [
        { employeeId: 'emp-1', punchDate: '2026-02-16', adjustmentType: 'overtime_to_regular', hours: 2, reason: 'a' },
        { employeeId: 'emp-1', punchDate: '2026-02-17', adjustmentType: 'regular_to_overtime', hours: 1, reason: 'b' },
      ];
      const result = applyOvertimeAdjustments(base, adjustments);
      expect(result.regularHours).toBe(41);
      expect(result.weeklyOvertimeHours).toBe(4);
    });

    it('returns unchanged result when no adjustments', () => {
      const base: OvertimeResult = { regularHours: 40, weeklyOvertimeHours: 5, dailyOvertimeHours: 2, doubleTimeHours: 1 };
      const result = applyOvertimeAdjustments(base, []);
      expect(result).toEqual(base);
    });
  });
});
