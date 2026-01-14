import { describe, it, expect } from 'vitest';
import { calculateEmployeePay } from '@/utils/payrollCalculations';
import type { Employee } from '@/types/scheduling';
import type { TimePunch } from '@/types/timeTracking';

describe('Payroll Calculations - Daily Rate', () => {
  const mockDailyRateEmployee: Employee = {
    id: 'emp-1',
    restaurant_id: 'rest-1',
    name: 'John Martinez',
    position: 'Kitchen Manager',
    status: 'active',
    compensation_type: 'daily_rate',
    hourly_rate: 0,
    daily_rate_amount: 16667, // $166.67
    daily_rate_reference_weekly: 100000, // $1000
    daily_rate_reference_days: 6,
    is_active: true,
    hire_date: '2024-01-01',
    tip_eligible: true,
  };

  const periodStartDate = new Date('2024-01-01');
  const periodEndDate = new Date('2024-01-07');

  describe('calculateEmployeePay - daily_rate', () => {
    it('calculates pay based on unique days with punches', () => {
      const punches: TimePunch[] = [
        {
          id: 'punch-1',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-01T09:00:00',
          punch_type: 'clock_in',
        },
        {
          id: 'punch-2',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-01T17:00:00',
          punch_type: 'clock_out',
        },
        {
          id: 'punch-3',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-02T09:00:00',
          punch_type: 'clock_in',
        },
        {
          id: 'punch-4',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-02T17:00:00',
          punch_type: 'clock_out',
        },
        {
          id: 'punch-5',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-03T09:00:00',
          punch_type: 'clock_in',
        },
        {
          id: 'punch-6',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-03T17:00:00',
          punch_type: 'clock_out',
        },
      ];

      const result = calculateEmployeePay(
        mockDailyRateEmployee,
        punches,
        0, // tips
        periodStartDate,
        periodEndDate
      );

      // 3 days × $166.67 = $500.01
      expect(result.compensationType).toBe('daily_rate');
      expect(result.daysWorked).toBe(3);
      expect(result.dailyRatePay).toBe(50001); // cents
      expect(result.grossPay).toBe(50001);
      expect(result.regularPay).toBe(0); // Not hourly
      expect(result.overtimePay).toBe(0); // Not hourly
      expect(result.salaryPay).toBe(0); // Not salary
    });

    it('CRITICAL: pays for days regardless of hours worked', () => {
      const punches: TimePunch[] = [
        // Day 1: Normal 8 hours
        {
          id: 'punch-1',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-01T09:00:00',
          punch_type: 'clock_in',
        },
        {
          id: 'punch-2',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-01T17:00:00',
          punch_type: 'clock_out',
        },
        // Day 2: Only 2 hours!
        {
          id: 'punch-3',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-02T09:00:00',
          punch_type: 'clock_in',
        },
        {
          id: 'punch-4',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-02T11:00:00',
          punch_type: 'clock_out',
        },
        // Day 3: Long 16 hours!
        {
          id: 'punch-5',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-03T06:00:00',
          punch_type: 'clock_in',
        },
        {
          id: 'punch-6',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-03T22:00:00',
          punch_type: 'clock_out',
        },
      ];

      const result = calculateEmployeePay(
        mockDailyRateEmployee,
        punches,
        0,
        periodStartDate,
        periodEndDate
      );

      // All 3 days should pay the same: 3 × $166.67 = $500.01
      expect(result.daysWorked).toBe(3);
      expect(result.dailyRatePay).toBe(50001); // cents
      expect(result.grossPay).toBe(50001);
    });

    it('handles multiple punches on same day (split shift)', () => {
      const punches: TimePunch[] = [
        // Morning shift
        {
          id: 'punch-1',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-01T06:00:00',
          punch_type: 'clock_in',
        },
        {
          id: 'punch-2',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-01T10:00:00',
          punch_type: 'clock_out',
        },
        // Evening shift (same day)
        {
          id: 'punch-3',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-01T17:00:00',
          punch_type: 'clock_in',
        },
        {
          id: 'punch-4',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-01T21:00:00',
          punch_type: 'clock_out',
        },
      ];

      const result = calculateEmployeePay(
        mockDailyRateEmployee,
        punches,
        0,
        periodStartDate,
        periodEndDate
      );

      // Should count as 1 day: $166.67
      expect(result.daysWorked).toBe(1);
      expect(result.dailyRatePay).toBe(16667); // cents
      expect(result.grossPay).toBe(16667);
    });

    it('returns zero pay when no punches', () => {
      const result = calculateEmployeePay(
        mockDailyRateEmployee,
        [],
        0,
        periodStartDate,
        periodEndDate
      );

      expect(result.daysWorked).toBe(0);
      expect(result.dailyRatePay).toBe(0);
      expect(result.grossPay).toBe(0);
    });

    it('only counts punches within the period', () => {
      const punches: TimePunch[] = [
        // Before period (Dec 31)
        {
          id: 'punch-1',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2023-12-31T09:00:00',
          punch_type: 'clock_in',
        },
        {
          id: 'punch-2',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2023-12-31T17:00:00',
          punch_type: 'clock_out',
        },
        // Within period (Jan 1)
        {
          id: 'punch-3',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-01T09:00:00',
          punch_type: 'clock_in',
        },
        {
          id: 'punch-4',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-01T17:00:00',
          punch_type: 'clock_out',
        },
        // Within period (Jan 2)
        {
          id: 'punch-5',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-02T09:00:00',
          punch_type: 'clock_in',
        },
        {
          id: 'punch-6',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-02T17:00:00',
          punch_type: 'clock_out',
        },
        // After period (Jan 8)
        {
          id: 'punch-7',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-08T09:00:00',
          punch_type: 'clock_in',
        },
        {
          id: 'punch-8',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-08T17:00:00',
          punch_type: 'clock_out',
        },
      ];

      const result = calculateEmployeePay(
        mockDailyRateEmployee,
        punches,
        0,
        periodStartDate,
        periodEndDate
      );

      // Should only count Jan 1 and Jan 2: 2 × $166.67 = $333.34
      expect(result.daysWorked).toBe(2);
      expect(result.dailyRatePay).toBe(33334); // cents
      expect(result.grossPay).toBe(33334);
    });

    it('includes tips in total pay', () => {
      const punches: TimePunch[] = [
        {
          id: 'punch-1',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-01T09:00:00',
          punch_type: 'clock_in',
        },
        {
          id: 'punch-2',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-01T17:00:00',
          punch_type: 'clock_out',
        },
      ];

      const tips = 5000; // $50 in tips

      const result = calculateEmployeePay(
        mockDailyRateEmployee,
        punches,
        tips,
        periodStartDate,
        periodEndDate
      );

      // 1 day × $166.67 = $166.67 + $50 tips = $216.67
      expect(result.dailyRatePay).toBe(16667);
      expect(result.totalTips).toBe(5000);
      expect(result.grossPay).toBe(16667); // Doesn't include tips
      expect(result.totalPay).toBe(21667); // Includes tips
    });

    it('handles different daily rates correctly', () => {
      const employee: Employee = {
        ...mockDailyRateEmployee,
        daily_rate_amount: 20000, // $200/day
        daily_rate_reference_weekly: 120000, // $1200
        daily_rate_reference_days: 6,
      };

      const punches: TimePunch[] = [
        {
          id: 'punch-1',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-01T09:00:00',
          punch_type: 'clock_in',
        },
        {
          id: 'punch-2',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-01T17:00:00',
          punch_type: 'clock_out',
        },
        {
          id: 'punch-3',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-02T09:00:00',
          punch_type: 'clock_in',
        },
        {
          id: 'punch-4',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-02T17:00:00',
          punch_type: 'clock_out',
        },
      ];

      const result = calculateEmployeePay(
        employee,
        punches,
        0,
        periodStartDate,
        periodEndDate
      );

      // 2 days × $200 = $400
      expect(result.daysWorked).toBe(2);
      expect(result.dailyRatePay).toBe(40000); // cents
      expect(result.grossPay).toBe(40000);
    });

    it('handles full week worked (6 days)', () => {
      const punches: TimePunch[] = [
        // Monday
        {
          id: 'punch-1',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-01T09:00:00',
          punch_type: 'clock_in',
        },
        {
          id: 'punch-2',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-01T17:00:00',
          punch_type: 'clock_out',
        },
        // Tuesday
        {
          id: 'punch-3',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-02T09:00:00',
          punch_type: 'clock_in',
        },
        {
          id: 'punch-4',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-02T17:00:00',
          punch_type: 'clock_out',
        },
        // Wednesday
        {
          id: 'punch-5',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-03T09:00:00',
          punch_type: 'clock_in',
        },
        {
          id: 'punch-6',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-03T17:00:00',
          punch_type: 'clock_out',
        },
        // Thursday
        {
          id: 'punch-7',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-04T09:00:00',
          punch_type: 'clock_in',
        },
        {
          id: 'punch-8',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-04T17:00:00',
          punch_type: 'clock_out',
        },
        // Friday
        {
          id: 'punch-9',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-05T09:00:00',
          punch_type: 'clock_in',
        },
        {
          id: 'punch-10',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-05T17:00:00',
          punch_type: 'clock_out',
        },
        // Saturday
        {
          id: 'punch-11',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-06T09:00:00',
          punch_type: 'clock_in',
        },
        {
          id: 'punch-12',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-06T17:00:00',
          punch_type: 'clock_out',
        },
      ];

      const result = calculateEmployeePay(
        mockDailyRateEmployee,
        punches,
        0,
        periodStartDate,
        periodEndDate
      );

      // 6 days × $166.67 = $1000.02 (should match reference weekly amount)
      expect(result.daysWorked).toBe(6);
      expect(result.dailyRatePay).toBe(100002); // cents
      expect(result.grossPay).toBe(100002);
    });

    it('CRITICAL: handles 7 days worked (exceeds reference)', () => {
      const punches: TimePunch[] = Array.from({ length: 7 }, (_, i) => [
        {
          id: `punch-in-${i}`,
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: new Date(2024, 0, i + 1, 9, 0).toISOString(),
          punch_type: 'clock_in' as const,
        },
        {
          id: `punch-out-${i}`,
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: new Date(2024, 0, i + 1, 17, 0).toISOString(),
          punch_type: 'clock_out' as const,
        },
      ]).flat();

      const result = calculateEmployeePay(
        mockDailyRateEmployee,
        punches,
        0,
        periodStartDate,
        periodEndDate
      );

      // 7 days × $166.67 = $1166.69 (exceeds weekly reference of $1000!)
      expect(result.daysWorked).toBe(7);
      expect(result.dailyRatePay).toBe(116669); // cents
      expect(result.grossPay).toBe(116669);
      expect(result.grossPay).toBeGreaterThan(100000); // More than reference
    });

    it('returns correct structure for daily_rate employee', () => {
      const punches: TimePunch[] = [
        {
          id: 'punch-1',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-01T09:00:00',
          punch_type: 'clock_in',
        },
        {
          id: 'punch-2',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-01T17:00:00',
          punch_type: 'clock_out',
        },
      ];

      const result = calculateEmployeePay(
        mockDailyRateEmployee,
        punches,
        0,
        periodStartDate,
        periodEndDate
      );

      // Check all fields are present and correct type
      expect(result.employeeId).toBe('emp-1');
      expect(result.employeeName).toBe('John Martinez');
      expect(result.position).toBe('Kitchen Manager');
      expect(result.compensationType).toBe('daily_rate');
      expect(result.hourlyRate).toBe(0);
      expect(result.regularHours).toBe(0);
      expect(result.overtimeHours).toBe(0);
      expect(result.regularPay).toBe(0);
      expect(result.overtimePay).toBe(0);
      expect(result.salaryPay).toBe(0);
      expect(result.contractorPay).toBe(0);
      expect(result.dailyRatePay).toBe(16667);
      expect(result.daysWorked).toBe(1);
      expect(typeof result.manualPaymentsTotal).toBe('number');
      expect(typeof result.grossPay).toBe('number');
      expect(typeof result.totalPay).toBe('number');
    });
  });
});
