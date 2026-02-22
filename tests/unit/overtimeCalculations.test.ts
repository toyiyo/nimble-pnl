import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OVERTIME_RULES,
  calculateDailyOvertime,
  type OvertimeRules,
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
});
