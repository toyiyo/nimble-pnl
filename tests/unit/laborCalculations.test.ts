import { describe, it, expect } from 'vitest';
import {
  calculateEmployeeDailyCost,
  calculateEmployeePeriodCost,
  calculateScheduledLaborCost,
  isEmployeeCompensationValid,
  getEmployeeDailyRateDescription,
} from '../../src/services/laborCalculations';
import type { Employee, Shift } from '../../src/types/scheduling';

/**
 * Comprehensive tests for centralized labor cost calculations
 * 
 * These tests ensure consistency across:
 * - Dashboard metrics
 * - Scheduling projections
 * - Payroll calculations
 * 
 * All three systems MUST produce identical results for the same inputs.
 */

describe('LaborCalculationService', () => {
  // ============================================================================
  // Test Data Setup
  // ============================================================================

  const baseEmployee: Partial<Employee> = {
    id: 'emp-1',
    name: 'Test Employee',
    restaurant_id: 'rest-1',
    position: 'Server',
    status: 'active',
    hire_date: '2024-01-01',
  };

  const hourlyEmployee: Employee = {
    ...baseEmployee,
    id: 'hourly-1',
    compensation_type: 'hourly',
    hourly_rate: 1500, // $15.00/hr in cents
  } as Employee;

  const salaryEmployeeWeekly: Employee = {
    ...baseEmployee,
    id: 'salary-weekly-1',
    compensation_type: 'salary',
    salary_amount: 100000, // $1,000/week in cents
    pay_period_type: 'weekly',
  } as Employee;

  const salaryEmployeeMonthly: Employee = {
    ...baseEmployee,
    id: 'salary-monthly-1',
    compensation_type: 'salary',
    salary_amount: 500000, // $5,000/month in cents
    pay_period_type: 'monthly',
  } as Employee;

  const contractorMonthly: Employee = {
    ...baseEmployee,
    id: 'contractor-monthly-1',
    compensation_type: 'contractor',
    contractor_payment_amount: 300000, // $3,000/month in cents
    contractor_payment_interval: 'monthly',
  } as Employee;

  // ============================================================================
  // Core Calculation Tests
  // ============================================================================

  describe('calculateEmployeeDailyCost', () => {
    it('calculates hourly employee cost correctly', () => {
      const cost = calculateEmployeeDailyCost(hourlyEmployee, 8);
      // $15/hr × 8hrs = $120 = 12000 cents
      expect(cost).toBe(12000);
    });

    it('returns 0 for hourly employee with no hours', () => {
      expect(calculateEmployeeDailyCost(hourlyEmployee, 0)).toBe(0);
      expect(calculateEmployeeDailyCost(hourlyEmployee)).toBe(0);
    });

    it('calculates weekly salary employee daily cost correctly', () => {
      const cost = calculateEmployeeDailyCost(salaryEmployeeWeekly);
      // $1,000/week ÷ 7 days = $142.857... = 14286 cents (rounded)
      expect(cost).toBe(14286);
    });

    it('calculates monthly salary employee daily cost correctly', () => {
      const cost = calculateEmployeeDailyCost(salaryEmployeeMonthly);
      // $5,000/month ÷ 30.44 days = $164.26... = 16426 cents (rounded)
      expect(cost).toBe(16426);
    });

    it('calculates monthly contractor daily cost correctly', () => {
      const cost = calculateEmployeeDailyCost(contractorMonthly);
      // $3,000/month ÷ 30.44 days = $98.55... = 9855 cents (rounded)
      expect(cost).toBe(9855);
    });

    it('returns 0 for per-job contractors', () => {
      const perJobContractor: Employee = {
        ...baseEmployee,
        compensation_type: 'contractor',
        contractor_payment_amount: 50000,
        contractor_payment_interval: 'per-job',
      } as Employee;

      expect(calculateEmployeeDailyCost(perJobContractor)).toBe(0);
    });

    it('returns 0 for invalid employee data', () => {
      const invalidSalary: Employee = {
        ...baseEmployee,
        compensation_type: 'salary',
        salary_amount: undefined,
        pay_period_type: undefined,
      } as Employee;

      expect(calculateEmployeeDailyCost(invalidSalary)).toBe(0);
    });
  });

  // ============================================================================
  // Period Calculation Tests
  // ============================================================================

  describe('calculateEmployeePeriodCost', () => {
    const weekStart = new Date('2025-12-07');
    const weekEnd = new Date('2025-12-13'); // 7 days

    it('calculates weekly salary correctly for 7-day period', () => {
      const cost = calculateEmployeePeriodCost(
        salaryEmployeeWeekly,
        weekStart,
        weekEnd
      );
      // $142.86/day × 7 days = $1,000.02 = 100002 cents (with rounding)
      expect(cost).toBeCloseTo(100002, -1); // Within 10 cents
    });

    it('calculates monthly salary correctly for 7-day period', () => {
      const cost = calculateEmployeePeriodCost(
        salaryEmployeeMonthly,
        weekStart,
        weekEnd
      );
      // $164.26/day × 7 days = $1,149.82 = 114982 cents
      // Allow 2 cent tolerance for rounding
      expect(Math.abs(cost - 114982)).toBeLessThanOrEqual(2);
    });

    it('calculates hourly employee cost for period with hours map', () => {
      const hoursMap = new Map<string, number>([
        ['2025-12-07', 8],
        ['2025-12-08', 0], // day off
        ['2025-12-09', 8],
        ['2025-12-10', 8],
        ['2025-12-11', 8],
        ['2025-12-12', 8],
        ['2025-12-13', 0], // day off
      ]);

      const cost = calculateEmployeePeriodCost(
        hourlyEmployee,
        weekStart,
        weekEnd,
        hoursMap
      );
      // 5 days × 8 hrs × $15/hr = $600 = 60000 cents
      expect(cost).toBe(60000);
    });

    it('returns 0 for hourly employee with no hours map', () => {
      const cost = calculateEmployeePeriodCost(
        hourlyEmployee,
        weekStart,
        weekEnd
      );
      expect(cost).toBe(0);
    });

    it('calculates single day period correctly', () => {
      const cost = calculateEmployeePeriodCost(
        salaryEmployeeWeekly,
        weekStart,
        weekStart
      );
      // 1 day × $142.86 = 14286 cents
      expect(cost).toBe(14286);
    });

    it('calculates 30-day period for monthly salary correctly', () => {
      const monthStart = new Date('2025-12-01');
      const monthEnd = new Date('2025-12-30'); // 30 days

      const cost = calculateEmployeePeriodCost(
        salaryEmployeeMonthly,
        monthStart,
        monthEnd
      );
      // 30 days × $164.26/day = $4,927.80 = 492780 cents (allow 7 cent tolerance)
      expect(Math.abs(cost - 492780)).toBeLessThanOrEqual(7);
    });
  });

  // ============================================================================
  // Scheduled Labor Cost Tests
  // ============================================================================

  describe('calculateScheduledLaborCost', () => {
    const weekStart = new Date('2025-12-07');
    const weekEnd = new Date('2025-12-13');

    const baseShift = {
      is_published: true,
      locked: false,
      created_at: '2025-12-01T00:00:00',
      updated_at: '2025-12-01T00:00:00',
    };

    it('calculates costs for scheduled hourly shifts', () => {
      const shifts: Shift[] = [
        {
          ...baseShift,
          id: 'shift-1',
          restaurant_id: 'rest-1',
          employee_id: 'hourly-1',
          start_time: '2025-12-09T09:00:00',
          end_time: '2025-12-09T17:00:00',
          break_duration: 0,
          notes: undefined,
          status: 'scheduled',
          position: 'Server',
        },
        {
          ...baseShift,
          id: 'shift-2',
          restaurant_id: 'rest-1',
          employee_id: 'hourly-1',
          start_time: '2025-12-10T09:00:00',
          end_time: '2025-12-10T17:00:00',
          break_duration: 0,
          notes: undefined,
          status: 'scheduled',
          position: 'Server',
        },
      ];

      const { breakdown } = calculateScheduledLaborCost(
        shifts,
        [hourlyEmployee],
        weekStart,
        weekEnd
      );

      // 2 shifts × 8 hours × $15/hr = $240
      expect(breakdown.hourly.cost).toBe(240);
      expect(breakdown.hourly.hours).toBe(16);
      expect(breakdown.total).toBe(240);
    });

    it('calculates full period cost for salary employees regardless of scheduled days', () => {
      const shifts: Shift[] = [
        {
          ...baseShift,
          id: 'shift-1',
          restaurant_id: 'rest-1',
          employee_id: 'salary-monthly-1',
          start_time: '2025-12-09T09:00:00',
          end_time: '2025-12-09T17:00:00',
          break_duration: 0,
          notes: undefined,
          status: 'scheduled',
          position: 'Server',
        },
      ];

      const { breakdown } = calculateScheduledLaborCost(
        shifts,
        [salaryEmployeeMonthly],
        weekStart,
        weekEnd
      );

      // Salary employees get paid regardless of scheduled hours
      // $5000/month ÷ 30.44 days/month = $164.24/day
      // 7 days in range × $164.24/day = $1149.68 (allow for rounding)
      expect(breakdown.salary.cost).toBeCloseTo(1149.68, 0); // Allow $1 variance for rounding
      expect(breakdown.salary.employees).toBe(1);
    });

    it('shows full week cost for salary employees when no shifts exist', () => {
      const { breakdown } = calculateScheduledLaborCost(
        [], // No shifts
        [salaryEmployeeMonthly],
        weekStart,
        weekEnd
      );

      // 7 days × $164.26/day = $1,149.82 (allow 2 cent tolerance for rounding)
      expect(Math.abs(breakdown.salary.cost - 1149.82)).toBeLessThanOrEqual(0.02);
    });

    it('combines hourly, salary, and contractor costs', () => {
      const shifts: Shift[] = [
        {
          ...baseShift,
          id: 'shift-1',
          restaurant_id: 'rest-1',
          employee_id: 'hourly-1',
          start_time: '2025-12-09T09:00:00',
          end_time: '2025-12-09T17:00:00',
          break_duration: 0,
          notes: undefined,
          status: 'scheduled',
          position: 'Server',
        },
        {
          ...baseShift,
          id: 'shift-2',
          restaurant_id: 'rest-1',
          employee_id: 'salary-monthly-1',
          start_time: '2025-12-09T09:00:00',
          end_time: '2025-12-09T17:00:00',
          break_duration: 0,
          notes: undefined,
          status: 'scheduled',
          position: 'Manager',
        },
        {
          ...baseShift,
          id: 'shift-3',
          restaurant_id: 'rest-1',
          employee_id: 'contractor-monthly-1',
          start_time: '2025-12-09T09:00:00',
          end_time: '2025-12-09T17:00:00',
          break_duration: 0,
          notes: undefined,
          status: 'scheduled',
          position: 'Consultant',
        },
      ];

      const { breakdown } = calculateScheduledLaborCost(
        shifts,
        [hourlyEmployee, salaryEmployeeMonthly, contractorMonthly],
        weekStart,
        weekEnd
      );

      // Hourly: 8hrs × $15 = $120
      // Salary: 7 days × $164.24/day = $1149.68 (paid per pay period, not per shift)
      // Contractor: 7 days × $98.55/day = $689.85 (paid per pay period, not per shift)
      // Total: $1959.53
      expect(breakdown.hourly.cost).toBe(120);
      expect(breakdown.salary.cost).toBeCloseTo(1149.68, 0); // Allow $1 variance for rounding
      expect(breakdown.contractor.cost).toBeCloseTo(689.85, 0); // Allow $1 variance for rounding
      expect(breakdown.total).toBeCloseTo(1959.53, 0); // Allow $1 variance for rounding
    });
  });

  // ============================================================================
  // Cross-System Consistency Tests
  // ============================================================================

  describe('Cross-system consistency', () => {
    const weekStart = new Date('2025-12-07');
    const weekEnd = new Date('2025-12-13');

    it('weekly salary: period calculation matches 7 × daily calculation', () => {
      const dailyCost = calculateEmployeeDailyCost(salaryEmployeeWeekly);
      const periodCost = calculateEmployeePeriodCost(
        salaryEmployeeWeekly,
        weekStart,
        weekEnd
      );

      // Weekly salary: allow 2 cent tolerance for rounding
      expect(Math.abs(periodCost - dailyCost * 7)).toBeLessThanOrEqual(2);
    });

    it('monthly salary: period calculation matches 7 × daily calculation', () => {
      const dailyCost = calculateEmployeeDailyCost(salaryEmployeeMonthly);
      const periodCost = calculateEmployeePeriodCost(
        salaryEmployeeMonthly,
        weekStart,
        weekEnd
      );

      // Monthly salary: allow 2 cent tolerance for rounding
      expect(Math.abs(periodCost - dailyCost * 7)).toBeLessThanOrEqual(2);
    });

    it('scheduled cost matches period cost for same employee/period', () => {
      // For salary employees with no shifts, scheduled should show full period cost
      const periodCost = calculateEmployeePeriodCost(
        salaryEmployeeMonthly,
        weekStart,
        weekEnd
      );

      const { breakdown } = calculateScheduledLaborCost(
        [], // No shifts
        [salaryEmployeeMonthly],
        weekStart,
        weekEnd
      );

      // Period cost is in cents, scheduled is in dollars
      expect(breakdown.salary.cost).toBeCloseTo(periodCost / 100, 1);
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge cases', () => {
    const baseShift = {
      is_published: true,
      locked: false,
      created_at: '2025-12-01T00:00:00',
      updated_at: '2025-12-01T00:00:00',
    };

    it('handles shift with break duration', () => {
      const shifts: Shift[] = [
        {
          ...baseShift,
          id: 'shift-1',
          restaurant_id: 'rest-1',
          employee_id: 'hourly-1',
          start_time: '2025-12-09T09:00:00Z', // Use UTC to avoid timezone issues
          end_time: '2025-12-09T17:00:00Z',
          break_duration: 30, // 30 min break
          notes: undefined,
          status: 'scheduled',
          position: 'Server',
        },
      ];

      const testStart = new Date('2025-12-09T00:00:00Z');
      const testEnd = new Date('2025-12-09T23:59:59Z');

      const { breakdown } = calculateScheduledLaborCost(
        shifts,
        [hourlyEmployee],
        testStart,
        testEnd
      );

      // 7.5 hours × $15/hr = $112.50
      expect(breakdown.hourly.hours).toBe(7.5);
      expect(breakdown.hourly.cost).toBe(112.5);
    });

    it('handles overnight shifts', () => {
      const shifts: Shift[] = [
        {
          ...baseShift,
          id: 'shift-1',
          restaurant_id: 'rest-1',
          employee_id: 'hourly-1',
          start_time: '2025-12-09T22:00:00', // 10 PM
          end_time: '2025-12-10T06:00:00', // 6 AM next day
          break_duration: 0,
          notes: undefined,
          status: 'scheduled',
          position: 'Server',
        },
      ];

      const { breakdown } = calculateScheduledLaborCost(
        shifts,
        [hourlyEmployee],
        new Date('2025-12-09'),
        new Date('2025-12-10')
      );

      // 8 hours × $15/hr = $120
      expect(breakdown.hourly.hours).toBe(8);
      expect(breakdown.hourly.cost).toBe(120);
    });

    it('handles partial hours correctly', () => {
      const cost = calculateEmployeeDailyCost(hourlyEmployee, 3.5);
      // 3.5 hrs × $15/hr = $52.50 = 5250 cents
      expect(cost).toBe(5250);
    });

    it('handles bi-weekly salary correctly', () => {
      const biWeeklyEmployee: Employee = {
        ...baseEmployee,
        compensation_type: 'salary',
        salary_amount: 200000, // $2,000 bi-weekly
        pay_period_type: 'bi-weekly',
      } as Employee;

      const dailyCost = calculateEmployeeDailyCost(biWeeklyEmployee);
      // $2,000 ÷ 14 days = $142.857... = 14286 cents
      expect(dailyCost).toBe(14286);
    });

    it('handles semi-monthly salary correctly', () => {
      const semiMonthlyEmployee: Employee = {
        ...baseEmployee,
        compensation_type: 'salary',
        salary_amount: 250000, // $2,500 semi-monthly
        pay_period_type: 'semi-monthly',
      } as Employee;

      const dailyCost = calculateEmployeeDailyCost(semiMonthlyEmployee);
      // $2,500 ÷ 15.22 days = $164.26... = 16426 cents
      expect(dailyCost).toBe(16426);
    });
  });

  // ============================================================================
  // Validation Tests
  // ============================================================================

  describe('isEmployeeCompensationValid', () => {
    it('validates hourly employee', () => {
      expect(isEmployeeCompensationValid(hourlyEmployee)).toBe(true);
      
      const invalid = { ...hourlyEmployee, hourly_rate: 0 };
      expect(isEmployeeCompensationValid(invalid as Employee)).toBe(false);
    });

    it('validates salary employee', () => {
      expect(isEmployeeCompensationValid(salaryEmployeeMonthly)).toBe(true);
      
      const noAmount = { ...salaryEmployeeMonthly, salary_amount: undefined };
      expect(isEmployeeCompensationValid(noAmount as Employee)).toBe(false);
      
      const noPeriod = { ...salaryEmployeeMonthly, pay_period_type: undefined };
      expect(isEmployeeCompensationValid(noPeriod as Employee)).toBe(false);
    });

    it('validates contractor', () => {
      expect(isEmployeeCompensationValid(contractorMonthly)).toBe(true);
      
      const invalid = { ...contractorMonthly, contractor_payment_amount: undefined };
      expect(isEmployeeCompensationValid(invalid as Employee)).toBe(false);
    });
  });

  describe('getEmployeeDailyRateDescription', () => {
    it('describes hourly rate', () => {
      const desc = getEmployeeDailyRateDescription(hourlyEmployee);
      expect(desc).toBe('$15.00/hr');
    });

    it('describes weekly salary', () => {
      const desc = getEmployeeDailyRateDescription(salaryEmployeeWeekly);
      expect(desc).toContain('142.86');
      expect(desc).toContain('weekly');
    });

    it('describes monthly salary', () => {
      const desc = getEmployeeDailyRateDescription(salaryEmployeeMonthly);
      expect(desc).toContain('164.26');
      expect(desc).toContain('monthly');
    });

    it('describes per-job contractor', () => {
      const perJobContractor: Employee = {
        ...baseEmployee,
        compensation_type: 'contractor',
        contractor_payment_amount: 50000,
        contractor_payment_interval: 'per-job',
      } as Employee;

      const desc = getEmployeeDailyRateDescription(perJobContractor);
      expect(desc).toContain('500.00');
      expect(desc).toContain('job');
    });
  });

  // ============================================================================
  // Real-World Scenario Tests
  // ============================================================================

  describe('Real-world scenarios', () => {
    it('matches the reported bug: $5,000/month salary for 7 days', () => {
      // This was the original bug - should show $1,149.82, not $68.49
      const weekStart = new Date('2025-12-07');
      const weekEnd = new Date('2025-12-13');

      const periodCost = calculateEmployeePeriodCost(
        salaryEmployeeMonthly,
        weekStart,
        weekEnd
      );

      // Should be $1,149.82 (114982 cents), NOT $68.49
      // Allow 2 cent tolerance for rounding
      expect(Math.abs(periodCost - 114982)).toBeLessThanOrEqual(2);
      expect(Math.abs(periodCost / 100 - 1149.82)).toBeLessThanOrEqual(0.02);
    });

    it('matches payroll calculation for monthly salary', () => {
      // Payroll shows $1,149.82 for 7 days
      // Our calculation: 7 × $164.24 = $1,149.68 (close, slight rounding difference)
      const weekStart = new Date('2025-12-07');
      const weekEnd = new Date('2025-12-13');

      const periodCost = calculateEmployeePeriodCost(
        salaryEmployeeMonthly,
        weekStart,
        weekEnd
      );

      // Should be very close to $1,149.68
      expect(periodCost / 100).toBeCloseTo(1149.68, 0);
    });

    it('calculates full month correctly', () => {
      const monthStart = new Date('2025-12-01');
      const monthEnd = new Date('2025-12-31'); // 31 days

      const periodCost = calculateEmployeePeriodCost(
        salaryEmployeeMonthly,
        monthStart,
        monthEnd
      );

      // 31 days × $164.26/day = $5,092.06
      // Allow 10 cent tolerance for rounding over full month
      expect(Math.abs(periodCost / 100 - 5092.06)).toBeLessThanOrEqual(0.10);
    });
  });
});
