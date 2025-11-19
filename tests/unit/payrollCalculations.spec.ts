import { describe, test, expect } from '@playwright/test';
import {
  parseWorkPeriods,
  calculateWorkedHours,
  calculateRegularAndOvertimeHours,
  calculateEmployeePay,
  formatCurrency,
  formatHours,
} from '../../src/utils/payrollCalculations';
import { TimePunch } from '../../src/types/timeTracking';
import { Employee } from '../../src/types/scheduling';

describe('Payroll Calculations', () => {
  describe('parseWorkPeriods', () => {
    test('should parse a simple clock in/out pair', () => {
      const punches: TimePunch[] = [
        {
          id: '1',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'clock_in',
          punch_time: '2024-01-01T09:00:00Z',
          created_at: '2024-01-01T09:00:00Z',
          updated_at: '2024-01-01T09:00:00Z',
        },
        {
          id: '2',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'clock_out',
          punch_time: '2024-01-01T17:00:00Z',
          created_at: '2024-01-01T17:00:00Z',
          updated_at: '2024-01-01T17:00:00Z',
        },
      ];

      const periods = parseWorkPeriods(punches);
      expect(periods).toHaveLength(1);
      expect(periods[0].hours).toBe(8);
      expect(periods[0].isBreak).toBe(false);
    });

    test('should handle break periods', () => {
      const punches: TimePunch[] = [
        {
          id: '1',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'clock_in',
          punch_time: '2024-01-01T09:00:00Z',
          created_at: '2024-01-01T09:00:00Z',
          updated_at: '2024-01-01T09:00:00Z',
        },
        {
          id: '2',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'break_start',
          punch_time: '2024-01-01T12:00:00Z',
          created_at: '2024-01-01T12:00:00Z',
          updated_at: '2024-01-01T12:00:00Z',
        },
        {
          id: '3',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'break_end',
          punch_time: '2024-01-01T12:30:00Z',
          created_at: '2024-01-01T12:30:00Z',
          updated_at: '2024-01-01T12:30:00Z',
        },
        {
          id: '4',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'clock_out',
          punch_time: '2024-01-01T17:00:00Z',
          created_at: '2024-01-01T17:00:00Z',
          updated_at: '2024-01-01T17:00:00Z',
        },
      ];

      const periods = parseWorkPeriods(punches);
      expect(periods).toHaveLength(3);
      
      // First work period: 9am-12pm (3 hours)
      expect(periods[0].hours).toBe(3);
      expect(periods[0].isBreak).toBe(false);
      
      // Break period: 12pm-12:30pm (0.5 hours)
      expect(periods[1].hours).toBe(0.5);
      expect(periods[1].isBreak).toBe(true);
      
      // Second work period: 12:30pm-5pm (4.5 hours)
      expect(periods[2].hours).toBe(4.5);
      expect(periods[2].isBreak).toBe(false);
    });

    test('should handle out-of-order punches', () => {
      const punches: TimePunch[] = [
        {
          id: '2',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'clock_out',
          punch_time: '2024-01-01T17:00:00Z',
          created_at: '2024-01-01T17:00:00Z',
          updated_at: '2024-01-01T17:00:00Z',
        },
        {
          id: '1',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'clock_in',
          punch_time: '2024-01-01T09:00:00Z',
          created_at: '2024-01-01T09:00:00Z',
          updated_at: '2024-01-01T09:00:00Z',
        },
      ];

      const periods = parseWorkPeriods(punches);
      expect(periods).toHaveLength(1);
      expect(periods[0].hours).toBe(8);
    });

    test('should skip incomplete shifts without clock_out', () => {
      const punches: TimePunch[] = [
        {
          id: '1',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'clock_in',
          punch_time: '2024-01-01T09:00:00Z',
          created_at: '2024-01-01T09:00:00Z',
          updated_at: '2024-01-01T09:00:00Z',
        },
        {
          id: '2',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'break_start',
          punch_time: '2024-01-01T12:00:00Z',
          created_at: '2024-01-01T12:00:00Z',
          updated_at: '2024-01-01T12:00:00Z',
        },
        // No clock_out, so this should not be counted
      ];

      const periods = parseWorkPeriods(punches);
      expect(periods).toHaveLength(0);
    });

    test('should skip incomplete shifts without break_end', () => {
      const punches: TimePunch[] = [
        {
          id: '1',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'clock_in',
          punch_time: '2024-01-01T09:00:00Z',
          created_at: '2024-01-01T09:00:00Z',
          updated_at: '2024-01-01T09:00:00Z',
        },
        {
          id: '2',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'break_start',
          punch_time: '2024-01-01T12:00:00Z',
          created_at: '2024-01-01T12:00:00Z',
          updated_at: '2024-01-01T12:00:00Z',
        },
        {
          id: '3',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'clock_out',
          punch_time: '2024-01-01T17:00:00Z',
          created_at: '2024-01-01T17:00:00Z',
          updated_at: '2024-01-01T17:00:00Z',
        },
        // break_start without break_end, then clock_out
        // Should count work before break, but not after break
      ];

      const periods = parseWorkPeriods(punches);
      // Only the work period before break_start should be counted
      expect(periods).toHaveLength(1);
      expect(periods[0].hours).toBe(3); // 9am to 12pm
      expect(periods[0].isBreak).toBe(false);
    });
  });

  describe('calculateWorkedHours', () => {
    test('should calculate total worked hours excluding breaks', () => {
      const punches: TimePunch[] = [
        {
          id: '1',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'clock_in',
          punch_time: '2024-01-01T09:00:00Z',
          created_at: '2024-01-01T09:00:00Z',
          updated_at: '2024-01-01T09:00:00Z',
        },
        {
          id: '2',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'break_start',
          punch_time: '2024-01-01T12:00:00Z',
          created_at: '2024-01-01T12:00:00Z',
          updated_at: '2024-01-01T12:00:00Z',
        },
        {
          id: '3',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'break_end',
          punch_time: '2024-01-01T13:00:00Z',
          created_at: '2024-01-01T13:00:00Z',
          updated_at: '2024-01-01T13:00:00Z',
        },
        {
          id: '4',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'clock_out',
          punch_time: '2024-01-01T17:00:00Z',
          created_at: '2024-01-01T17:00:00Z',
          updated_at: '2024-01-01T17:00:00Z',
        },
      ];

      const hours = calculateWorkedHours(punches);
      // 9am-12pm (3h) + 1pm-5pm (4h) = 7 hours (excluding 1 hour break)
      expect(hours).toBe(7);
    });

    test('should return 0 for empty punches', () => {
      const hours = calculateWorkedHours([]);
      expect(hours).toBe(0);
    });
  });

  describe('calculateRegularAndOvertimeHours', () => {
    test('should calculate only regular hours when under 40', () => {
      const result = calculateRegularAndOvertimeHours(35);
      expect(result.regularHours).toBe(35);
      expect(result.overtimeHours).toBe(0);
    });

    test('should calculate exactly 40 regular hours with no overtime', () => {
      const result = calculateRegularAndOvertimeHours(40);
      expect(result.regularHours).toBe(40);
      expect(result.overtimeHours).toBe(0);
    });

    test('should calculate regular and overtime hours when over 40', () => {
      const result = calculateRegularAndOvertimeHours(45);
      expect(result.regularHours).toBe(40);
      expect(result.overtimeHours).toBe(5);
    });

    test('should handle large overtime hours', () => {
      const result = calculateRegularAndOvertimeHours(60);
      expect(result.regularHours).toBe(40);
      expect(result.overtimeHours).toBe(20);
    });
  });

  describe('calculateEmployeePay', () => {
    const employee: Employee = {
      id: 'emp1',
      restaurant_id: 'rest1',
      name: 'John Doe',
      position: 'Server',
      hourly_rate: 1500, // $15.00 in cents
      status: 'active',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    };

    test('should calculate pay for regular hours only', () => {
      const punches: TimePunch[] = [
        {
          id: '1',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'clock_in',
          punch_time: '2024-01-01T09:00:00Z',
          created_at: '2024-01-01T09:00:00Z',
          updated_at: '2024-01-01T09:00:00Z',
        },
        {
          id: '2',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'clock_out',
          punch_time: '2024-01-01T17:00:00Z',
          created_at: '2024-01-01T17:00:00Z',
          updated_at: '2024-01-01T17:00:00Z',
        },
      ];

      const payroll = calculateEmployeePay(employee, punches, 0);
      expect(payroll.regularHours).toBe(8);
      expect(payroll.overtimeHours).toBe(0);
      expect(payroll.regularPay).toBe(12000); // 8 hours * $15/hr = $120
      expect(payroll.overtimePay).toBe(0);
      expect(payroll.grossPay).toBe(12000);
      expect(payroll.totalTips).toBe(0);
      expect(payroll.totalPay).toBe(12000);
    });

    test('should calculate pay with overtime', () => {
      const punches: TimePunch[] = [];
      // Create 45 hours of work (5 days * 9 hours)
      for (let day = 0; day < 5; day++) {
        punches.push({
          id: `${day * 2 + 1}`,
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'clock_in',
          punch_time: `2024-01-0${day + 1}T09:00:00Z`,
          created_at: `2024-01-0${day + 1}T09:00:00Z`,
          updated_at: `2024-01-0${day + 1}T09:00:00Z`,
        });
        punches.push({
          id: `${day * 2 + 2}`,
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'clock_out',
          punch_time: `2024-01-0${day + 1}T18:00:00Z`,
          created_at: `2024-01-0${day + 1}T18:00:00Z`,
          updated_at: `2024-01-0${day + 1}T18:00:00Z`,
        });
      }

      const payroll = calculateEmployeePay(employee, punches, 0);
      expect(payroll.regularHours).toBe(40);
      expect(payroll.overtimeHours).toBe(5);
      expect(payroll.regularPay).toBe(60000); // 40 hours * $15/hr = $600
      expect(payroll.overtimePay).toBe(11250); // 5 hours * $15/hr * 1.5 = $112.50
      expect(payroll.grossPay).toBe(71250); // $712.50
    });

    test('should include tips in total pay', () => {
      const punches: TimePunch[] = [
        {
          id: '1',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'clock_in',
          punch_time: '2024-01-01T09:00:00Z',
          created_at: '2024-01-01T09:00:00Z',
          updated_at: '2024-01-01T09:00:00Z',
        },
        {
          id: '2',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'clock_out',
          punch_time: '2024-01-01T17:00:00Z',
          created_at: '2024-01-01T17:00:00Z',
          updated_at: '2024-01-01T17:00:00Z',
        },
      ];

      const tips = 5000; // $50.00 in tips
      const payroll = calculateEmployeePay(employee, punches, tips);
      expect(payroll.totalTips).toBe(5000);
      expect(payroll.grossPay).toBe(12000); // wages only
      expect(payroll.totalPay).toBe(17000); // wages + tips
    });

    test('should calculate overtime per calendar week for multi-week periods', () => {
      const punches: TimePunch[] = [];
      
      // Week 1 (Jan 1-7, 2024): 45 hours (5 OT hours)
      // Monday Jan 1
      punches.push({
        id: '1',
        restaurant_id: 'rest1',
        employee_id: 'emp1',
        punch_type: 'clock_in',
        punch_time: '2024-01-01T09:00:00Z',
        created_at: '2024-01-01T09:00:00Z',
        updated_at: '2024-01-01T09:00:00Z',
      });
      punches.push({
        id: '2',
        restaurant_id: 'rest1',
        employee_id: 'emp1',
        punch_type: 'clock_out',
        punch_time: '2024-01-01T18:00:00Z',
        created_at: '2024-01-01T18:00:00Z',
        updated_at: '2024-01-01T18:00:00Z',
      });
      
      // Tuesday-Friday of Week 1: 9 hours each day
      for (let day = 2; day <= 5; day++) {
        punches.push({
          id: `${day * 2 + 1}`,
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'clock_in',
          punch_time: `2024-01-0${day}T09:00:00Z`,
          created_at: `2024-01-0${day}T09:00:00Z`,
          updated_at: `2024-01-0${day}T09:00:00Z`,
        });
        punches.push({
          id: `${day * 2 + 2}`,
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'clock_out',
          punch_time: `2024-01-0${day}T18:00:00Z`,
          created_at: `2024-01-0${day}T18:00:00Z`,
          updated_at: `2024-01-0${day}T18:00:00Z`,
        });
      }
      
      // Week 2 (Jan 8-14, 2024): 35 hours (0 OT hours)
      // Monday-Thursday of Week 2: 8 hours, Friday 3 hours
      for (let day = 8; day <= 11; day++) {
        punches.push({
          id: `${day * 2 + 1}`,
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'clock_in',
          punch_time: `2024-01-${day}T09:00:00Z`,
          created_at: `2024-01-${day}T09:00:00Z`,
          updated_at: `2024-01-${day}T09:00:00Z`,
        });
        punches.push({
          id: `${day * 2 + 2}`,
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'clock_out',
          punch_time: `2024-01-${day}T17:00:00Z`,
          created_at: `2024-01-${day}T17:00:00Z`,
          updated_at: `2024-01-${day}T17:00:00Z`,
        });
      }
      // Friday partial day
      punches.push({
        id: '25',
        restaurant_id: 'rest1',
        employee_id: 'emp1',
        punch_type: 'clock_in',
        punch_time: '2024-01-12T09:00:00Z',
        created_at: '2024-01-12T09:00:00Z',
        updated_at: '2024-01-12T09:00:00Z',
      });
      punches.push({
        id: '26',
        restaurant_id: 'rest1',
        employee_id: 'emp1',
        punch_type: 'clock_out',
        punch_time: '2024-01-12T12:00:00Z',
        created_at: '2024-01-12T12:00:00Z',
        updated_at: '2024-01-12T12:00:00Z',
      });

      const payroll = calculateEmployeePay(employee, punches, 0);
      
      // Week 1: 45 hours = 40 regular + 5 OT
      // Week 2: 35 hours = 35 regular + 0 OT
      // Total: 75 regular + 5 OT
      expect(payroll.regularHours).toBe(75);
      expect(payroll.overtimeHours).toBe(5);
      expect(payroll.regularPay).toBe(112500); // 75 hours * $15/hr = $1,125
      expect(payroll.overtimePay).toBe(11250); // 5 hours * $15/hr * 1.5 = $112.50
      expect(payroll.grossPay).toBe(123750); // $1,237.50
    });

    test('should calculate overtime separately for each week even if total is under 40', () => {
      const punches: TimePunch[] = [];
      
      // Week 1 (Jan 1-7, 2024): 50 hours (10 OT hours)
      for (let day = 1; day <= 5; day++) {
        punches.push({
          id: `${day * 2 - 1}`,
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'clock_in',
          punch_time: `2024-01-0${day}T08:00:00Z`,
          created_at: `2024-01-0${day}T08:00:00Z`,
          updated_at: `2024-01-0${day}T08:00:00Z`,
        });
        punches.push({
          id: `${day * 2}`,
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'clock_out',
          punch_time: `2024-01-0${day}T18:00:00Z`,
          created_at: `2024-01-0${day}T18:00:00Z`,
          updated_at: `2024-01-0${day}T18:00:00Z`,
        });
      }
      
      // Week 2 (Jan 8-14, 2024): 20 hours (0 OT hours)
      for (let day = 8; day <= 9; day++) {
        punches.push({
          id: `${day * 2 - 1}`,
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'clock_in',
          punch_time: `2024-01-${day}T09:00:00Z`,
          created_at: `2024-01-${day}T09:00:00Z`,
          updated_at: `2024-01-${day}T09:00:00Z`,
        });
        punches.push({
          id: `${day * 2}`,
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          punch_type: 'clock_out',
          punch_time: `2024-01-${day}T19:00:00Z`,
          created_at: `2024-01-${day}T19:00:00Z`,
          updated_at: `2024-01-${day}T19:00:00Z`,
        });
      }

      const payroll = calculateEmployeePay(employee, punches, 0);
      
      // Week 1: 50 hours = 40 regular + 10 OT
      // Week 2: 20 hours = 20 regular + 0 OT
      // Total: 60 regular + 10 OT (not 70 regular + 0 OT)
      expect(payroll.regularHours).toBe(60);
      expect(payroll.overtimeHours).toBe(10);
      expect(payroll.regularPay).toBe(90000); // 60 hours * $15/hr = $900
      expect(payroll.overtimePay).toBe(22500); // 10 hours * $15/hr * 1.5 = $225
      expect(payroll.grossPay).toBe(112500); // $1,125
    });
  });

  describe('formatCurrency', () => {
    test('should format cents to USD currency', () => {
      expect(formatCurrency(1500)).toBe('$15.00');
      expect(formatCurrency(10000)).toBe('$100.00');
      expect(formatCurrency(12345)).toBe('$123.45');
      expect(formatCurrency(0)).toBe('$0.00');
    });

    test('should handle negative amounts', () => {
      expect(formatCurrency(-1500)).toBe('-$15.00');
    });
  });

  describe('formatHours', () => {
    test('should format hours to 2 decimal places', () => {
      expect(formatHours(8)).toBe('8.00');
      expect(formatHours(7.5)).toBe('7.50');
      expect(formatHours(40.123456)).toBe('40.12');
    });
  });
});
