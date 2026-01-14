import { describe, it, expect } from 'vitest';
import {
  calculateDailyRateFromWeekly,
  calculateDailyRatePay,
  calculateDailyLaborCost,
  validateCompensationFields,
  formatCompensationType,
} from '@/utils/compensationCalculations';
import type { Employee } from '@/types/scheduling';

describe('Daily Rate Compensation', () => {
  describe('calculateDailyRateFromWeekly', () => {
    it('calculates correct daily rate from weekly amount', () => {
      // $1000 / 6 days = $166.67
      expect(calculateDailyRateFromWeekly(100000, 6)).toBe(16667);
    });

    it('handles 5-day week', () => {
      // $1000 / 5 days = $200.00
      expect(calculateDailyRateFromWeekly(100000, 5)).toBe(20000);
    });

    it('handles 7-day week', () => {
      // $1000 / 7 days = $142.86
      expect(calculateDailyRateFromWeekly(100000, 7)).toBe(14286);
    });

    it('throws error for zero days', () => {
      expect(() => calculateDailyRateFromWeekly(100000, 0)).toThrow(
        'Standard days must be greater than 0'
      );
    });

    it('throws error for negative days', () => {
      expect(() => calculateDailyRateFromWeekly(100000, -1)).toThrow();
    });

    it('rounds to nearest cent', () => {
      // $100 / 3 days = $33.33 (not $33.333...)
      expect(calculateDailyRateFromWeekly(10000, 3)).toBe(3333);
    });

    it('handles large amounts', () => {
      // $10,000 / 6 days = $1,666.67
      expect(calculateDailyRateFromWeekly(1000000, 6)).toBe(166667);
    });
  });

  describe('calculateDailyRatePay', () => {
    const mockEmployee: Partial<Employee> = {
      id: 'test-emp',
      compensation_type: 'daily_rate',
      daily_rate_amount: 16667, // $166.67
      daily_rate_reference_weekly: 100000,
      daily_rate_reference_days: 6,
    };

    it('calculates pay for zero days', () => {
      expect(calculateDailyRatePay(mockEmployee as Employee, 0)).toBe(0);
    });

    it('calculates pay for 1 day', () => {
      // 1 × $166.67 = $166.67
      expect(calculateDailyRatePay(mockEmployee as Employee, 1)).toBe(16667);
    });

    it('calculates pay for 3 days', () => {
      // 3 × $166.67 = $500.01
      expect(calculateDailyRatePay(mockEmployee as Employee, 3)).toBe(50001);
    });

    it('calculates pay for 6 days (reference amount)', () => {
      // 6 × $166.67 = $1000.02
      expect(calculateDailyRatePay(mockEmployee as Employee, 6)).toBe(100002);
    });

    it('calculates pay for 7 days (more than reference)', () => {
      // 7 × $166.67 = $1166.69
      expect(calculateDailyRatePay(mockEmployee as Employee, 7)).toBe(116669);
    });

    it('throws error if daily_rate_amount is missing', () => {
      const invalidEmployee = { ...mockEmployee, daily_rate_amount: undefined };
      expect(() => calculateDailyRatePay(invalidEmployee as Employee, 3)).toThrow(
        'Daily rate amount required'
      );
    });

    it('handles fractional days (rounds correctly)', () => {
      // 2.5 days × $166.67 = $416.675 → rounds to $416.68 (41668 cents)
      expect(calculateDailyRatePay(mockEmployee as Employee, 2.5)).toBe(41668);
    });
  });

  describe('calculateDailyLaborCost', () => {
    it('returns daily rate amount (hours irrelevant)', () => {
      const employee: Partial<Employee> = {
        compensation_type: 'daily_rate',
        daily_rate_amount: 16667,
      };

      // Hours don't matter for daily rate
      expect(calculateDailyLaborCost(employee as Employee)).toBe(16667);
      expect(calculateDailyLaborCost(employee as Employee, 8)).toBe(16667);
      expect(calculateDailyLaborCost(employee as Employee, 12)).toBe(16667);
      expect(calculateDailyLaborCost(employee as Employee, 0)).toBe(16667);
    });

    it('throws error if daily_rate_amount is missing', () => {
      const employee: Partial<Employee> = {
        compensation_type: 'daily_rate',
      };

      expect(() => calculateDailyLaborCost(employee as Employee)).toThrow(
        'Daily rate amount required for daily rate employees'
      );
    });
  });

  describe('validateCompensationFields', () => {
    it('accepts valid daily_rate employee', () => {
      const employee: Partial<Employee> = {
        compensation_type: 'daily_rate',
        daily_rate_amount: 16667,
        daily_rate_reference_weekly: 100000,
        daily_rate_reference_days: 6,
      };

      const errors = validateCompensationFields(employee);
      expect(errors).toEqual([]);
    });

    it('rejects daily_rate without daily_rate_amount', () => {
      const employee: Partial<Employee> = {
        compensation_type: 'daily_rate',
        daily_rate_reference_weekly: 100000,
        daily_rate_reference_days: 6,
      };

      const errors = validateCompensationFields(employee);
      expect(errors).toContain('Daily rate amount must be greater than 0');
    });

    it('rejects daily_rate without reference weekly', () => {
      const employee: Partial<Employee> = {
        compensation_type: 'daily_rate',
        daily_rate_amount: 16667,
        daily_rate_reference_days: 6,
      };

      const errors = validateCompensationFields(employee);
      expect(errors).toContain('Weekly reference amount must be greater than 0');
    });

    it('rejects daily_rate without reference days', () => {
      const employee: Partial<Employee> = {
        compensation_type: 'daily_rate',
        daily_rate_amount: 16667,
        daily_rate_reference_weekly: 100000,
      };

      const errors = validateCompensationFields(employee);
      expect(errors).toContain('Standard work days must be greater than 0');
    });

    it('rejects daily_rate with zero amount', () => {
      const employee: Partial<Employee> = {
        compensation_type: 'daily_rate',
        daily_rate_amount: 0,
        daily_rate_reference_weekly: 100000,
        daily_rate_reference_days: 6,
      };

      const errors = validateCompensationFields(employee);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects daily_rate with negative days', () => {
      const employee: Partial<Employee> = {
        compensation_type: 'daily_rate',
        daily_rate_amount: 16667,
        daily_rate_reference_weekly: 100000,
        daily_rate_reference_days: -1,
      };

      const errors = validateCompensationFields(employee);
      expect(errors).toContain('Standard work days must be greater than 0');
    });
  });

  describe('formatCompensationType', () => {
    it('formats daily_rate correctly', () => {
      expect(formatCompensationType('daily_rate')).toBe('Per Day Worked');
    });

    it('still formats other types correctly', () => {
      expect(formatCompensationType('hourly')).toBe('Hourly');
      expect(formatCompensationType('salary')).toBe('Salaried');
      expect(formatCompensationType('contractor')).toBe('Contractor');
    });
  });

  describe('Edge Cases', () => {
    it('CRITICAL: Zero days worked = $0 pay', () => {
      const employee: Partial<Employee> = {
        compensation_type: 'daily_rate',
        daily_rate_amount: 16667,
      };
      expect(calculateDailyRatePay(employee as Employee, 0)).toBe(0);
    });

    it('CRITICAL: 7 days worked exceeds weekly reference', () => {
      const employee: Partial<Employee> = {
        compensation_type: 'daily_rate',
        daily_rate_amount: 16667, // $1000/6 = $166.67
        daily_rate_reference_weekly: 100000, // $1000
      };

      const pay = calculateDailyRatePay(employee as Employee, 7);
      expect(pay).toBeGreaterThan(100000); // More than $1000
      expect(pay).toBe(116669); // Exactly $1166.69
    });

    it('handles fractional cents correctly', () => {
      // $100.01 / 3 days = $33.34 (rounded)
      expect(calculateDailyRateFromWeekly(10001, 3)).toBe(3334);
    });

    it('handles very small amounts', () => {
      // $10 / 6 days = $1.67
      expect(calculateDailyRateFromWeekly(1000, 6)).toBe(167);
    });

    it('daily labor cost ignores hours completely', () => {
      const employee: Partial<Employee> = {
        compensation_type: 'daily_rate',
        daily_rate_amount: 20000, // $200/day
      };

      // 1 hour or 16 hours - same cost
      expect(calculateDailyLaborCost(employee as Employee, 1)).toBe(20000);
      expect(calculateDailyLaborCost(employee as Employee, 16)).toBe(20000);
    });
  });

  describe('Real-World Scenarios', () => {
    it('Kitchen manager: $1000/week, 6 days, works 4 days', () => {
      const weeklyAmount = 100000; // $1000
      const standardDays = 6;
      const workedDays = 4;

      const dailyRate = calculateDailyRateFromWeekly(weeklyAmount, standardDays);
      expect(dailyRate).toBe(16667); // $166.67

      const employee: Partial<Employee> = {
        compensation_type: 'daily_rate',
        daily_rate_amount: dailyRate,
      };

      const pay = calculateDailyRatePay(employee as Employee, workedDays);
      expect(pay).toBe(66668); // $666.68
    });

    it('Manager: $1200/week, 5 days, works full week', () => {
      const weeklyAmount = 120000; // $1200
      const standardDays = 5;
      const workedDays = 5;

      const dailyRate = calculateDailyRateFromWeekly(weeklyAmount, standardDays);
      expect(dailyRate).toBe(24000); // $240.00

      const employee: Partial<Employee> = {
        compensation_type: 'daily_rate',
        daily_rate_amount: dailyRate,
      };

      const pay = calculateDailyRatePay(employee as Employee, workedDays);
      expect(pay).toBe(120000); // Exactly $1200
    });

    it('Part-time: $600/week, 3 days, works 2 days', () => {
      const weeklyAmount = 60000; // $600
      const standardDays = 3;
      const workedDays = 2;

      const dailyRate = calculateDailyRateFromWeekly(weeklyAmount, standardDays);
      expect(dailyRate).toBe(20000); // $200.00

      const employee: Partial<Employee> = {
        compensation_type: 'daily_rate',
        daily_rate_amount: dailyRate,
      };

      const pay = calculateDailyRatePay(employee as Employee, workedDays);
      expect(pay).toBe(40000); // $400.00
    });
  });
});
