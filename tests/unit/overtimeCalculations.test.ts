import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OVERTIME_RULES,
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
});
