import { describe, it, expect } from 'vitest';
import {
  calculateScheduledLaborCost,
  calculateActualLaborCost,
  calculateEmployeeDailyCost,
  isEmployeeCompensationValid,
  getEmployeeDailyRateDescription,
} from '@/services/laborCalculations';
import type { Employee, Shift } from '@/types/scheduling';
import type { TimePunch } from '@/types/timeTracking';

describe('Labor Calculations - Daily Rate', () => {
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

  describe('calculateEmployeeDailyCost', () => {
    it('returns daily rate amount for daily_rate employee', () => {
      const cost = calculateEmployeeDailyCost(mockDailyRateEmployee);
      expect(cost).toBe(16667); // cents
    });

    it('returns 0 if daily_rate_amount is missing', () => {
      const employee = { ...mockDailyRateEmployee, daily_rate_amount: undefined };
      const cost = calculateEmployeeDailyCost(employee);
      expect(cost).toBe(0);
    });

    it('returns 0 if daily_rate_amount is 0', () => {
      const employee = { ...mockDailyRateEmployee, daily_rate_amount: 0 };
      const cost = calculateEmployeeDailyCost(employee);
      expect(cost).toBe(0);
    });

    it('ignores hours parameter for daily_rate employees', () => {
      const cost1 = calculateEmployeeDailyCost(mockDailyRateEmployee, 1);
      const cost2 = calculateEmployeeDailyCost(mockDailyRateEmployee, 8);
      const cost3 = calculateEmployeeDailyCost(mockDailyRateEmployee, 16);
      
      expect(cost1).toBe(16667);
      expect(cost2).toBe(16667);
      expect(cost3).toBe(16667);
      expect(cost1).toBe(cost2);
      expect(cost2).toBe(cost3);
    });
  });

  describe('calculateScheduledLaborCost', () => {
    const startDate = new Date('2024-01-01');
    const endDate = new Date('2024-01-07');

    it('calculates cost for daily_rate employee with scheduled shifts', () => {
      const shifts: Shift[] = [
        {
          id: 'shift-1',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          start_time: '2024-01-01T09:00:00',
          end_time: '2024-01-01T17:00:00',
          break_duration: 30,
          position: 'Kitchen Manager',
        },
        {
          id: 'shift-2',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          start_time: '2024-01-02T09:00:00',
          end_time: '2024-01-02T17:00:00',
          break_duration: 30,
          position: 'Kitchen Manager',
        },
        {
          id: 'shift-3',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          start_time: '2024-01-03T09:00:00',
          end_time: '2024-01-03T17:00:00',
          break_duration: 30,
          position: 'Kitchen Manager',
        },
      ];

      const { breakdown, dailyCosts } = calculateScheduledLaborCost(
        shifts,
        [mockDailyRateEmployee],
        startDate,
        endDate
      );

      // 3 days × $166.67 = $500.01
      expect(breakdown.daily_rate.cost).toBeCloseTo(500.01, 2);
      expect(breakdown.daily_rate.daysScheduled).toBe(3);
      expect(breakdown.daily_rate.employees).toBe(1);

      // Check daily breakdown
      const day1 = dailyCosts.find(d => d.date === '2024-01-01');
      const day2 = dailyCosts.find(d => d.date === '2024-01-02');
      const day3 = dailyCosts.find(d => d.date === '2024-01-03');
      
      expect(day1?.daily_rate_cost).toBeCloseTo(166.67, 2);
      expect(day2?.daily_rate_cost).toBeCloseTo(166.67, 2);
      expect(day3?.daily_rate_cost).toBeCloseTo(166.67, 2);
    });

    it('counts each day only once even with multiple shifts', () => {
      const shifts: Shift[] = [
        {
          id: 'shift-1',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          start_time: '2024-01-01T06:00:00',
          end_time: '2024-01-01T10:00:00',
          break_duration: 0,
          position: 'Kitchen Manager',
        },
        {
          id: 'shift-2',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          start_time: '2024-01-01T14:00:00',
          end_time: '2024-01-01T18:00:00',
          break_duration: 0,
          position: 'Kitchen Manager',
        },
      ];

      const { breakdown } = calculateScheduledLaborCost(
        shifts,
        [mockDailyRateEmployee],
        startDate,
        endDate
      );

      // Should be 1 day × $166.67, not 2 × $166.67
      expect(breakdown.daily_rate.cost).toBeCloseTo(166.67, 2);
      expect(breakdown.daily_rate.daysScheduled).toBe(1);
    });

    it('handles short and long shifts with same rate', () => {
      const shifts: Shift[] = [
        // Short shift: 2 hours
        {
          id: 'shift-1',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          start_time: '2024-01-01T09:00:00',
          end_time: '2024-01-01T11:00:00',
          break_duration: 0,
          position: 'Kitchen Manager',
        },
        // Long shift: 12 hours
        {
          id: 'shift-2',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          start_time: '2024-01-02T06:00:00',
          end_time: '2024-01-02T18:00:00',
          break_duration: 0,
          position: 'Kitchen Manager',
        },
      ];

      const { breakdown } = calculateScheduledLaborCost(
        shifts,
        [mockDailyRateEmployee],
        startDate,
        endDate
      );

      // Both days should cost the same: 2 × $166.67 = $333.34
      expect(breakdown.daily_rate.cost).toBeCloseTo(333.34, 2);
      expect(breakdown.daily_rate.daysScheduled).toBe(2);
    });

    it('returns zero cost for inactive daily_rate employee', () => {
      const inactiveEmployee = { ...mockDailyRateEmployee, status: 'inactive' as const };
      const shifts: Shift[] = [
        {
          id: 'shift-1',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          start_time: '2024-01-01T09:00:00',
          end_time: '2024-01-01T17:00:00',
          break_duration: 30,
          position: 'Kitchen Manager',
        },
      ];

      const { breakdown } = calculateScheduledLaborCost(
        shifts,
        [inactiveEmployee],
        startDate,
        endDate
      );

      expect(breakdown.daily_rate.cost).toBe(0);
      expect(breakdown.daily_rate.daysScheduled).toBe(0);
    });
  });

  describe('calculateActualLaborCost', () => {
    const startDate = new Date('2024-01-01');
    const endDate = new Date('2024-01-07');

    it('calculates cost based on days with punches', () => {
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
          punch_time: '2024-01-02T18:30:00',
          punch_type: 'clock_out',
        },
      ];

      const { breakdown, dailyCosts } = calculateActualLaborCost(
        [mockDailyRateEmployee],
        punches,
        startDate,
        endDate
      );

      // 2 days × $166.67 = $333.34
      expect(breakdown.daily_rate.cost).toBeCloseTo(333.34, 2);
      expect(breakdown.daily_rate.daysScheduled).toBe(2);

      // Check daily costs
      const day1 = dailyCosts.find(d => d.date === '2024-01-01');
      const day2 = dailyCosts.find(d => d.date === '2024-01-02');
      
      expect(day1?.daily_rate_cost).toBeCloseTo(166.67, 2);
      expect(day2?.daily_rate_cost).toBeCloseTo(166.67, 2);
    });

    it('CRITICAL: counts days regardless of hours worked', () => {
      const punches: TimePunch[] = [
        // Day 1: 8 hours
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
        // Day 2: Only 1 hour!
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
          punch_time: '2024-01-02T10:00:00',
          punch_type: 'clock_out',
        },
        // Day 3: 16 hours!
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

      const { breakdown } = calculateActualLaborCost(
        [mockDailyRateEmployee],
        punches,
        startDate,
        endDate
      );

      // All three days should cost the same: 3 × $166.67 = $500.01
      expect(breakdown.daily_rate.cost).toBeCloseTo(500.01, 2);
      expect(breakdown.daily_rate.daysScheduled).toBe(3);
    });

    it('handles multiple punches on same day', () => {
      const punches: TimePunch[] = [
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
        {
          id: 'punch-3',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-01T14:00:00',
          punch_type: 'clock_in',
        },
        {
          id: 'punch-4',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-01T18:00:00',
          punch_type: 'clock_out',
        },
      ];

      const { breakdown } = calculateActualLaborCost(
        [mockDailyRateEmployee],
        punches,
        startDate,
        endDate
      );

      // Should be counted as 1 day: $166.67
      expect(breakdown.daily_rate.cost).toBeCloseTo(166.67, 2);
      expect(breakdown.daily_rate.daysScheduled).toBe(1);
    });

    it('returns zero cost when no punches', () => {
      const { breakdown } = calculateActualLaborCost(
        [mockDailyRateEmployee],
        [],
        startDate,
        endDate
      );

      expect(breakdown.daily_rate.cost).toBe(0);
      expect(breakdown.daily_rate.daysScheduled).toBe(0);
    });

    it('only counts punches within the period', () => {
      const punches: TimePunch[] = [
        // Before period
        {
          id: 'punch-1',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2023-12-31T09:00:00',
          punch_type: 'clock_in',
        },
        // Within period
        {
          id: 'punch-2',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-01T09:00:00',
          punch_type: 'clock_in',
        },
        {
          id: 'punch-3',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-01T17:00:00',
          punch_type: 'clock_out',
        },
        // After period
        {
          id: 'punch-4',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          punch_time: '2024-01-08T09:00:00',
          punch_type: 'clock_in',
        },
      ];

      const { breakdown } = calculateActualLaborCost(
        [mockDailyRateEmployee],
        punches,
        startDate,
        endDate
      );

      // Should only count Jan 1: $166.67
      expect(breakdown.daily_rate.cost).toBeCloseTo(166.67, 2);
      expect(breakdown.daily_rate.daysScheduled).toBe(1);
    });
  });

  describe('isEmployeeCompensationValid', () => {
    it('validates complete daily_rate employee', () => {
      expect(isEmployeeCompensationValid(mockDailyRateEmployee)).toBe(true);
    });

    it('rejects daily_rate without daily_rate_amount', () => {
      const employee = { ...mockDailyRateEmployee, daily_rate_amount: undefined };
      expect(isEmployeeCompensationValid(employee)).toBe(false);
    });

    it('rejects daily_rate with zero amount', () => {
      const employee = { ...mockDailyRateEmployee, daily_rate_amount: 0 };
      expect(isEmployeeCompensationValid(employee)).toBe(false);
    });

    it('rejects daily_rate with negative amount', () => {
      const employee = { ...mockDailyRateEmployee, daily_rate_amount: -100 };
      expect(isEmployeeCompensationValid(employee)).toBe(false);
    });
  });

  describe('getEmployeeDailyRateDescription', () => {
    it('returns formatted daily rate description', () => {
      const description = getEmployeeDailyRateDescription(mockDailyRateEmployee);
      expect(description).toBe('$166.67/day');
    });

    it('handles different daily rates', () => {
      const employee = { ...mockDailyRateEmployee, daily_rate_amount: 20000 };
      const description = getEmployeeDailyRateDescription(employee);
      expect(description).toBe('$200.00/day');
    });

    it('returns error message for invalid employee', () => {
      const employee = { ...mockDailyRateEmployee, daily_rate_amount: undefined };
      const description = getEmployeeDailyRateDescription(employee);
      expect(description).toBe('No rate configured');
    });
  });

  describe('Mixed Compensation Types', () => {
    it('calculates costs correctly with hourly and daily_rate employees', () => {
      const hourlyEmployee: Employee = {
        id: 'emp-2',
        restaurant_id: 'rest-1',
        name: 'Jane Doe',
        position: 'Server',
        status: 'active',
        compensation_type: 'hourly',
        hourly_rate: 1500, // $15/hr
        is_active: true,
        hire_date: '2024-01-01',
        tip_eligible: true,
      };

      const shifts: Shift[] = [
        // Daily rate employee: 2 days
        {
          id: 'shift-1',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          start_time: '2024-01-01T09:00:00',
          end_time: '2024-01-01T17:00:00',
          break_duration: 30,
          position: 'Kitchen Manager',
        },
        {
          id: 'shift-2',
          employee_id: 'emp-1',
          restaurant_id: 'rest-1',
          start_time: '2024-01-02T09:00:00',
          end_time: '2024-01-02T17:00:00',
          break_duration: 30,
          position: 'Kitchen Manager',
        },
        // Hourly employee: 8 hours
        {
          id: 'shift-3',
          employee_id: 'emp-2',
          restaurant_id: 'rest-1',
          start_time: '2024-01-01T09:00:00',
          end_time: '2024-01-01T17:00:00',
          break_duration: 30,
          position: 'Server',
        },
      ];

      const { breakdown } = calculateScheduledLaborCost(
        shifts,
        [mockDailyRateEmployee, hourlyEmployee],
        new Date('2024-01-01'),
        new Date('2024-01-07')
      );

      // Daily rate: 2 days × $166.67 = $333.34
      expect(breakdown.daily_rate.cost).toBeCloseTo(333.34, 2);
      
      // Hourly: 7.5 hours × $15 = $112.50
      expect(breakdown.hourly.cost).toBeCloseTo(112.50, 2);
      
      // Total should include both
      expect(breakdown.total).toBeCloseTo(445.84, 2);
    });
  });
});
