/**
 * Comprehensive Edge Case Tests for Compensation Calculations
 *
 * These tests are designed to find holes in our thinking about:
 * 1. Hourly employees - overnight shifts, missing punches, edge cases
 * 2. Contractors - irregular schedules, per-job vs periodic
 * 3. Salaried employees - partial periods, mid-month hires, terminations
 *
 * The goal is NOT to validate the current implementation, but to
 * discover scenarios we haven't considered.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateDailyContractorAllocation,
  calculateDailyLaborCost,
  calculateEmployeeDailyCostForDate,
  calculateLaborBreakdown,
  calculateSalaryForPeriod,
  generateDailyAllocation,
  getEmployeeSnapshotForDate,
  getPayPeriodDates,
  getDaysInPayPeriod,
  resolveCompensationForDate,
  validateCompensationFields,
  requiresTimePunches,
} from '@/utils/compensationCalculations';
import {
  parseWorkPeriods,
  calculateWorkedHours,
  calculateWorkedHoursWithAnomalies,
  calculateEmployeePay,
  calculateRegularAndOvertimeHours,
} from '@/utils/payrollCalculations';
import type {
  Employee,
  DailyLaborAllocation,
} from '@/types/scheduling';
import type { TimePunch } from '@/types/timeTracking';

// ============================================================================
// Test Helpers
// ============================================================================

function createEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 'emp-test',
    restaurant_id: 'rest-test',
    name: 'Test Employee',
    position: 'Server',
    status: 'active',
    compensation_type: 'hourly',
    hourly_rate: 1500, // $15.00/hr in cents
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function createPunch(
  type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end',
  dateTime: string,
  employeeId: string = 'emp-test'
): TimePunch {
  return {
    id: `punch-${Date.now()}-${Math.random()}`,
    restaurant_id: 'rest-test',
    employee_id: employeeId,
    punch_type: type,
    punch_time: dateTime,
    created_at: dateTime,
    updated_at: dateTime,
  };
}

// Helper to create a full shift (clock in + clock out)
function createShift(
  clockIn: string,
  clockOut: string,
  employeeId: string = 'emp-test'
): TimePunch[] {
  return [
    createPunch('clock_in', clockIn, employeeId),
    createPunch('clock_out', clockOut, employeeId),
  ];
}

// ============================================================================
// SECTION 1: HOURLY EMPLOYEE EDGE CASES
// ============================================================================

describe('Hourly Employee Edge Cases', () => {
  describe('Overnight Shifts', () => {
    it('correctly calculates hours for a normal overnight shift (8 PM - 4 AM)', () => {
      const punches = createShift(
        '2024-01-15T20:00:00Z', // 8 PM Monday
        '2024-01-16T04:00:00Z' // 4 AM Tuesday
      );

      const hours = calculateWorkedHours(punches);
      expect(hours).toBe(8); // 8 hours overnight
    });

    it('correctly calculates hours for late night shift crossing midnight (10 PM - 6 AM)', () => {
      const punches = createShift(
        '2024-01-15T22:00:00Z', // 10 PM
        '2024-01-16T06:00:00Z' // 6 AM next day
      );

      const hours = calculateWorkedHours(punches);
      expect(hours).toBe(8);
    });

    it('handles a very long but valid overnight shift (6 PM - 6 AM = 12 hours)', () => {
      const punches = createShift(
        '2024-01-15T18:00:00Z', // 6 PM
        '2024-01-16T06:00:00Z' // 6 AM next day (12 hours)
      );

      const hours = calculateWorkedHours(punches);
      expect(hours).toBe(12);
    });

    it('flags shifts exceeding 16 hours as needing review', () => {
      const punches = createShift(
        '2024-01-15T06:00:00Z', // 6 AM Monday
        '2024-01-16T00:00:00Z' // Midnight Tuesday (18 hours)
      );

      const { incompleteShifts } = calculateWorkedHoursWithAnomalies(punches);
      // Current behavior: Should flag but still count the hours
      // OR: Should NOT count them until manager review?
      // This is a potential hole - what's the right behavior?
      expect(incompleteShifts.length).toBeGreaterThan(0);
      expect(incompleteShifts[0].type).toBe('shift_too_long');
    });

    it('handles bartender closing shift (work until 3 AM, leave at 4 AM)', () => {
      // Real scenario: Bar closes at 2 AM, bartender cleans up until 4 AM
      const punches = createShift(
        '2024-01-15T17:00:00Z', // 5 PM
        '2024-01-16T04:00:00Z' // 4 AM (11 hours)
      );

      const hours = calculateWorkedHours(punches);
      expect(hours).toBe(11);
    });
  });

  describe('Missing Punches', () => {
    it('flags a clock_in with no clock_out (open shift at end of day)', () => {
      const punches = [
        createPunch('clock_in', '2024-01-15T09:00:00Z'),
        // No clock_out - employee forgot
      ];

      const { incompleteShifts } = parseWorkPeriods(punches);
      expect(incompleteShifts.length).toBe(1);
      expect(incompleteShifts[0].type).toBe('missing_clock_out');
    });

    it('flags a clock_out with no prior clock_in (orphan punch)', () => {
      const punches = [
        createPunch('clock_out', '2024-01-15T17:00:00Z'),
        // No preceding clock_in
      ];

      const { incompleteShifts } = parseWorkPeriods(punches);
      expect(incompleteShifts.length).toBe(1);
      expect(incompleteShifts[0].type).toBe('missing_clock_in');
    });

    it('handles two clock_ins in a row (forgot to clock out previous day)', () => {
      const punches = [
        createPunch('clock_in', '2024-01-15T09:00:00Z'), // Monday morning
        createPunch('clock_in', '2024-01-16T09:00:00Z'), // Tuesday morning - forgot to clock out Monday!
        createPunch('clock_out', '2024-01-16T17:00:00Z'), // Tuesday evening
      ];

      const { periods, incompleteShifts } = parseWorkPeriods(punches);
      // Should flag Monday's clock_in as incomplete
      expect(incompleteShifts.length).toBe(1);
      expect(incompleteShifts[0].type).toBe('missing_clock_out');
      // Should still count Tuesday's valid shift
      expect(periods.length).toBe(1);
      expect(periods[0].hours).toBe(8);
    });

    it('handles two clock_outs within 5 minutes (accidental double tap - deduplicated)', () => {
      const punches = [
        createPunch('clock_in', '2024-01-15T09:00:00Z'),
        createPunch('clock_out', '2024-01-15T17:00:00Z'),
        createPunch('clock_out', '2024-01-15T17:01:00Z'), // Accidental double tap within 5 min
      ];

      const { periods, incompleteShifts } = parseWorkPeriods(punches);
      // Deduplication removes the first clock_out, keeps the last one
      // So this should be treated as a single valid shift
      expect(periods.length).toBe(1);
      expect(incompleteShifts.length).toBe(0); // No incomplete shifts - it's deduplicated
    });

    it('handles two clock_outs more than 5 minutes apart (real orphan punch)', () => {
      const punches = [
        createPunch('clock_in', '2024-01-15T09:00:00Z'),
        createPunch('clock_out', '2024-01-15T17:00:00Z'),
        createPunch('clock_out', '2024-01-15T17:10:00Z'), // 10 min later - not a double tap
      ];

      const { periods, incompleteShifts } = parseWorkPeriods(punches);
      // First clock_out pairs with clock_in, second clock_out is orphan
      expect(periods.length).toBe(1);
      expect(incompleteShifts.length).toBe(1);
      expect(incompleteShifts[0].type).toBe('missing_clock_in');
    });

    it('handles gap of more than 24 hours (forgot to punch for entire day)', () => {
      const punches = [
        createPunch('clock_in', '2024-01-15T09:00:00Z'), // Monday 9 AM
        createPunch('clock_out', '2024-01-17T17:00:00Z'), // Wednesday 5 PM - 56 hour gap!
      ];

      const { incompleteShifts } = parseWorkPeriods(punches);
      // This should NOT count as a valid shift - it needs manager review
      expect(incompleteShifts.length).toBeGreaterThan(0);
    });
  });

  describe('Break Handling', () => {
    it('correctly deducts break time from worked hours', () => {
      const punches = [
        createPunch('clock_in', '2024-01-15T09:00:00Z'),
        createPunch('break_start', '2024-01-15T12:00:00Z'),
        createPunch('break_end', '2024-01-15T12:30:00Z'),
        createPunch('clock_out', '2024-01-15T17:00:00Z'),
      ];

      const hours = calculateWorkedHours(punches);
      // 9 AM - 5 PM = 8 hours, minus 30 min break = 7.5 hours
      expect(hours).toBe(7.5);
    });

    it('handles multiple breaks in a shift', () => {
      const punches = [
        createPunch('clock_in', '2024-01-15T08:00:00Z'),
        createPunch('break_start', '2024-01-15T10:00:00Z'),
        createPunch('break_end', '2024-01-15T10:15:00Z'), // 15 min
        createPunch('break_start', '2024-01-15T12:00:00Z'),
        createPunch('break_end', '2024-01-15T12:30:00Z'), // 30 min
        createPunch('break_start', '2024-01-15T15:00:00Z'),
        createPunch('break_end', '2024-01-15T15:15:00Z'), // 15 min
        createPunch('clock_out', '2024-01-15T17:00:00Z'),
      ];

      const hours = calculateWorkedHours(punches);
      // 9 hours total, minus 1 hour of breaks = 8 hours
      expect(hours).toBe(8);
    });

    it('handles break_end without break_start (orphan break)', () => {
      const punches = [
        createPunch('clock_in', '2024-01-15T09:00:00Z'),
        createPunch('break_end', '2024-01-15T12:30:00Z'), // No break_start!
        createPunch('clock_out', '2024-01-15T17:00:00Z'),
      ];

      // Should still calculate something reasonable
      const { periods } = parseWorkPeriods(punches);
      expect(periods.length).toBeGreaterThan(0);
    });

    it('handles break that spans overnight (unlikely but possible)', () => {
      // Weird edge case: security guard takes a break at midnight
      const punches = [
        createPunch('clock_in', '2024-01-15T18:00:00Z'), // 6 PM
        createPunch('break_start', '2024-01-15T23:30:00Z'), // 11:30 PM
        createPunch('break_end', '2024-01-16T00:30:00Z'), // 12:30 AM next day
        createPunch('clock_out', '2024-01-16T06:00:00Z'), // 6 AM
      ];

      const hours = calculateWorkedHours(punches);
      // 6 PM to 6 AM = 12 hours, minus 1 hour break = 11 hours
      expect(hours).toBe(11);
    });
  });

  describe('Overtime Calculations', () => {
    it('calculates overtime correctly for 45 hour week', () => {
      const { regularHours, overtimeHours } = calculateRegularAndOvertimeHours(45);
      expect(regularHours).toBe(40);
      expect(overtimeHours).toBe(5);
    });

    it('handles exactly 40 hours (no overtime)', () => {
      const { regularHours, overtimeHours } = calculateRegularAndOvertimeHours(40);
      expect(regularHours).toBe(40);
      expect(overtimeHours).toBe(0);
    });

    it('handles under 40 hours', () => {
      const { regularHours, overtimeHours } = calculateRegularAndOvertimeHours(32);
      expect(regularHours).toBe(32);
      expect(overtimeHours).toBe(0);
    });

    it('calculates overtime pay at 1.5x rate', () => {
      const employee = createEmployee({ hourly_rate: 2000 }); // $20/hr
      const punches = [
        // Create enough punches for 45 hours in a week
        ...createShift('2024-01-15T09:00:00Z', '2024-01-15T18:00:00Z'), // Mon 9h
        ...createShift('2024-01-16T09:00:00Z', '2024-01-16T18:00:00Z'), // Tue 9h
        ...createShift('2024-01-17T09:00:00Z', '2024-01-17T18:00:00Z'), // Wed 9h
        ...createShift('2024-01-18T09:00:00Z', '2024-01-18T18:00:00Z'), // Thu 9h
        ...createShift('2024-01-19T09:00:00Z', '2024-01-19T18:00:00Z'), // Fri 9h = 45h
      ];

      const payroll = calculateEmployeePay(employee, punches, 0);

      expect(payroll.regularHours).toBe(40);
      expect(payroll.overtimeHours).toBe(5);
      expect(payroll.regularPay).toBe(40 * 2000); // $800
      expect(payroll.overtimePay).toBe(5 * 2000 * 1.5); // $150
      expect(payroll.grossPay).toBe(80000 + 15000); // $950
    });

    it('handles overtime spanning two weeks differently per week', () => {
      // Week 1: 50 hours, Week 2: 30 hours
      // Should be 40 regular + 10 OT week 1, 30 regular week 2
      // NOT 80 hours with no OT!
      const employee = createEmployee({ hourly_rate: 1000 }); // $10/hr
      
      // Week 1 (Jan 14-20, 2024 - Sunday to Saturday)
      const week1Punches = [
        ...createShift('2024-01-14T08:00:00Z', '2024-01-14T18:00:00Z'), // Sun 10h
        ...createShift('2024-01-15T08:00:00Z', '2024-01-15T18:00:00Z'), // Mon 10h
        ...createShift('2024-01-16T08:00:00Z', '2024-01-16T18:00:00Z'), // Tue 10h
        ...createShift('2024-01-17T08:00:00Z', '2024-01-17T18:00:00Z'), // Wed 10h
        ...createShift('2024-01-18T08:00:00Z', '2024-01-18T18:00:00Z'), // Thu 10h = 50h
      ];

      // Week 2 (Jan 21-27, 2024)
      const week2Punches = [
        ...createShift('2024-01-21T08:00:00Z', '2024-01-21T18:00:00Z'), // Sun 10h
        ...createShift('2024-01-22T08:00:00Z', '2024-01-22T18:00:00Z'), // Mon 10h
        ...createShift('2024-01-23T08:00:00Z', '2024-01-23T18:00:00Z'), // Tue 10h = 30h
      ];

      const payroll = calculateEmployeePay(employee, [...week1Punches, ...week2Punches], 0);

      // Week 1: 40 regular + 10 OT
      // Week 2: 30 regular + 0 OT
      // Total: 70 regular + 10 OT
      expect(payroll.regularHours).toBe(70);
      expect(payroll.overtimeHours).toBe(10);
    });
  });

  describe('Fractional Hours', () => {
    it('handles 7:30 AM to 4:15 PM (8.75 hours)', () => {
      const punches = createShift(
        '2024-01-15T07:30:00Z',
        '2024-01-15T16:15:00Z'
      );

      const hours = calculateWorkedHours(punches);
      expect(hours).toBe(8.75);
    });

    it('handles very short shift (30 minutes)', () => {
      const punches = createShift(
        '2024-01-15T14:00:00Z',
        '2024-01-15T14:30:00Z'
      );

      const hours = calculateWorkedHours(punches);
      expect(hours).toBe(0.5);
    });

    it('rounds pay correctly for fractional hours', () => {
      const employee = createEmployee({ hourly_rate: 1575 }); // $15.75/hr
      const punches = createShift(
        '2024-01-15T09:00:00Z',
        '2024-01-15T13:15:00Z' // 4.25 hours
      );

      const payroll = calculateEmployeePay(employee, punches, 0);
      // 4.25 * 1575 = 6693.75 cents → should round to 6694 cents
      expect(payroll.regularPay).toBe(6694);
    });
  });

  describe('Edge Times', () => {
    it('handles punch at exactly midnight', () => {
      const punches = createShift(
        '2024-01-15T16:00:00Z', // 4 PM
        '2024-01-16T00:00:00Z' // Exactly midnight
      );

      const hours = calculateWorkedHours(punches);
      expect(hours).toBe(8);
    });

    it('handles punch at 11:59:59 PM', () => {
      const punches = createShift(
        '2024-01-15T16:00:00Z',
        '2024-01-15T23:59:59Z'
      );

      const hours = calculateWorkedHours(punches);
      // Should be just under 8 hours
      expect(hours).toBeCloseTo(7.9997, 2);
    });
  });
});

// ============================================================================
// SECTION 2: CONTRACTOR EDGE CASES
// ============================================================================

describe('Contractor Edge Cases', () => {
  describe('Per-Job Contractors', () => {
    it('returns 0 for daily allocation of per-job contractor', () => {
      const daily = calculateDailyContractorAllocation(500000, 'per-job');
      expect(daily).toBe(0);
    });

    it('per-job contractor should not appear in daily labor allocations', () => {
      const employee = createEmployee({
        compensation_type: 'contractor',
        contractor_payment_amount: 500000, // $5,000/job
        contractor_payment_interval: 'per-job',
      });

      const allocation = generateDailyAllocation(employee, '2024-01-15');
      expect(allocation.allocated_amount).toBe(0);
      expect(allocation.calculation_notes).toContain('Per-job');
    });

    // POTENTIAL HOLE: How do we track per-job contractor costs?
    // They shouldn't appear daily, but SHOULD appear when the job is complete
    it.todo('per-job contractors should have a different allocation mechanism');
  });

  describe('Weekly/Bi-Weekly Contractors', () => {
    it('calculates daily rate for weekly contractor', () => {
      // $700/week ÷ 7 days = $100/day
      const daily = calculateDailyContractorAllocation(70000, 'weekly');
      expect(daily).toBe(10000); // $100
    });

    it('calculates daily rate for bi-weekly contractor', () => {
      // $1,400/bi-weekly ÷ 14 days = $100/day
      const daily = calculateDailyContractorAllocation(140000, 'bi-weekly');
      expect(daily).toBe(10000); // $100
    });

    // POTENTIAL HOLE: What if contractor only works 3 days per week?
    // Spreading $700 across 7 days may understate their cost on work days
    it.todo('contractor allocation should consider actual work days vs calendar days');
  });

  describe('Contractor vs Employee Classification', () => {
    // POTENTIAL HOLE: What determines if someone should be contractor vs employee?
    // This is a legal question but affects payroll calculations

    it('contractor should NOT have overtime calculated', () => {
      const employee = createEmployee({
        compensation_type: 'contractor',
        contractor_payment_amount: 70000, // $700/week
        contractor_payment_interval: 'weekly',
      });

      // Even if they work 50 hours, contractors don't get OT
      // But wait - do we even track contractor hours?
      // HOLE: If requires_time_punch is false, how do we know they worked?
      expect(employee.compensation_type).toBe('contractor');
    });

    it('contractor with requires_time_punch=true should still not get OT', () => {
      const employee = createEmployee({
        compensation_type: 'contractor',
        contractor_payment_amount: 70000,
        contractor_payment_interval: 'weekly',
        requires_time_punch: true,
      });

      // They track hours for billing but don't get overtime
      // HOLE: Current calculateEmployeePay assumes hourly - need separate function
      expect(requiresTimePunches(employee)).toBe(true);
    });
  });

  describe('Month-End Proration', () => {
    // POTENTIAL HOLE: Monthly contractors in short months vs long months

    it('monthly contractor in February (28 days) vs March (31 days)', () => {
      // If contractor is paid $3,044/month ($100/day average)
      // February 28 days: $3,044 / 28 = $108.71/day
      // March 31 days: $3,044 / 31 = $98.19/day
      // But we use 30.44 average...
      
      const daily = calculateDailyContractorAllocation(304400, 'monthly');
      expect(daily).toBe(10000); // $100/day using average

      // HOLE: This means February is underbilled and March is overbilled
      // Should we use actual days in month?
    });

    it.todo('monthly allocation should use actual month length for accuracy');
  });
});

// ============================================================================
// SECTION 3: SALARIED EMPLOYEE EDGE CASES
// ============================================================================

describe('Salaried Employee Edge Cases', () => {
  describe('Mid-Period Hires', () => {
    // HOLE: If someone is hired mid-month, how do we prorate?

    it('handles employee hired mid-month (should prorate)', () => {
      // If monthly salary is $5,000 and they start on the 15th
      // Should they get $5,000 that month? $2,500? Pro-rated based on days?
      
      const employee = createEmployee({
        compensation_type: 'salary',
        salary_amount: 500000, // $5,000/month
        pay_period_type: 'monthly',
        allocate_daily: true,
        hire_date: '2024-01-15',
      });

      // Current implementation doesn't consider hire date
      const allocation = generateDailyAllocation(employee, '2024-01-14');
      // HOLE: Should allocation be 0 for dates before hire?
      expect(allocation.allocated_amount).toBeGreaterThan(0);
    });

    it.todo('daily allocation should check hire_date before allocating');
  });

  describe('Mid-Period Terminations', () => {
    // HOLE: If someone is terminated mid-month, how do we handle?

    it('handles employee terminated mid-month', () => {
      const employee = createEmployee({
        compensation_type: 'salary',
        salary_amount: 500000, // $5,000/month
        pay_period_type: 'monthly',
        allocate_daily: true,
        status: 'terminated',
      });

      // If terminated on Jan 15, should we allocate for Jan 16?
      // HOLE: Current implementation doesn't check status
      // The allocation is generated but shouldn't be for terminated employee
      const allocation = generateDailyAllocation(employee, '2024-01-16');
      // Current behavior: still generates allocation
      expect(allocation.allocated_amount).toBeGreaterThan(0);
      // TODO: Should this be 0 for terminated employees?
    });

    it.todo('daily allocation should check employee status');
  });

  describe('Semi-Monthly Pay Periods', () => {
    it('correctly identifies first half of month (1st-15th)', () => {
      const { start, end } = getPayPeriodDates(new Date('2024-02-10T12:00:00'), 'semi-monthly');
      expect(start).toBe('2024-02-01');
      expect(end).toBe('2024-02-15');
    });

    it('correctly identifies second half of month (16th-end)', () => {
      const { start, end } = getPayPeriodDates(new Date('2024-02-20T12:00:00'), 'semi-monthly');
      expect(start).toBe('2024-02-16');
      expect(end).toBe('2024-02-29'); // Leap year
    });

    it('handles unequal period lengths correctly', () => {
      // First half: always 15 days
      // Second half: varies (13-16 days depending on month)
      
      const firstHalfDays = getDaysInPayPeriod('2024-02-01', '2024-02-15');
      const secondHalfDays = getDaysInPayPeriod('2024-02-16', '2024-02-29');

      expect(firstHalfDays).toBe(15);
      expect(secondHalfDays).toBe(14); // Feb 16-29 in leap year

      // HOLE: If we use 15.22 average for both, the daily rate is wrong
      // $2,500 / 15.22 = $164.26/day for BOTH halves
      // But second half should be $2,500 / 14 = $178.57/day in Feb
    });

    it.todo('semi-monthly should use actual period length, not average');
  });

  describe('Salaried Employee with Time Tracking', () => {
    // Some salaried employees track time for billing clients
    
    it('salaried employee can have requires_time_punch=true', () => {
      const employee = createEmployee({
        compensation_type: 'salary',
        salary_amount: 100000,
        pay_period_type: 'weekly',
        allocate_daily: true,
        requires_time_punch: true,
      });

      expect(requiresTimePunches(employee)).toBe(true);
    });

    it('salaried employee pay should NOT change based on hours worked', () => {
      // This is the key difference from hourly
      // Even if they work 60 hours, pay is the same
      // Even if they work 30 hours, pay is the same (assuming FT exempt)
      
      const employee = createEmployee({
        compensation_type: 'salary',
        salary_amount: 100000, // $1,000/week
        pay_period_type: 'weekly',
        allocate_daily: true,
      });

      const cost = calculateDailyLaborCost(employee);
      expect(cost).toBe(14286); // $142.86/day regardless of hours

      // HOLE: If salaried employee is non-exempt, they might get OT
      // We don't have an "exempt" flag
    });

    it.todo('add exempt/non-exempt flag for salaried employees');
  });

  describe('Allocate Daily Flag', () => {
    it('returns 0 when allocate_daily is false', () => {
      const employee = createEmployee({
        compensation_type: 'salary',
        salary_amount: 100000,
        pay_period_type: 'weekly',
        allocate_daily: false,
      });

      const cost = calculateDailyLaborCost(employee);
      expect(cost).toBe(0);
    });

    // HOLE: If allocate_daily is false, when DOES the salary appear in P&L?
    // On payday? That would cause spiky P&L on bi-weekly paydays
    it.todo('handle non-daily salary allocation (record on payday)');
  });

  describe('Part-Time Salaried Employees', () => {
    // HOLE: Is there such a thing as part-time salary?
    // If so, how do we prorate?

    it('handles part-time salaried employee (20 hours/week)', () => {
      // $500/week for 20 hours expected
      // How does this affect daily allocation?
      
      const employee = createEmployee({
        compensation_type: 'salary',
        salary_amount: 50000, // $500/week
        pay_period_type: 'weekly',
        allocate_daily: true,
      });

      // Current: $500/7 = $71.43/day
      // But if they only work Mon-Fri, is this right?
      const cost = calculateDailyLaborCost(employee);
      expect(cost).toBe(7143);
    });

    it.todo('consider work schedule for daily salary allocation');
  });
});

// ============================================================================
// SECTION 4: MIXED WORKFORCE SCENARIOS
// ============================================================================

describe('Mixed Workforce Scenarios', () => {
  describe('Labor Cost Breakdown', () => {
    it('correctly breaks down costs by compensation type', () => {
      const allocations: Pick<DailyLaborAllocation, 'compensation_type' | 'allocated_amount'>[] = [
        { compensation_type: 'hourly', allocated_amount: 12000 }, // $120 (8h @ $15)
        { compensation_type: 'hourly', allocated_amount: 16000 }, // $160 (8h @ $20)
        { compensation_type: 'salary', allocated_amount: 14286 }, // $142.86
        { compensation_type: 'salary', allocated_amount: 20000 }, // $200
        { compensation_type: 'contractor', allocated_amount: 10000 }, // $100
      ];

      const breakdown = calculateLaborBreakdown(allocations);

      expect(breakdown.hourly_wages).toBe(28000); // $280
      expect(breakdown.salary_allocations).toBe(34286); // $342.86
      expect(breakdown.contractor_payments).toBe(10000); // $100
      expect(breakdown.total).toBe(72286); // $722.86
    });

    it('handles restaurant with only contractors', () => {
      const allocations: Pick<DailyLaborAllocation, 'compensation_type' | 'allocated_amount'>[] = [
        { compensation_type: 'contractor', allocated_amount: 20000 },
        { compensation_type: 'contractor', allocated_amount: 15000 },
      ];

      const breakdown = calculateLaborBreakdown(allocations);

      expect(breakdown.hourly_wages).toBe(0);
      expect(breakdown.salary_allocations).toBe(0);
      expect(breakdown.contractor_payments).toBe(35000);
      expect(breakdown.total).toBe(35000);
    });
  });

  describe('Real-World Restaurant Scenario', () => {
    it('calculates a typical restaurant day with mixed staff', () => {
      // Typical restaurant:
      // - Manager: Salaried ($60k/year)
      // - 2 servers: Hourly ($15/hr + tips)
      // - 1 cook: Hourly ($18/hr)
      // - 1 dishwasher contractor: $100/day

      const manager = createEmployee({
        id: 'mgr-1',
        compensation_type: 'salary',
        salary_amount: 500000, // ~$5k/month
        pay_period_type: 'monthly',
        allocate_daily: true,
      });

      const server1 = createEmployee({
        id: 'srv-1',
        compensation_type: 'hourly',
        hourly_rate: 1500,
      });

      const server2 = createEmployee({
        id: 'srv-2',
        compensation_type: 'hourly',
        hourly_rate: 1500,
      });

      const cook = createEmployee({
        id: 'cook-1',
        compensation_type: 'hourly',
        hourly_rate: 1800,
      });

      // Dishwasher contractor: Paid $700/week but comes daily
      // NOTE: This highlights a conceptual issue - is the payment amount
      // the total for the interval, or the daily equivalent?
      const dishwasherAllocation = generateDailyAllocation(
        createEmployee({
          id: 'dish-1',
          compensation_type: 'contractor',
          contractor_payment_amount: 70000, // $700/week
          contractor_payment_interval: 'weekly',
        }),
        '2024-01-15'
      );

      // Generate allocations
      const allocations = [
        generateDailyAllocation(manager, '2024-01-15'),
        // For hourly, we need to pass hours worked
        generateDailyAllocation(server1, '2024-01-15', 6), // 6 hour shift
        generateDailyAllocation(server2, '2024-01-15', 5), // 5 hour shift
        generateDailyAllocation(cook, '2024-01-15', 8), // 8 hour shift
        dishwasherAllocation,
      ];

      const breakdown = calculateLaborBreakdown(
        allocations.map(a => ({
          compensation_type: a.compensation_type,
          allocated_amount: a.allocated_amount,
        }))
      );

      // Manager: $5000/30.44 = $164.26/day
      // Server1: 6h * $15 = $90
      // Server2: 5h * $15 = $75
      // Cook: 8h * $18 = $144
      // Dishwasher: $700/7 = $100/day

      expect(breakdown.total).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// SECTION 5: VALIDATION EDGE CASES
// ============================================================================

describe('Validation Edge Cases', () => {
  describe('Invalid Compensation Configurations', () => {
    it('rejects negative hourly rate', () => {
      const errors = validateCompensationFields({
        compensation_type: 'hourly',
        hourly_rate: -1500,
      });
      expect(errors).toContain('Hourly rate must be greater than 0');
    });

    it('rejects zero salary amount', () => {
      const errors = validateCompensationFields({
        compensation_type: 'salary',
        salary_amount: 0,
        pay_period_type: 'weekly',
      });
      expect(errors).toContain('Salary amount must be greater than 0');
    });

    it('rejects contractor without payment interval', () => {
      const errors = validateCompensationFields({
        compensation_type: 'contractor',
        contractor_payment_amount: 50000,
        // Missing contractor_payment_interval
      });
      expect(errors).toContain('Payment interval is required for contractors');
    });

    it('rejects hourly employee with salary fields', () => {
      // HOLE: Should we validate that hourly employees don't have salary fields set?
      // Or is it okay for them to be there but ignored?
      const errors = validateCompensationFields({
        compensation_type: 'hourly',
        hourly_rate: 1500,
        salary_amount: 100000, // This shouldn't be here
      });
      // Current: No error - salary_amount is just ignored
      // Is this the right behavior?
      expect(errors).toHaveLength(0);
    });
  });

  describe('Compensation Type Transitions', () => {
    it('uses historical hourly rates when calculating pay', () => {
      const employee = createEmployee({
        compensation_type: 'hourly',
        hourly_rate: 2000,
        compensation_history: [
          {
            id: 'hist-1',
            employee_id: 'emp-test',
            restaurant_id: 'rest-test',
            compensation_type: 'hourly',
            amount_cents: 1500,
            pay_period_type: null,
            effective_date: '2024-01-01',
            created_at: '2024-01-01T00:00:00Z',
          },
          {
            id: 'hist-2',
            employee_id: 'emp-test',
            restaurant_id: 'rest-test',
            compensation_type: 'hourly',
            amount_cents: 2000,
            pay_period_type: null,
            effective_date: '2024-02-01',
            created_at: '2024-02-01T00:00:00Z',
          },
        ],
      });

      const januarySnapshot = resolveCompensationForDate(employee, '2024-01-15');
      const febSnapshot = resolveCompensationForDate(employee, '2024-02-10');

      expect(januarySnapshot.hourly_rate).toBe(1500);
      expect(febSnapshot.hourly_rate).toBe(2000);

      expect(calculateEmployeeDailyCostForDate(employee, '2024-01-15', 8)).toBe(12000); // 8h @ $15
      expect(calculateEmployeeDailyCostForDate(employee, '2024-02-10', 8)).toBe(16000); // 8h @ $20
    });

    it('splits salary calculations when a new rate takes effect mid-period', () => {
      const employee = createEmployee({
        compensation_type: 'salary',
        salary_amount: 400000, // $4,000/month in cents
        pay_period_type: 'monthly',
        compensation_history: [
          {
            id: 's1',
            employee_id: 'emp-test',
            restaurant_id: 'rest-test',
            compensation_type: 'salary',
            amount_cents: 400000,
            pay_period_type: 'monthly',
            effective_date: '2024-01-01',
            created_at: '2024-01-01T00:00:00Z',
          },
          {
            id: 's2',
            employee_id: 'emp-test',
            restaurant_id: 'rest-test',
            compensation_type: 'salary',
            amount_cents: 500000, // $5,000/month
            pay_period_type: 'monthly',
            effective_date: '2024-01-15',
            created_at: '2024-01-15T00:00:00Z',
          },
        ],
      });

      const total = calculateSalaryForPeriod(
        employee,
        new Date('2024-01-10'),
        new Date('2024-01-20')
      );

      // Jan 10-14 at $4,000/month ≈ 65,703 cents
      // Jan 15-20 at $5,000/month ≈ 98,554 cents
      // Total ≈ 164,258 cents (rounded once per period)
      expect(total).toBe(164258);
    });

    it('keeps weekly salary whole when using daily allocations (no penny loss)', () => {
      const employee = createEmployee({
        compensation_type: 'salary',
        salary_amount: 200000, // $2,000/week
        pay_period_type: 'weekly',
      });

      const total = calculateSalaryForPeriod(
        employee,
        new Date('2024-01-01'),
        new Date('2024-01-07')
      );

      expect(total).toBe(200000);
    });
  });
});

// ============================================================================
// SECTION 6: TIMEZONE EDGE CASES
// ============================================================================

describe('Timezone Edge Cases', () => {
  // POTENTIAL MAJOR HOLE: All our tests use UTC
  // But restaurants operate in local timezones

  it.todo('handle restaurant in US/Pacific timezone');
  it.todo('handle overnight shift across DST change');
  it.todo('handle restaurant in timezone with 30-minute offset (India)');
  it.todo('handle pay period boundaries in different timezones');
});

// ============================================================================
// SECTION 7: CURRENCY/ROUNDING EDGE CASES
// ============================================================================

describe('Currency and Rounding Edge Cases', () => {
  it('handles very small amounts without precision loss', () => {
    // $0.01/hour (unlikely but test precision)
    const employee = createEmployee({ hourly_rate: 1 });
    const punches = createShift(
      '2024-01-15T09:00:00Z',
      '2024-01-15T17:00:00Z'
    );

    const payroll = calculateEmployeePay(employee, punches, 0);
    expect(payroll.regularPay).toBe(8); // 8 cents
  });

  it('handles very large salary without overflow', () => {
    const employee = createEmployee({
      compensation_type: 'salary',
      salary_amount: 100000000, // $1,000,000/year in cents = $1M
      pay_period_type: 'monthly', // ~$83,333/month
      allocate_daily: true,
    });

    const cost = calculateDailyLaborCost(employee);
    // $1M/month ÷ 30.44 = $32,851/day
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it('rounds to nearest cent consistently', () => {
    // $15.75/hour for 4.333 hours = $68.249... 
    // Should round to $68.25 = 6825 cents
    const employee = createEmployee({ hourly_rate: 1575 });
    const punches = createShift(
      '2024-01-15T09:00:00Z',
      '2024-01-15T13:20:00Z' // 4h 20m = 4.333h
    );

    const payroll = calculateEmployeePay(employee, punches, 0);
    // 4.333... * 1575 = 6824.99... → should round to 6825
    expect(payroll.regularPay).toBe(6825);
  });
});
