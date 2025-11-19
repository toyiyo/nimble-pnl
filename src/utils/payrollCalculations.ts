import { TimePunch } from '@/types/timeTracking';
import { Employee } from '@/types/scheduling';

export interface WorkPeriod {
  startTime: Date;
  endTime: Date;
  hours: number;
  isBreak: boolean;
}

export interface EmployeePayroll {
  employeeId: string;
  employeeName: string;
  position: string;
  hourlyRate: number; // In cents
  regularHours: number;
  overtimeHours: number;
  regularPay: number; // In cents
  overtimePay: number; // In cents
  grossPay: number; // In cents
  totalTips: number; // In cents
  totalPay: number; // In cents (gross + tips)
}

export interface PayrollPeriod {
  startDate: Date;
  endDate: Date;
  employees: EmployeePayroll[];
  totalRegularHours: number;
  totalOvertimeHours: number;
  totalGrossPay: number; // In cents
  totalTips: number; // In cents
}

/**
 * Parse time punches into work periods (clock_in → clock_out pairs)
 * Only counts completed shifts that end with an explicit clock_out
 */
export function parseWorkPeriods(punches: TimePunch[]): WorkPeriod[] {
  const sortedPunches = [...punches].sort(
    (a, b) => new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime()
  );

  const periods: WorkPeriod[] = [];
  let i = 0;

  while (i < sortedPunches.length) {
    const current = sortedPunches[i];

    if (current.punch_type === 'clock_in') {
      // Find next clock_out (only clock_out, not break_start)
      const clockOutIdx = sortedPunches.findIndex(
        (p, idx) => idx > i && p.punch_type === 'clock_out'
      );

      if (clockOutIdx !== -1) {
        // Check if there's a break between clock_in and clock_out
        const breakStartIdx = sortedPunches.findIndex(
          (p, idx) => idx > i && idx < clockOutIdx && p.punch_type === 'break_start'
        );

        if (breakStartIdx !== -1) {
          // There's a break, so split into work periods before and after break
          const breakStart = sortedPunches[breakStartIdx];
          const startTime = new Date(current.punch_time);
          const breakStartTime = new Date(breakStart.punch_time);
          const hours = (breakStartTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);

          periods.push({
            startTime,
            endTime: breakStartTime,
            hours,
            isBreak: false,
          });

          // Process the break period
          const breakEndIdx = sortedPunches.findIndex(
            (p, idx) => idx > breakStartIdx && idx < clockOutIdx && p.punch_type === 'break_end'
          );

          if (breakEndIdx !== -1) {
            const breakEnd = sortedPunches[breakEndIdx];
            const breakEndTime = new Date(breakEnd.punch_time);
            const breakHours = (breakEndTime.getTime() - breakStartTime.getTime()) / (1000 * 60 * 60);

            periods.push({
              startTime: breakStartTime,
              endTime: breakEndTime,
              hours: breakHours,
              isBreak: true,
            });

            // Work period after break to clock_out
            const clockOut = sortedPunches[clockOutIdx];
            const clockOutTime = new Date(clockOut.punch_time);
            const afterBreakHours = (clockOutTime.getTime() - breakEndTime.getTime()) / (1000 * 60 * 60);

            periods.push({
              startTime: breakEndTime,
              endTime: clockOutTime,
              hours: afterBreakHours,
              isBreak: false,
            });
          }
          // If no break_end found, we don't count the period after break_start

          i = clockOutIdx + 1;
        } else {
          // No break, simple clock_in to clock_out
          const clockOut = sortedPunches[clockOutIdx];
          const startTime = new Date(current.punch_time);
          const endTime = new Date(clockOut.punch_time);
          const hours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);

          periods.push({
            startTime,
            endTime,
            hours,
            isBreak: false,
          });

          i = clockOutIdx + 1;
        }
      } else {
        // No matching clock_out found, skip this incomplete shift
        i++;
      }
    } else {
      // Skip any punch that's not a clock_in (these are processed as part of clock_in logic)
      i++;
    }
  }

  return periods;
}

/**
 * Calculate total worked hours (excluding breaks)
 */
export function calculateWorkedHours(punches: TimePunch[]): number {
  const periods = parseWorkPeriods(punches);
  return periods
    .filter(p => !p.isBreak)
    .reduce((sum, p) => sum + p.hours, 0);
}

/**
 * Calculate regular and overtime hours
 * Overtime is hours worked beyond 40 in a week at 1.5x rate
 */
export function calculateRegularAndOvertimeHours(totalHours: number): {
  regularHours: number;
  overtimeHours: number;
} {
  const STANDARD_WORK_WEEK = 40;

  if (totalHours <= STANDARD_WORK_WEEK) {
    return {
      regularHours: totalHours,
      overtimeHours: 0,
    };
  }

  return {
    regularHours: STANDARD_WORK_WEEK,
    overtimeHours: totalHours - STANDARD_WORK_WEEK,
  };
}

/**
 * Calculate pay for an employee
 */
export function calculateEmployeePay(
  employee: Employee,
  punches: TimePunch[],
  tips: number // In cents
): EmployeePayroll {
  const totalWorkedHours = calculateWorkedHours(punches);
  const { regularHours, overtimeHours } = calculateRegularAndOvertimeHours(totalWorkedHours);

  const regularPay = Math.round(regularHours * employee.hourly_rate);
  const overtimePay = Math.round(overtimeHours * employee.hourly_rate * 1.5);
  const grossPay = regularPay + overtimePay;
  const totalPay = grossPay + tips;

  return {
    employeeId: employee.id,
    employeeName: employee.name,
    position: employee.position,
    hourlyRate: employee.hourly_rate,
    regularHours: Math.round(regularHours * 100) / 100, // Round to 2 decimals
    overtimeHours: Math.round(overtimeHours * 100) / 100,
    regularPay,
    overtimePay,
    grossPay,
    totalTips: tips,
    totalPay,
  };
}

/**
 * Format currency from cents to dollars
 */
export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

/**
 * Format hours to 2 decimal places
 */
export function formatHours(hours: number): string {
  return hours.toFixed(2);
}

/**
 * Calculate payroll for a pay period
 */
export function calculatePayrollPeriod(
  startDate: Date,
  endDate: Date,
  employees: Employee[],
  punchesPerEmployee: Map<string, TimePunch[]>,
  tipsPerEmployee: Map<string, number>
): PayrollPeriod {
  const employeePayrolls = employees.map(employee => {
    const punches = punchesPerEmployee.get(employee.id) || [];
    const tips = tipsPerEmployee.get(employee.id) || 0;
    return calculateEmployeePay(employee, punches, tips);
  });

  const totalRegularHours = employeePayrolls.reduce((sum, ep) => sum + ep.regularHours, 0);
  const totalOvertimeHours = employeePayrolls.reduce((sum, ep) => sum + ep.overtimeHours, 0);
  const totalGrossPay = employeePayrolls.reduce((sum, ep) => sum + ep.grossPay, 0);
  const totalTips = employeePayrolls.reduce((sum, ep) => sum + ep.totalTips, 0);

  return {
    startDate,
    endDate,
    employees: employeePayrolls,
    totalRegularHours,
    totalOvertimeHours,
    totalGrossPay,
    totalTips,
  };
}

/**
 * Export payroll to CSV format
 */
export function exportPayrollToCSV(payrollPeriod: PayrollPeriod): string {
  const headers = [
    'Employee Name',
    'Position',
    'Hourly Rate',
    'Regular Hours',
    'Overtime Hours',
    'Regular Pay',
    'Overtime Pay',
    'Gross Pay',
    'Tips',
    'Total Pay',
  ].join(',');

  const rows = payrollPeriod.employees.map(ep => [
    `"${ep.employeeName}"`,
    `"${ep.position}"`,
    formatCurrency(ep.hourlyRate),
    formatHours(ep.regularHours),
    formatHours(ep.overtimeHours),
    formatCurrency(ep.regularPay),
    formatCurrency(ep.overtimePay),
    formatCurrency(ep.grossPay),
    formatCurrency(ep.totalTips),
    formatCurrency(ep.totalPay),
  ].join(','));

  const totalRow = [
    '"TOTAL"',
    '""',
    '""',
    formatHours(payrollPeriod.totalRegularHours),
    formatHours(payrollPeriod.totalOvertimeHours),
    '""',
    '""',
    formatCurrency(payrollPeriod.totalGrossPay),
    formatCurrency(payrollPeriod.totalTips),
    formatCurrency(payrollPeriod.totalGrossPay + payrollPeriod.totalTips),
  ].join(',');

  return [headers, ...rows, '', totalRow].join('\n');
}
