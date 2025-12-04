import { TimePunch } from '@/types/timeTracking';
import { Employee } from '@/types/scheduling';
import { startOfWeek, endOfWeek, format } from 'date-fns';

// Maximum shift length in hours (shifts longer than this are flagged as incomplete)
const MAX_SHIFT_HOURS = 16;

// Maximum gap between clock_in and clock_out to be considered a valid shift
// This prevents pairing Monday's clock_in with Wednesday's clock_out when there's missing punches
const MAX_SHIFT_GAP_HOURS = 18;

export interface WorkPeriod {
  startTime: Date;
  endTime: Date;
  hours: number;
  isBreak: boolean;
}

export interface IncompleteShift {
  type: 'missing_clock_out' | 'missing_clock_in' | 'shift_too_long';
  punchTime: Date;
  punchType: string;
  message: string;
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
  incompleteShifts?: IncompleteShift[]; // Anomalies that need manager attention
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
 * 
 * CRITICAL SAFETY RULES:
 * 1. Uses sequential pairing with maximum gap threshold (18 hours)
 * 2. Supports overnight shifts (e.g., 8 PM to 6 AM for nightclubs)
 * 3. Enforces maximum shift length (16 hours by default)
 * 4. Flags incomplete shifts (missing clock_in or clock_out, excessive gaps)
 * 5. Handles duplicate punches (keeps the last one)
 * 
 * Returns both valid work periods and incomplete shifts for manager review
 */
export function parseWorkPeriods(punches: TimePunch[]): {
  periods: WorkPeriod[];
  incompleteShifts: IncompleteShift[];
} {
  if (!punches || punches.length === 0) {
    return { periods: [], incompleteShifts: [] };
  }

  const sortedPunches = [...punches].sort(
    (a, b) => new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime()
  );

  // Remove duplicate consecutive punches of the same type (keep the last one)
  const dedupedPunches = deduplicatePunches(sortedPunches);

  const periods: WorkPeriod[] = [];
  const incompleteShifts: IncompleteShift[] = [];
  
  let currentClockIn: TimePunch | null = null;
  let currentBreakStart: TimePunch | null = null;

  for (const punch of dedupedPunches) {
    const punchTime = new Date(punch.punch_time);

    switch (punch.punch_type) {
      case 'clock_in':
        // If there's already an open clock_in, check if it's stale (gap too long)
        if (currentClockIn) {
          const gapHours = (punchTime.getTime() - new Date(currentClockIn.punch_time).getTime()) / (1000 * 60 * 60);
          
          // If gap is too long, the previous clock_in is incomplete (missing clock_out)
          if (gapHours > MAX_SHIFT_GAP_HOURS) {
            incompleteShifts.push({
              type: 'missing_clock_out',
              punchTime: new Date(currentClockIn.punch_time),
              punchType: 'clock_in',
              message: `Missing clock-out for shift started at ${format(new Date(currentClockIn.punch_time), 'MMM d, h:mm a')}`,
            });
          } else {
            // Two clock_ins in a row within reasonable time - flag the first one
            incompleteShifts.push({
              type: 'missing_clock_out',
              punchTime: new Date(currentClockIn.punch_time),
              punchType: 'clock_in',
              message: `Consecutive clock-in without clock-out at ${format(new Date(currentClockIn.punch_time), 'MMM d, h:mm a')}`,
            });
          }
        }
        currentClockIn = punch;
        currentBreakStart = null; // Reset break state
        break;

      case 'clock_out':
        if (currentClockIn) {
          const startTime = new Date(currentClockIn.punch_time);
          const endTime = punchTime;
          const hours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);

          // Check if shift gap is too long (indicates missing punches in between)
          if (hours > MAX_SHIFT_GAP_HOURS) {
            incompleteShifts.push({
              type: 'missing_clock_out',
              punchTime: startTime,
              punchType: 'clock_in',
              message: `Gap of ${hours.toFixed(1)} hours between clock-in (${format(startTime, 'MMM d, h:mm a')}) and clock-out (${format(endTime, 'MMM d, h:mm a')}) is too long - likely missing punches`,
            });
            // Don't count this shift - it needs manager review
          } else if (hours > MAX_SHIFT_HOURS) {
            // Valid gap but shift is too long - flag but still count it with warning
            incompleteShifts.push({
              type: 'shift_too_long',
              punchTime: startTime,
              punchType: 'clock_in',
              message: `Shift of ${hours.toFixed(1)} hours exceeds maximum (${MAX_SHIFT_HOURS}h). Started ${format(startTime, 'MMM d, h:mm a')}, ended ${format(endTime, 'MMM d, h:mm a')}`,
            });
            // Still count the hours but flag for review
            periods.push({
              startTime,
              endTime,
              hours,
              isBreak: false,
            });
          } else {
            // Normal valid shift
            periods.push({
              startTime,
              endTime,
              hours,
              isBreak: false,
            });
          }
          currentClockIn = null;
          currentBreakStart = null;
        } else {
          // Clock out without a clock in - orphan punch
          incompleteShifts.push({
            type: 'missing_clock_in',
            punchTime,
            punchType: 'clock_out',
            message: `Clock-out at ${format(punchTime, 'MMM d, h:mm a')} has no matching clock-in`,
          });
        }
        break;

      case 'break_start':
        if (currentClockIn && !currentBreakStart) {
          // Record the work period before break
          const startTime = new Date(currentClockIn.punch_time);
          const hours = (punchTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
          
          if (hours > 0 && hours <= MAX_SHIFT_GAP_HOURS) {
            periods.push({
              startTime,
              endTime: punchTime,
              hours,
              isBreak: false,
            });
          }
          currentBreakStart = punch;
        }
        break;

      case 'break_end':
        if (currentBreakStart) {
          const breakStartTime = new Date(currentBreakStart.punch_time);
          const breakHours = (punchTime.getTime() - breakStartTime.getTime()) / (1000 * 60 * 60);

          // Record the break period
          periods.push({
            startTime: breakStartTime,
            endTime: punchTime,
            hours: breakHours,
            isBreak: true,
          });

          // Update clock_in to after break for next work period calculation
          if (currentClockIn) {
            currentClockIn = {
              ...currentClockIn,
              punch_time: punch.punch_time,
            };
          }
          currentBreakStart = null;
        }
        break;
    }
  }

  // Check for unclosed shifts at end of punch list
  if (currentClockIn) {
    incompleteShifts.push({
      type: 'missing_clock_out',
      punchTime: new Date(currentClockIn.punch_time),
      punchType: 'clock_in',
      message: `Missing clock-out for shift started at ${format(new Date(currentClockIn.punch_time), 'MMM d, h:mm a')}`,
    });
  }

  return { periods, incompleteShifts };
}

/**
 * Remove duplicate consecutive punches of the same type
 * Keeps the LAST punch in a sequence of duplicates (e.g., manager override)
 */
function deduplicatePunches(punches: TimePunch[]): TimePunch[] {
  if (punches.length <= 1) return punches;

  const result: TimePunch[] = [];
  let i = 0;

  while (i < punches.length) {
    const current = punches[i];
    let lastOfType = current;

    // Look ahead for consecutive punches of the same type within 5 minutes
    while (i + 1 < punches.length) {
      const next = punches[i + 1];
      const timeDiff = Math.abs(
        new Date(next.punch_time).getTime() - new Date(lastOfType.punch_time).getTime()
      );
      
      // If same type and within 5 minutes, consider it a duplicate
      if (next.punch_type === current.punch_type && timeDiff < 5 * 60 * 1000) {
        lastOfType = next; // Keep the later one
        i++;
      } else {
        break;
      }
    }

    result.push(lastOfType);
    i++;
  }

  return result;
}

/**
 * Calculate total worked hours (excluding breaks)
 */
export function calculateWorkedHours(punches: TimePunch[]): number {
  const { periods } = parseWorkPeriods(punches);
  return periods
    .filter(p => !p.isBreak)
    .reduce((sum, p) => sum + p.hours, 0);
}

/**
 * Calculate worked hours and return incomplete shifts for review
 */
export function calculateWorkedHoursWithAnomalies(punches: TimePunch[]): {
  hours: number;
  incompleteShifts: IncompleteShift[];
} {
  const { periods, incompleteShifts } = parseWorkPeriods(punches);
  const hours = periods
    .filter(p => !p.isBreak)
    .reduce((sum, p) => sum + p.hours, 0);
  return { hours, incompleteShifts };
}

/**
 * Group punches by calendar week (Sunday to Saturday)
 */
function groupPunchesByWeek(punches: TimePunch[]): Map<string, TimePunch[]> {
  const weekMap = new Map<string, TimePunch[]>();
  
  punches.forEach(punch => {
    const punchDate = new Date(punch.punch_time);
    const weekStart = startOfWeek(punchDate, { weekStartsOn: 0 });
    const weekKey = weekStart.toISOString();
    
    if (!weekMap.has(weekKey)) {
      weekMap.set(weekKey, []);
    }
    weekMap.get(weekKey)!.push(punch);
  });
  
  return weekMap;
}

/**
 * Calculate regular and overtime hours per week
 * Overtime is hours worked beyond 40 in a calendar week at 1.5x rate
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
 * Partitions punches by calendar week and computes overtime per week
 * Also tracks incomplete shifts that need manager attention
 */
export function calculateEmployeePay(
  employee: Employee,
  punches: TimePunch[],
  tips: number // In cents
): EmployeePayroll {
  // Group punches by calendar week (Sunday to Saturday)
  const punchesByWeek = groupPunchesByWeek(punches);
  
  let totalRegularHours = 0;
  let totalOvertimeHours = 0;
  const allIncompleteShifts: IncompleteShift[] = [];
  
  // Calculate regular and OT hours for each week
  punchesByWeek.forEach((weekPunches) => {
    const { hours: weekWorkedHours, incompleteShifts } = calculateWorkedHoursWithAnomalies(weekPunches);
    const { regularHours, overtimeHours } = calculateRegularAndOvertimeHours(weekWorkedHours);
    
    totalRegularHours += regularHours;
    totalOvertimeHours += overtimeHours;
    allIncompleteShifts.push(...incompleteShifts);
  });

  const regularPay = Math.round(totalRegularHours * employee.hourly_rate);
  const overtimePay = Math.round(totalOvertimeHours * employee.hourly_rate * 1.5);
  const grossPay = regularPay + overtimePay;
  const totalPay = grossPay + tips;

  return {
    employeeId: employee.id,
    employeeName: employee.name,
    position: employee.position,
    hourlyRate: employee.hourly_rate,
    regularHours: Math.round(totalRegularHours * 100) / 100, // Round to 2 decimals
    overtimeHours: Math.round(totalOvertimeHours * 100) / 100,
    regularPay,
    overtimePay,
    grossPay,
    totalTips: tips,
    totalPay,
    incompleteShifts: allIncompleteShifts.length > 0 ? allIncompleteShifts : undefined,
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
