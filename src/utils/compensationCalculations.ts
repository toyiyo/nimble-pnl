/**
 * Compensation Calculations Utilities
 *
 * Functions for calculating daily labor costs for different compensation types:
 * - Hourly employees: hours worked × hourly rate
 * - Salaried employees: salary ÷ days in pay period
 * - Contractors: payment amount ÷ days in interval (or per project)
 *
 * All monetary values are in CENTS to avoid floating point issues.
 */

import type {
  Employee,
  CompensationType,
  PayPeriodType,
  ContractorPaymentInterval,
  DailyLaborAllocation,
  LaborCostBreakdown,
  CompensationSummary,
} from '@/types/scheduling';

// ============================================================================
// Constants
// ============================================================================

/** Average days per pay period type (for salary allocation) */
export const DAYS_PER_PAY_PERIOD: Record<PayPeriodType, number> = {
  weekly: 7,
  'bi-weekly': 14,
  'semi-monthly': 15.22, // Average days per semi-monthly period (365.25 / 24)
  monthly: 30.44, // Average days per month (365.25 / 12)
};

/** Average days per contractor payment interval */
export const DAYS_PER_CONTRACTOR_INTERVAL: Record<
  Exclude<ContractorPaymentInterval, 'per-job'>,
  number
> = {
  weekly: 7,
  'bi-weekly': 14,
  monthly: 30.44,
};

// ============================================================================
// Salary Calculations
// ============================================================================

/**
 * Calculate the daily allocation for a salaried employee
 *
 * @param salaryAmount - The salary amount in cents (per pay period)
 * @param payPeriodType - How often the employee is paid
 * @returns Daily allocation in cents (rounded to nearest cent)
 *
 * @example
 * // Weekly salary of $1,000 = $142.86/day
 * calculateDailySalaryAllocation(100000, 'weekly') // Returns 14286
 */
export function calculateDailySalaryAllocation(
  salaryAmount: number,
  payPeriodType: PayPeriodType
): number {
  const daysInPeriod = DAYS_PER_PAY_PERIOD[payPeriodType];
  return Math.round(salaryAmount / daysInPeriod);
}

/**
 * Calculate the effective hourly rate for a salaried employee
 * Useful for comparison and reporting
 *
 * @param salaryAmount - The salary amount in cents (per pay period)
 * @param payPeriodType - How often the employee is paid
 * @param hoursPerWeek - Expected hours worked per week (default: 40)
 * @returns Effective hourly rate in cents
 *
 * @example
 * // Weekly salary of $1,000 working 40 hrs/week = $25/hour
 * calculateEffectiveHourlyRate(100000, 'weekly', 40) // Returns 2500
 */
export function calculateEffectiveHourlyRate(
  salaryAmount: number,
  payPeriodType: PayPeriodType,
  hoursPerWeek: number = 40
): number {
  // Convert to annual salary
  let annualSalary: number;
  switch (payPeriodType) {
    case 'weekly':
      annualSalary = salaryAmount * 52;
      break;
    case 'bi-weekly':
      annualSalary = salaryAmount * 26;
      break;
    case 'semi-monthly':
      annualSalary = salaryAmount * 24;
      break;
    case 'monthly':
      annualSalary = salaryAmount * 12;
      break;
  }

  const hoursPerYear = hoursPerWeek * 52;
  return Math.round(annualSalary / hoursPerYear);
}

/**
 * Get the start and end dates for a pay period containing a given date
 *
 * @param date - The date to find the pay period for
 * @param payPeriodType - The type of pay period
 * @param payPeriodStartDay - Day the pay period starts (0=Sunday for weekly, 1=1st for monthly)
 * @returns Object with start and end dates as ISO strings
 */
export function getPayPeriodDates(
  date: Date,
  payPeriodType: PayPeriodType,
  payPeriodStartDay: number = 0
): { start: string; end: string } {
  const d = new Date(date);

  switch (payPeriodType) {
    case 'weekly': {
      const dayOfWeek = d.getDay();
      const daysToSubtract = (dayOfWeek - payPeriodStartDay + 7) % 7;
      const start = new Date(d);
      start.setDate(d.getDate() - daysToSubtract);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0],
      };
    }
    case 'bi-weekly': {
      // For bi-weekly, we need an anchor date. Using a fixed anchor (Jan 1, 2024 was a Monday)
      const anchor = new Date('2024-01-01');
      const daysSinceAnchor = Math.floor(
        (d.getTime() - anchor.getTime()) / (1000 * 60 * 60 * 24)
      );
      const daysIntoPeriod = daysSinceAnchor % 14;
      const start = new Date(d);
      start.setDate(d.getDate() - daysIntoPeriod);
      const end = new Date(start);
      end.setDate(start.getDate() + 13);
      return {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0],
      };
    }
    case 'semi-monthly': {
      // Semi-monthly: 1st-15th or 16th-end of month
      const dayOfMonth = d.getDate();
      if (dayOfMonth <= 15) {
        const start = new Date(d.getFullYear(), d.getMonth(), 1);
        const end = new Date(d.getFullYear(), d.getMonth(), 15);
        return {
          start: start.toISOString().split('T')[0],
          end: end.toISOString().split('T')[0],
        };
      } else {
        const start = new Date(d.getFullYear(), d.getMonth(), 16);
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        return {
          start: start.toISOString().split('T')[0],
          end: end.toISOString().split('T')[0],
        };
      }
    }
    case 'monthly': {
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      return {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0],
      };
    }
  }
}

/**
 * Get the actual number of days in a specific pay period
 * (For monthly/yearly, this is more accurate than the average)
 */
export function getDaysInPayPeriod(
  startDate: string,
  endDate: string
): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end.getTime() - start.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 because both dates are inclusive
}

// ============================================================================
// Contractor Calculations
// ============================================================================

/**
 * Calculate the daily allocation for a contractor
 *
 * @param paymentAmount - The payment amount in cents
 * @param interval - How often the contractor is paid
 * @returns Daily allocation in cents (0 for per-job)
 *
 * @example
 * // Weekly payment of $500 = $71.43/day
 * calculateDailyContractorAllocation(50000, 'weekly') // Returns 7143
 */
export function calculateDailyContractorAllocation(
  paymentAmount: number,
  interval: ContractorPaymentInterval
): number {
  if (interval === 'per-job') {
    // Per-job contractors are allocated when the job is completed
    // Return 0 for daily allocation - these should be handled differently
    return 0;
  }

  const daysInInterval = DAYS_PER_CONTRACTOR_INTERVAL[interval];
  return Math.round(paymentAmount / daysInInterval);
}

// ============================================================================
// Unified Calculations
// ============================================================================

/**
 * Calculate the daily labor cost for an employee based on their compensation type
 *
 * @param employee - The employee to calculate for
 * @param hoursWorked - Hours worked (only used for hourly employees)
 * @returns Daily cost in cents
 */
export function calculateDailyLaborCost(
  employee: Employee,
  hoursWorked?: number
): number {
  switch (employee.compensation_type) {
    case 'hourly':
      if (hoursWorked === undefined) {
        throw new Error('Hours worked required for hourly employees');
      }
      return Math.round(employee.hourly_rate * hoursWorked);

    case 'salary':
      if (!employee.salary_amount || !employee.pay_period_type) {
        throw new Error('Salary amount and pay period required for salaried employees');
      }
      // Only allocate if the flag is set
      if (!employee.allocate_daily) {
        return 0; // Salary will be recorded on paycheck date instead
      }
      return calculateDailySalaryAllocation(
        employee.salary_amount,
        employee.pay_period_type
      );

    case 'contractor':
      if (!employee.contractor_payment_amount || !employee.contractor_payment_interval) {
        throw new Error(
          'Payment amount and interval required for contractors'
        );
      }
      return calculateDailyContractorAllocation(
        employee.contractor_payment_amount,
        employee.contractor_payment_interval
      );

    default:
      return 0;
  }
}

/**
 * Generate a DailyLaborAllocation record for an employee on a specific date
 *
 * @param employee - The employee to generate an allocation for
 * @param date - The date for the allocation (YYYY-MM-DD format)
 * @param hoursWorked - Hours worked (only used for hourly employees)
 * @returns A DailyLaborAllocation object (without id and timestamps)
 */
export function generateDailyAllocation(
  employee: Employee,
  date: string,
  hoursWorked?: number
): Omit<DailyLaborAllocation, 'id' | 'created_at' | 'updated_at'> {
  const amount = calculateDailyLaborCost(employee, hoursWorked);
  let notes = '';
  let periodStart: string | undefined;
  let periodEnd: string | undefined;

  switch (employee.compensation_type) {
    case 'hourly':
      notes = `${hoursWorked} hrs × $${(employee.hourly_rate / 100).toFixed(2)}/hr`;
      break;
    case 'salary':
      if (employee.salary_amount && employee.pay_period_type) {
        const period = getPayPeriodDates(new Date(date), employee.pay_period_type);
        periodStart = period.start;
        periodEnd = period.end;
        const days = DAYS_PER_PAY_PERIOD[employee.pay_period_type];
        notes = `$${(employee.salary_amount / 100).toFixed(2)}/${employee.pay_period_type} ÷ ${days.toFixed(1)} days`;
      }
      break;
    case 'contractor':
      if (employee.contractor_payment_amount && employee.contractor_payment_interval) {
        if (employee.contractor_payment_interval === 'per-job') {
          notes = 'Per-job payment (not daily allocated)';
        } else {
          const days = DAYS_PER_CONTRACTOR_INTERVAL[employee.contractor_payment_interval];
          notes = `$${(employee.contractor_payment_amount / 100).toFixed(2)}/${employee.contractor_payment_interval} ÷ ${days.toFixed(1)} days`;
        }
      }
      break;
  }

  return {
    restaurant_id: employee.restaurant_id,
    employee_id: employee.id,
    date,
    compensation_type: employee.compensation_type,
    allocated_amount: amount,
    calculation_notes: notes,
    source_pay_period_start: periodStart,
    source_pay_period_end: periodEnd,
  };
}

/**
 * Calculate total labor costs broken down by compensation type
 *
 * @param allocations - Array of daily labor allocations
 * @returns LaborCostBreakdown with totals for each type
 */
export function calculateLaborBreakdown(
  allocations: Pick<DailyLaborAllocation, 'compensation_type' | 'allocated_amount'>[]
): LaborCostBreakdown {
  const breakdown: LaborCostBreakdown = {
    hourly_wages: 0,
    salary_allocations: 0,
    contractor_payments: 0,
    total: 0,
  };

  for (const allocation of allocations) {
    switch (allocation.compensation_type) {
      case 'hourly':
        breakdown.hourly_wages += allocation.allocated_amount;
        break;
      case 'salary':
        breakdown.salary_allocations += allocation.allocated_amount;
        break;
      case 'contractor':
        breakdown.contractor_payments += allocation.allocated_amount;
        break;
    }
    breakdown.total += allocation.allocated_amount;
  }

  return breakdown;
}

/**
 * Generate compensation summary for an employee over a date range
 *
 * @param employee - The employee to summarize
 * @param allocations - Their daily allocations in the period
 * @param totalHoursWorked - Total hours worked (for hourly)
 * @returns CompensationSummary
 */
export function generateCompensationSummary(
  employee: Employee,
  allocations: Pick<DailyLaborAllocation, 'allocated_amount'>[],
  totalHoursWorked?: number
): CompensationSummary {
  const totalAmount = allocations.reduce((sum, a) => sum + a.allocated_amount, 0);
  const daysWorked = allocations.length;

  let effectiveHourlyRate: number | undefined;
  if (employee.compensation_type === 'salary' && employee.salary_amount && employee.pay_period_type) {
    effectiveHourlyRate = calculateEffectiveHourlyRate(
      employee.salary_amount,
      employee.pay_period_type
    );
  } else if (employee.compensation_type === 'hourly') {
    effectiveHourlyRate = employee.hourly_rate;
  }

  return {
    compensation_type: employee.compensation_type,
    total_amount: totalAmount,
    hours_worked: totalHoursWorked,
    days_worked: daysWorked > 0 ? daysWorked : undefined,
    effective_hourly_rate: effectiveHourlyRate,
  };
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate employee compensation fields based on their type
 *
 * @param employee - Partial employee data to validate
 * @returns Array of validation error messages (empty if valid)
 */
export function validateCompensationFields(
  employee: Partial<Employee>
): string[] {
  const errors: string[] = [];

  if (!employee.compensation_type) {
    errors.push('Compensation type is required');
    return errors;
  }

  switch (employee.compensation_type) {
    case 'hourly':
      if (!employee.hourly_rate || employee.hourly_rate <= 0) {
        errors.push('Hourly rate must be greater than 0');
      }
      break;

    case 'salary':
      if (!employee.salary_amount || employee.salary_amount <= 0) {
        errors.push('Salary amount must be greater than 0');
      }
      if (!employee.pay_period_type) {
        errors.push('Pay period type is required for salaried employees');
      }
      break;

    case 'contractor':
      if (!employee.contractor_payment_amount || employee.contractor_payment_amount <= 0) {
        errors.push('Payment amount must be greater than 0');
      }
      if (!employee.contractor_payment_interval) {
        errors.push('Payment interval is required for contractors');
      }
      break;
  }

  return errors;
}

/**
 * Check if an employee requires time punches based on their compensation type
 */
export function requiresTimePunches(employee: Employee): boolean {
  // If explicitly set, use that value
  if (employee.requires_time_punch !== undefined) {
    return employee.requires_time_punch;
  }
  // Default: hourly employees must punch, others don't
  return employee.compensation_type === 'hourly';
}

/**
 * Format a compensation type for display
 */
export function formatCompensationType(type: CompensationType): string {
  const labels: Record<CompensationType, string> = {
    hourly: 'Hourly',
    salary: 'Salaried',
    contractor: 'Contractor',
  };
  return labels[type];
}

/**
 * Format a pay period type for display
 */
export function formatPayPeriodType(type: PayPeriodType): string {
  const labels: Record<PayPeriodType, string> = {
    weekly: 'Weekly',
    'bi-weekly': 'Bi-Weekly',
    'semi-monthly': 'Semi-Monthly',
    monthly: 'Monthly',
  };
  return labels[type];
}

/**
 * Format a contractor payment interval for display
 */
export function formatContractorInterval(interval: ContractorPaymentInterval): string {
  const labels: Record<ContractorPaymentInterval, string> = {
    weekly: 'Weekly',
    'bi-weekly': 'Bi-Weekly',
    monthly: 'Monthly',
    'per-job': 'Per Job',
  };
  return labels[interval];
}
