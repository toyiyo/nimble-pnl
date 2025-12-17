/**
 * Tests for Compensation Calculations
 *
 * Tests for daily labor cost calculations for different compensation types:
 * - Hourly employees
 * - Salaried employees
 * - Contractors
 */

import { describe, it, expect } from 'vitest';
import {
  calculateDailySalaryAllocation,
  calculateEffectiveHourlyRate,
  calculateDailyContractorAllocation,
  calculateDailyLaborCost,
  calculateLaborBreakdown,
  validateCompensationFields,
  DAYS_PER_PAY_PERIOD,
  DAYS_PER_CONTRACTOR_INTERVAL,
  getPayPeriodDates,
  getDaysInPayPeriod,
  generateDailyAllocation,
  formatCompensationType,
  formatPayPeriodType,
  formatContractorInterval,
  requiresTimePunches,
  calculateSalaryForPeriod,
  calculateContractorPayForPeriod,
} from '@/utils/compensationCalculations';
import type { Employee, CompensationType, DailyLaborAllocation } from '@/types/scheduling';

// ============================================================================
// Helper Functions
// ============================================================================

function createMockEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 'emp-1',
    restaurant_id: 'rest-1',
    name: 'Test Employee',
    position: 'Server',
    status: 'active',
    compensation_type: 'hourly',
    hourly_rate: 1500, // $15.00/hr
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

// ============================================================================
// Salary Calculations
// ============================================================================

describe('calculateDailySalaryAllocation', () => {
  it('calculates weekly salary correctly', () => {
    // $1,000/week ÷ 7 days = $142.86/day
    const daily = calculateDailySalaryAllocation(100000, 'weekly');
    expect(daily).toBe(14286); // 14285.71 rounded to 14286
  });

  it('calculates bi-weekly salary correctly', () => {
    // $2,000/bi-weekly ÷ 14 days = $142.86/day
    const daily = calculateDailySalaryAllocation(200000, 'bi-weekly');
    expect(daily).toBe(14286);
  });

  it('calculates monthly salary correctly', () => {
    // $5,000/month ÷ 30.44 days = ~$164.26/day
    const daily = calculateDailySalaryAllocation(500000, 'monthly');
    expect(daily).toBe(16426); // Actual: 500000 / 30.44 = 16425.76 → 16426
  });

  it('calculates semi-monthly salary correctly', () => {
    // $2,500/semi-monthly ÷ 15.22 days = ~$164.26/day
    const daily = calculateDailySalaryAllocation(250000, 'semi-monthly');
    expect(daily).toBe(16426); // Actual: 250000 / 15.22 = 16425.76 → 16426
  });

  it('handles small salaries without losing precision', () => {
    // $100/week ÷ 7 days = $14.29/day
    const daily = calculateDailySalaryAllocation(10000, 'weekly');
    expect(daily).toBe(1429);
  });
});

describe('calculateEffectiveHourlyRate', () => {
  it('calculates effective rate from weekly salary', () => {
    // $1,000/week @ 40 hrs/week = $25/hr
    const hourly = calculateEffectiveHourlyRate(100000, 'weekly', 40);
    expect(hourly).toBe(2500);
  });

  it('calculates effective rate from monthly salary', () => {
    // $5,000/month @ 40 hrs/week = $28.85/hr (5000*12 / 2080)
    const hourly = calculateEffectiveHourlyRate(500000, 'monthly', 40);
    expect(hourly).toBe(2885);
  });

  it('handles non-standard work weeks', () => {
    // $5,000/month @ 50 hrs/week = $23.08/hr (5000*12 / 2600)
    const hourly = calculateEffectiveHourlyRate(500000, 'monthly', 50);
    expect(hourly).toBe(2308);
  });

  it('uses 40 hours as default', () => {
    const hourly = calculateEffectiveHourlyRate(100000, 'weekly');
    expect(hourly).toBe(2500);
  });
});

describe('getPayPeriodDates', () => {
  it('calculates weekly period correctly', () => {
    // Note: Date parsing is timezone-dependent
    // Jan 15, 2024 is a Monday, so week starts Mon Jan 15 with payPeriodStartDay=1
    const { start, end } = getPayPeriodDates(new Date('2024-01-15T12:00:00'), 'weekly', 1);
    expect(start).toBe('2024-01-15'); // Monday
    expect(end).toBe('2024-01-21'); // Sunday
  });

  it('calculates semi-monthly period correctly (first half)', () => {
    const { start, end } = getPayPeriodDates(new Date('2024-02-10T12:00:00'), 'semi-monthly');
    expect(start).toBe('2024-02-01');
    expect(end).toBe('2024-02-15');
  });

  it('calculates semi-monthly period correctly (second half)', () => {
    const { start, end } = getPayPeriodDates(new Date('2024-02-20T12:00:00'), 'semi-monthly');
    expect(start).toBe('2024-02-16');
    expect(end).toBe('2024-02-29'); // 2024 is a leap year
  });

  it('calculates monthly period correctly', () => {
    const { start, end } = getPayPeriodDates(new Date('2024-02-15'), 'monthly');
    expect(start).toBe('2024-02-01');
    expect(end).toBe('2024-02-29'); // 2024 is a leap year
  });
});

describe('getDaysInPayPeriod', () => {
  it('calculates days in a week', () => {
    const days = getDaysInPayPeriod('2024-01-14', '2024-01-20');
    expect(days).toBe(7);
  });

  it('calculates days in February (leap year)', () => {
    const days = getDaysInPayPeriod('2024-02-01', '2024-02-29');
    expect(days).toBe(29);
  });

  it('calculates days in a single day period', () => {
    const days = getDaysInPayPeriod('2024-01-15', '2024-01-15');
    expect(days).toBe(1);
  });
});

// ============================================================================
// Contractor Calculations
// ============================================================================

describe('calculateDailyContractorAllocation', () => {
  it('calculates weekly rate correctly', () => {
    // $700/week ÷ 7 days = $100/day
    const daily = calculateDailyContractorAllocation(70000, 'weekly');
    expect(daily).toBe(10000);
  });

  it('calculates bi-weekly rate correctly', () => {
    // $1,400/bi-weekly ÷ 14 days = $100/day
    const daily = calculateDailyContractorAllocation(140000, 'bi-weekly');
    expect(daily).toBe(10000);
  });

  it('calculates monthly rate correctly', () => {
    // $3,044/month ÷ 30.44 days = $100/day
    const daily = calculateDailyContractorAllocation(304400, 'monthly');
    expect(daily).toBe(10000);
  });

  it('returns 0 for per-job contractors', () => {
    // Per-job contractors are not allocated daily
    const daily = calculateDailyContractorAllocation(100000, 'per-job');
    expect(daily).toBe(0);
  });
});

// ============================================================================
// Unified Labor Cost Calculations
// ============================================================================

describe('calculateDailyLaborCost', () => {
  it('calculates hourly employee cost correctly', () => {
    const employee = createMockEmployee({
      compensation_type: 'hourly',
      hourly_rate: 1500, // $15/hr
    });
    const cost = calculateDailyLaborCost(employee, 8);
    expect(cost).toBe(12000); // 8 hrs × $15 = $120
  });

  it('throws error for hourly employee without hours', () => {
    const employee = createMockEmployee({ compensation_type: 'hourly' });
    expect(() => calculateDailyLaborCost(employee)).toThrow(
      'Hours worked required for hourly employees'
    );
  });

  it('calculates salary allocation when flag is true', () => {
    const employee = createMockEmployee({
      compensation_type: 'salary',
      salary_amount: 100000, // $1,000/week
      pay_period_type: 'weekly',
      allocate_daily: true,
    });
    const cost = calculateDailyLaborCost(employee);
    expect(cost).toBe(14286); // $1,000 ÷ 7 = $142.86
  });

  it('returns 0 for salary when allocate_daily is false', () => {
    const employee = createMockEmployee({
      compensation_type: 'salary',
      salary_amount: 100000,
      pay_period_type: 'weekly',
      allocate_daily: false,
    });
    const cost = calculateDailyLaborCost(employee);
    expect(cost).toBe(0);
  });

  it('throws error for salary employee without required fields', () => {
    const employee = createMockEmployee({
      compensation_type: 'salary',
      allocate_daily: true,
    });
    expect(() => calculateDailyLaborCost(employee)).toThrow(
      'Salary amount and pay period required'
    );
  });

  it('calculates contractor allocation correctly', () => {
    const employee = createMockEmployee({
      compensation_type: 'contractor',
      contractor_payment_amount: 70000, // $700/week
      contractor_payment_interval: 'weekly',
    });
    const cost = calculateDailyLaborCost(employee);
    expect(cost).toBe(10000); // $700 ÷ 7 = $100
  });
});

describe('generateDailyAllocation', () => {
  it('generates allocation for hourly employee', () => {
    const employee = createMockEmployee({
      compensation_type: 'hourly',
      hourly_rate: 1500,
    });
    const allocation = generateDailyAllocation(employee, '2024-01-15', 8);

    expect(allocation.employee_id).toBe('emp-1');
    expect(allocation.date).toBe('2024-01-15');
    expect(allocation.compensation_type).toBe('hourly');
    expect(allocation.allocated_amount).toBe(12000);
    expect(allocation.calculation_notes).toBe('8 hrs × $15.00/hr');
  });

  it('generates allocation for salary employee with pay period info', () => {
    const employee = createMockEmployee({
      compensation_type: 'salary',
      salary_amount: 100000,
      pay_period_type: 'weekly',
      allocate_daily: true,
    });
    const allocation = generateDailyAllocation(employee, '2024-01-15');

    expect(allocation.compensation_type).toBe('salary');
    expect(allocation.allocated_amount).toBe(14286);
    expect(allocation.calculation_notes).toContain('$1000.00/weekly');
    expect(allocation.source_pay_period_start).toBeDefined();
    expect(allocation.source_pay_period_end).toBeDefined();
  });

  it('generates allocation for contractor', () => {
    const employee = createMockEmployee({
      compensation_type: 'contractor',
      contractor_payment_amount: 70000,
      contractor_payment_interval: 'weekly',
    });
    const allocation = generateDailyAllocation(employee, '2024-01-15');

    expect(allocation.compensation_type).toBe('contractor');
    expect(allocation.allocated_amount).toBe(10000);
    expect(allocation.calculation_notes).toContain('$700.00/weekly');
  });
});

describe('calculateLaborBreakdown', () => {
  it('calculates breakdown from mixed allocations', () => {
    const allocations: Pick<DailyLaborAllocation, 'compensation_type' | 'allocated_amount'>[] = [
      { compensation_type: 'hourly', allocated_amount: 12000 },
      { compensation_type: 'hourly', allocated_amount: 10000 },
      { compensation_type: 'salary', allocated_amount: 14286 },
      { compensation_type: 'contractor', allocated_amount: 10000 },
    ];

    const breakdown = calculateLaborBreakdown(allocations);

    expect(breakdown.hourly_wages).toBe(22000);
    expect(breakdown.salary_allocations).toBe(14286);
    expect(breakdown.contractor_payments).toBe(10000);
    expect(breakdown.total).toBe(46286);
  });

  it('handles empty allocations', () => {
    const breakdown = calculateLaborBreakdown([]);

    expect(breakdown.hourly_wages).toBe(0);
    expect(breakdown.salary_allocations).toBe(0);
    expect(breakdown.contractor_payments).toBe(0);
    expect(breakdown.total).toBe(0);
  });

  it('handles single type allocations', () => {
    const allocations = [
      { compensation_type: 'hourly' as CompensationType, allocated_amount: 15000 },
    ];

    const breakdown = calculateLaborBreakdown(allocations);

    expect(breakdown.hourly_wages).toBe(15000);
    expect(breakdown.salary_allocations).toBe(0);
    expect(breakdown.contractor_payments).toBe(0);
    expect(breakdown.total).toBe(15000);
  });
});

// ============================================================================
// Validation
// ============================================================================

describe('validateCompensationFields', () => {
  it('validates hourly employee correctly', () => {
    const errors = validateCompensationFields({
      compensation_type: 'hourly',
      hourly_rate: 1500,
    });
    expect(errors).toHaveLength(0);
  });

  it('requires hourly rate for hourly employees', () => {
    const errors = validateCompensationFields({
      compensation_type: 'hourly',
      hourly_rate: 0,
    });
    expect(errors).toContain('Hourly rate must be greater than 0');
  });

  it('validates salary employee correctly', () => {
    const errors = validateCompensationFields({
      compensation_type: 'salary',
      salary_amount: 100000,
      pay_period_type: 'weekly',
    });
    expect(errors).toHaveLength(0);
  });

  it('requires salary amount for salary employees', () => {
    const errors = validateCompensationFields({
      compensation_type: 'salary',
      pay_period_type: 'weekly',
    });
    expect(errors).toContain('Salary amount must be greater than 0');
  });

  it('requires pay period type for salary employees', () => {
    const errors = validateCompensationFields({
      compensation_type: 'salary',
      salary_amount: 100000,
    });
    expect(errors).toContain('Pay period type is required for salaried employees');
  });

  it('validates contractor correctly', () => {
    const errors = validateCompensationFields({
      compensation_type: 'contractor',
      contractor_payment_amount: 50000,
      contractor_payment_interval: 'weekly',
    });
    expect(errors).toHaveLength(0);
  });

  it('requires payment amount for contractors', () => {
    const errors = validateCompensationFields({
      compensation_type: 'contractor',
      contractor_payment_interval: 'weekly',
    });
    expect(errors).toContain('Payment amount must be greater than 0');
  });

  it('requires compensation type', () => {
    const errors = validateCompensationFields({});
    expect(errors).toContain('Compensation type is required');
  });
});

describe('requiresTimePunches', () => {
  it('returns explicit value when set', () => {
    const employee = createMockEmployee({
      compensation_type: 'salary',
      requires_time_punch: true,
    });
    expect(requiresTimePunches(employee)).toBe(true);
  });

  it('defaults to true for hourly employees', () => {
    const employee = createMockEmployee({
      compensation_type: 'hourly',
      requires_time_punch: undefined,
    });
    expect(requiresTimePunches(employee)).toBe(true);
  });

  it('defaults to false for salary employees', () => {
    const employee = createMockEmployee({
      compensation_type: 'salary',
      requires_time_punch: undefined,
    });
    expect(requiresTimePunches(employee)).toBe(false);
  });

  it('defaults to false for contractors', () => {
    const employee = createMockEmployee({
      compensation_type: 'contractor',
      requires_time_punch: undefined,
    });
    expect(requiresTimePunches(employee)).toBe(false);
  });
});

// ============================================================================
// Formatting
// ============================================================================

describe('format functions', () => {
  it('formats compensation types', () => {
    expect(formatCompensationType('hourly')).toBe('Hourly');
    expect(formatCompensationType('salary')).toBe('Salaried');
    expect(formatCompensationType('contractor')).toBe('Contractor');
  });

  it('formats pay period types', () => {
    expect(formatPayPeriodType('weekly')).toBe('Weekly');
    expect(formatPayPeriodType('bi-weekly')).toBe('Bi-Weekly');
    expect(formatPayPeriodType('semi-monthly')).toBe('Semi-Monthly');
    expect(formatPayPeriodType('monthly')).toBe('Monthly');
  });

  it('formats contractor intervals', () => {
    expect(formatContractorInterval('weekly')).toBe('Weekly');
    expect(formatContractorInterval('bi-weekly')).toBe('Bi-Weekly');
    expect(formatContractorInterval('monthly')).toBe('Monthly');
    expect(formatContractorInterval('per-job')).toBe('Per Job');
  });
});

// ============================================================================
// Constants Validation
// ============================================================================

describe('constants', () => {
  it('has correct days per pay period', () => {
    expect(DAYS_PER_PAY_PERIOD.weekly).toBe(7);
    expect(DAYS_PER_PAY_PERIOD['bi-weekly']).toBe(14);
    expect(DAYS_PER_PAY_PERIOD['semi-monthly']).toBeCloseTo(15.22, 1);
    expect(DAYS_PER_PAY_PERIOD.monthly).toBeCloseTo(30.44, 1);
  });

  it('has correct days per contractor interval', () => {
    expect(DAYS_PER_CONTRACTOR_INTERVAL.weekly).toBe(7);
    expect(DAYS_PER_CONTRACTOR_INTERVAL['bi-weekly']).toBe(14);
    expect(DAYS_PER_CONTRACTOR_INTERVAL.monthly).toBeCloseTo(30.44, 1);
  });
});

// ============================================================================
// Payroll Period Calculations for Non-Hourly Employees
// ============================================================================

describe('calculateSalaryForPeriod', () => {
  it('calculates full weekly salary when period is exactly one week', () => {
    // Employee with $1,000/week salary
    const employee = createMockEmployee({
      compensation_type: 'salary',
      salary_amount: 100000, // $1,000 per week
      pay_period_type: 'weekly',
    });
    
    const startDate = new Date('2024-12-01'); // Sunday
    const endDate = new Date('2024-12-07'); // Saturday (7 days)
    
    const pay = calculateSalaryForPeriod(employee, startDate, endDate);
    
    // 7 days * daily rate (which is rounded) = approximately $1,000
    // Daily rate = 100000 / 7 = 14286 (rounded)
    // 7 * 14286 = 100002 (slight rounding difference)
    const dailyRate = calculateDailySalaryAllocation(100000, 'weekly');
    // Allow 2 cent tolerance for rounding
    expect(Math.abs(pay - dailyRate * 7)).toBeLessThanOrEqual(2);
  });
  
  it('calculates prorated salary for partial week', () => {
    const employee = createMockEmployee({
      compensation_type: 'salary',
      salary_amount: 100000, // $1,000 per week
      pay_period_type: 'weekly',
    });
    
    const startDate = new Date('2024-12-01');
    const endDate = new Date('2024-12-03'); // 3 days
    
    const pay = calculateSalaryForPeriod(employee, startDate, endDate);
    
    // 3 days * daily rate
    const dailyRate = calculateDailySalaryAllocation(100000, 'weekly');
    // Allow 1 cent tolerance for rounding
    expect(Math.abs(pay - dailyRate * 3)).toBeLessThanOrEqual(1);
  });
  
  it('calculates bi-weekly salary correctly for one week', () => {
    const employee = createMockEmployee({
      compensation_type: 'salary',
      salary_amount: 200000, // $2,000 per bi-weekly
      pay_period_type: 'bi-weekly',
    });
    
    const startDate = new Date('2024-12-01');
    const endDate = new Date('2024-12-07'); // 7 days
    
    const pay = calculateSalaryForPeriod(employee, startDate, endDate);
    
    // 7 days * daily rate
    const dailyRate = calculateDailySalaryAllocation(200000, 'bi-weekly');
    // Allow 2 cent tolerance for rounding
    expect(Math.abs(pay - dailyRate * 7)).toBeLessThanOrEqual(2);
  });
  
  it('calculates monthly salary prorated for one week', () => {
    const employee = createMockEmployee({
      compensation_type: 'salary',
      salary_amount: 500000, // $5,000 per month
      pay_period_type: 'monthly',
    });
    
    const startDate = new Date('2024-12-01');
    const endDate = new Date('2024-12-07'); // 7 days
    
    const pay = calculateSalaryForPeriod(employee, startDate, endDate);
    
    // 7 days * daily rate (uses the same rounding as the function)
    const dailyRate = calculateDailySalaryAllocation(500000, 'monthly');
    // Allow 2 cent tolerance for rounding
    expect(Math.abs(pay - dailyRate * 7)).toBeLessThanOrEqual(2);
  });
  
  it('returns 0 for non-salary employees', () => {
    const employee = createMockEmployee({
      compensation_type: 'hourly',
      hourly_rate: 1500,
    });
    
    const startDate = new Date('2024-12-01');
    const endDate = new Date('2024-12-07');
    
    const pay = calculateSalaryForPeriod(employee, startDate, endDate);
    
    expect(pay).toBe(0);
  });
  
  it('returns 0 when salary_amount is missing', () => {
    const employee = createMockEmployee({
      compensation_type: 'salary',
      salary_amount: undefined,
      pay_period_type: 'weekly',
    });
    
    const startDate = new Date('2024-12-01');
    const endDate = new Date('2024-12-07');
    
    const pay = calculateSalaryForPeriod(employee, startDate, endDate);
    
    expect(pay).toBe(0);
  });
});

describe('calculateContractorPayForPeriod', () => {
  it('calculates full monthly contractor pay for a month', () => {
    const employee = createMockEmployee({
      compensation_type: 'contractor',
      contractor_payment_amount: 300000, // $3,000 per month
      contractor_payment_interval: 'monthly',
    });
    
    // Approx 30 days
    const startDate = new Date('2024-12-01');
    const endDate = new Date('2024-12-30'); // 30 days
    
    const pay = calculateContractorPayForPeriod(employee, startDate, endDate);
    
    // 30 days * daily rate (uses same rounding as function)
    const dailyRate = calculateDailyContractorAllocation(300000, 'monthly');
    expect(pay).toBe(dailyRate * 30);
  });
  
  it('calculates weekly contractor pay for one week', () => {
    const employee = createMockEmployee({
      compensation_type: 'contractor',
      contractor_payment_amount: 100000, // $1,000 per week
      contractor_payment_interval: 'weekly',
    });
    
    const startDate = new Date('2024-12-01');
    const endDate = new Date('2024-12-07'); // 7 days
    
    const pay = calculateContractorPayForPeriod(employee, startDate, endDate);
    
    // 7 days * daily rate
    const dailyRate = calculateDailyContractorAllocation(100000, 'weekly');
    expect(pay).toBe(dailyRate * 7);
  });
  
  it('returns 0 for non-contractor employees', () => {
    const employee = createMockEmployee({
      compensation_type: 'hourly',
      hourly_rate: 1500,
    });
    
    const startDate = new Date('2024-12-01');
    const endDate = new Date('2024-12-07');
    
    const pay = calculateContractorPayForPeriod(employee, startDate, endDate);
    
    expect(pay).toBe(0);
  });
});

// ============================================================================
// Hire Date Handling
// ============================================================================

describe('calculateSalaryForPeriod - hire date handling', () => {
  it('calculates salary only from hire date if hired mid-period', () => {
    // Employee hired on Dec 4, payroll period is Dec 1-7
    // Should only get paid for Dec 4-7 (4 days), not full week
    const employee = createMockEmployee({
      compensation_type: 'salary',
      salary_amount: 100000, // $1,000 per week
      pay_period_type: 'weekly',
      hire_date: '2024-12-04', // Hired on Wed
    });
    
    const startDate = new Date('2024-12-01'); // Sunday
    const endDate = new Date('2024-12-07'); // Saturday
    
    const pay = calculateSalaryForPeriod(employee, startDate, endDate);
    
    // Only 4 days (Dec 4-7) * daily rate
    const dailyRate = calculateDailySalaryAllocation(100000, 'weekly');
    // Allow 1 cent tolerance for rounding
    expect(Math.abs(pay - dailyRate * 4)).toBeLessThanOrEqual(1);
  });
  
  it('calculates full salary if hired before period start', () => {
    const employee = createMockEmployee({
      compensation_type: 'salary',
      salary_amount: 100000,
      pay_period_type: 'weekly',
      hire_date: '2024-01-01', // Hired long ago
    });
    
    const startDate = new Date('2024-12-01');
    const endDate = new Date('2024-12-07');
    
    const pay = calculateSalaryForPeriod(employee, startDate, endDate);
    
    // Full 7 days
    const dailyRate = calculateDailySalaryAllocation(100000, 'weekly');
    // Allow 2 cent tolerance for rounding
    expect(Math.abs(pay - dailyRate * 7)).toBeLessThanOrEqual(2);
  });
  
  it('returns 0 if hired after period ends', () => {
    const employee = createMockEmployee({
      compensation_type: 'salary',
      salary_amount: 100000,
      pay_period_type: 'weekly',
      hire_date: '2024-12-15', // Hired after period
    });
    
    const startDate = new Date('2024-12-01');
    const endDate = new Date('2024-12-07');
    
    const pay = calculateSalaryForPeriod(employee, startDate, endDate);
    
    expect(pay).toBe(0);
  });
  
  it('handles no hire date by using full period', () => {
    const employee = createMockEmployee({
      compensation_type: 'salary',
      salary_amount: 100000,
      pay_period_type: 'weekly',
      hire_date: undefined,
    });
    
    const startDate = new Date('2024-12-01');
    const endDate = new Date('2024-12-07');
    
    const pay = calculateSalaryForPeriod(employee, startDate, endDate);
    
    // Full 7 days when no hire date
    const dailyRate = calculateDailySalaryAllocation(100000, 'weekly');
    // Allow 2 cent tolerance for rounding
    expect(Math.abs(pay - dailyRate * 7)).toBeLessThanOrEqual(2);
  });
});

describe('calculateContractorPayForPeriod - hire date handling', () => {
  it('calculates contractor pay only from hire date if hired mid-period', () => {
    const employee = createMockEmployee({
      compensation_type: 'contractor',
      contractor_payment_amount: 100000, // $1,000 per week
      contractor_payment_interval: 'weekly',
      hire_date: '2024-12-04', // Hired on Wed
    });
    
    const startDate = new Date('2024-12-01');
    const endDate = new Date('2024-12-07');
    
    const pay = calculateContractorPayForPeriod(employee, startDate, endDate);
    
    // Only 4 days (Dec 4-7) * daily rate
    const dailyRate = calculateDailyContractorAllocation(100000, 'weekly');
    expect(pay).toBe(dailyRate * 4);
  });
  
  it('returns 0 if contractor hired after period ends', () => {
    const employee = createMockEmployee({
      compensation_type: 'contractor',
      contractor_payment_amount: 100000,
      contractor_payment_interval: 'weekly',
      hire_date: '2024-12-15',
    });
    
    const startDate = new Date('2024-12-01');
    const endDate = new Date('2024-12-07');
    
    const pay = calculateContractorPayForPeriod(employee, startDate, endDate);
    
    expect(pay).toBe(0);
  });
});

// ============================================================================
// Per-Job Contractor Manual Payments
// ============================================================================

describe('Per-Job Contractor Payment Utilities', () => {
  describe('createManualContractorPayment', () => {
    it('creates a valid manual payment record for per-job contractor', async () => {
      const { createManualContractorPayment } = await import('@/utils/compensationCalculations');
      
      const payment = createManualContractorPayment({
        employeeId: 'emp-123',
        restaurantId: 'rest-456',
        date: '2024-12-15',
        amount: 50000, // $500
        description: 'Completed catering event',
      });
      
      expect(payment).toEqual({
        employee_id: 'emp-123',
        restaurant_id: 'rest-456',
        date: '2024-12-15',
        allocated_cost: 50000,
        compensation_type: 'contractor',
        source: 'per-job',
        notes: 'Completed catering event',
      });
    });

    it('validates required fields', async () => {
      const { createManualContractorPayment } = await import('@/utils/compensationCalculations');
      
      expect(() => createManualContractorPayment({
        employeeId: '',
        restaurantId: 'rest-456',
        date: '2024-12-15',
        amount: 50000,
      })).toThrow('Employee ID is required');
      
      expect(() => createManualContractorPayment({
        employeeId: 'emp-123',
        restaurantId: '',
        date: '2024-12-15',
        amount: 50000,
      })).toThrow('Restaurant ID is required');
    });

    it('validates amount is positive', async () => {
      const { createManualContractorPayment } = await import('@/utils/compensationCalculations');
      
      expect(() => createManualContractorPayment({
        employeeId: 'emp-123',
        restaurantId: 'rest-456',
        date: '2024-12-15',
        amount: 0,
      })).toThrow('Amount must be positive');
      
      expect(() => createManualContractorPayment({
        employeeId: 'emp-123',
        restaurantId: 'rest-456',
        date: '2024-12-15',
        amount: -100,
      })).toThrow('Amount must be positive');
    });

    it('validates date format', async () => {
      const { createManualContractorPayment } = await import('@/utils/compensationCalculations');
      
      expect(() => createManualContractorPayment({
        employeeId: 'emp-123',
        restaurantId: 'rest-456',
        date: 'invalid-date',
        amount: 50000,
      })).toThrow('Invalid date format');
    });
  });

  describe('calculateTotalManualPayments', () => {
    it('sums manual payments for a contractor in a period', async () => {
      const { calculateTotalManualPayments } = await import('@/utils/compensationCalculations');
      
      const payments = [
        { allocated_cost: 50000, date: '2024-12-01', source: 'per-job' },
        { allocated_cost: 75000, date: '2024-12-10', source: 'per-job' },
        { allocated_cost: 30000, date: '2024-12-15', source: 'per-job' },
      ];
      
      const total = calculateTotalManualPayments(payments);
      
      expect(total).toBe(155000); // $1,550
    });

    it('handles empty payments array', async () => {
      const { calculateTotalManualPayments } = await import('@/utils/compensationCalculations');
      
      const total = calculateTotalManualPayments([]);
      
      expect(total).toBe(0);
    });

    it('only sums per-job and manual source payments', async () => {
      const { calculateTotalManualPayments } = await import('@/utils/compensationCalculations');
      
      const payments = [
        { allocated_cost: 50000, date: '2024-12-01', source: 'per-job' },
        { allocated_cost: 75000, date: '2024-12-10', source: 'auto' }, // Should be excluded
        { allocated_cost: 30000, date: '2024-12-15', source: 'manual' },
      ];
      
      const total = calculateTotalManualPayments(payments);
      
      expect(total).toBe(80000); // $500 + $300 (excludes $750 auto)
    });
  });

  describe('isPerJobContractor', () => {
    it('returns true for per-job contractors', async () => {
      const { isPerJobContractor } = await import('@/utils/compensationCalculations');
      
      const employee = createMockEmployee({
        compensation_type: 'contractor',
        contractor_payment_interval: 'per-job',
      });
      
      expect(isPerJobContractor(employee)).toBe(true);
    });

    it('returns false for weekly contractors', async () => {
      const { isPerJobContractor } = await import('@/utils/compensationCalculations');
      
      const employee = createMockEmployee({
        compensation_type: 'contractor',
        contractor_payment_interval: 'weekly',
      });
      
      expect(isPerJobContractor(employee)).toBe(false);
    });

    it('returns false for hourly employees', async () => {
      const { isPerJobContractor } = await import('@/utils/compensationCalculations');
      
      const employee = createMockEmployee({
        compensation_type: 'hourly',
      });
      
      expect(isPerJobContractor(employee)).toBe(false);
    });

    it('returns false for salaried employees', async () => {
      const { isPerJobContractor } = await import('@/utils/compensationCalculations');
      
      const employee = createMockEmployee({
        compensation_type: 'salary',
      });
      
      expect(isPerJobContractor(employee)).toBe(false);
    });
  });
});


