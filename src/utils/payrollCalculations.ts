import { TimePunch } from '@/types/timeTracking';
import { Employee, CompensationType } from '@/types/scheduling';
import { startOfWeek, endOfWeek, format, parseISO } from 'date-fns';
import { WEEK_STARTS_ON } from '@/lib/dateConfig';
import { 
  calculateSalaryForPeriod, 
  calculateContractorPayForPeriod,
  calculateEmployeeDailyCostForDate,
  calculateDailyRatePay,
} from '@/utils/compensationCalculations';

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

export interface ManualPayment {
  id?: string;
  date: string;
  amount: number; // In cents
  description?: string;
}

export interface EmployeePayroll {
  employeeId: string;
  employeeName: string;
  position: string;
  compensationType: CompensationType; // Type of compensation
  hourlyRate: number; // In cents (for hourly employees)
  regularHours: number;
  overtimeHours: number;
  regularPay: number; // In cents
  overtimePay: number; // In cents
  salaryPay: number; // In cents (for salaried employees)
  contractorPay: number; // In cents (for contractors)
  dailyRatePay: number; // In cents (for daily_rate employees)
  daysWorked?: number; // Number of days worked (for daily_rate)
  manualPayments: ManualPayment[]; // Manual payments for per-job contractors
  manualPaymentsTotal: number; // Sum of manual payments in cents
  grossPay: number; // In cents
  totalTips: number; // In cents
  tipsPaidOut: number; // In cents - tips already paid out as cash
  tipsOwed: number; // In cents - tips still owed (totalTips - tipsPaidOut)
  totalPay: number; // In cents (grossPay + tipsOwed)
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
  totalTipsPaidOut: number; // In cents
  totalTipsOwed: number; // In cents
}

/**
 * Mutable state object used during shift parsing
 */
interface ShiftParsingState {
  periods: WorkPeriod[];
  incompleteShifts: IncompleteShift[];
  currentClockIn: TimePunch | null;
  currentBreakStart: TimePunch | null;
}

/**
 * Handle a clock_in punch
 */
function handleClockIn(
  punch: TimePunch,
  punchTime: Date,
  state: ShiftParsingState
): void {
  // If there's already an open clock_in, check if it's stale (gap too long)
  if (state.currentClockIn) {
    const gapHours = (punchTime.getTime() - new Date(state.currentClockIn.punch_time).getTime()) / (1000 * 60 * 60);
    
    // If gap is too long, the previous clock_in is incomplete (missing clock_out)
    if (gapHours > MAX_SHIFT_GAP_HOURS) {
      state.incompleteShifts.push({
        type: 'missing_clock_out',
        punchTime: new Date(state.currentClockIn.punch_time),
        punchType: 'clock_in',
        message: `Missing clock-out for shift started at ${format(new Date(state.currentClockIn.punch_time), 'MMM d, h:mm a')}`,
      });
    } else {
      // Two clock_ins in a row within reasonable time - flag the first one
      state.incompleteShifts.push({
        type: 'missing_clock_out',
        punchTime: new Date(state.currentClockIn.punch_time),
        punchType: 'clock_in',
        message: `Consecutive clock-in without clock-out at ${format(new Date(state.currentClockIn.punch_time), 'MMM d, h:mm a')}`,
      });
    }
  }
  state.currentClockIn = punch;
  state.currentBreakStart = null; // Reset break state
}

/**
 * Handle a clock_out punch
 */
function handleClockOut(
  punchTime: Date,
  state: ShiftParsingState
): void {
  if (state.currentClockIn) {
    const startTime = new Date(state.currentClockIn.punch_time);
    const endTime = punchTime;
    const hours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);

    // Check if shift gap is too long (indicates missing punches in between)
    if (hours > MAX_SHIFT_GAP_HOURS) {
      state.incompleteShifts.push({
        type: 'missing_clock_out',
        punchTime: startTime,
        punchType: 'clock_in',
        message: `Gap of ${hours.toFixed(1)} hours between clock-in (${format(startTime, 'MMM d, h:mm a')}) and clock-out (${format(endTime, 'MMM d, h:mm a')}) is too long - likely missing punches`,
      });
      // Don't count this shift - it needs manager review
    } else if (hours > MAX_SHIFT_HOURS) {
      // Valid gap but shift is too long - flag but still count it with warning
      state.incompleteShifts.push({
        type: 'shift_too_long',
        punchTime: startTime,
        punchType: 'clock_in',
        message: `Shift of ${hours.toFixed(1)} hours exceeds maximum (${MAX_SHIFT_HOURS}h). Started ${format(startTime, 'MMM d, h:mm a')}, ended ${format(endTime, 'MMM d, h:mm a')}`,
      });
      // Still count the hours but flag for review
      state.periods.push({
        startTime,
        endTime,
        hours,
        isBreak: false,
      });
    } else {
      // Normal valid shift
      state.periods.push({
        startTime,
        endTime,
        hours,
        isBreak: false,
      });
    }
    state.currentClockIn = null;
    state.currentBreakStart = null;
  } else {
    // Clock out without a clock in - orphan punch
    state.incompleteShifts.push({
      type: 'missing_clock_in',
      punchTime,
      punchType: 'clock_out',
      message: `Clock-out at ${format(punchTime, 'MMM d, h:mm a')} has no matching clock-in`,
    });
  }
}

/**
 * Handle a break_start punch
 */
function handleBreakStart(
  punch: TimePunch,
  punchTime: Date,
  state: ShiftParsingState
): void {
  if (state.currentClockIn && !state.currentBreakStart) {
    // Record the work period before break
    const startTime = new Date(state.currentClockIn.punch_time);
    const hours = (punchTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
    
    if (hours > 0 && hours <= MAX_SHIFT_GAP_HOURS) {
      state.periods.push({
        startTime,
        endTime: punchTime,
        hours,
        isBreak: false,
      });
    }
    state.currentBreakStart = punch;
  }
}

/**
 * Handle a break_end punch
 */
function handleBreakEnd(
  punch: TimePunch,
  punchTime: Date,
  state: ShiftParsingState
): void {
  if (state.currentBreakStart) {
    const breakStartTime = new Date(state.currentBreakStart.punch_time);
    const breakHours = (punchTime.getTime() - breakStartTime.getTime()) / (1000 * 60 * 60);

    // Record the break period
    state.periods.push({
      startTime: breakStartTime,
      endTime: punchTime,
      hours: breakHours,
      isBreak: true,
    });

    // Update clock_in to after break for next work period calculation
    if (state.currentClockIn) {
      state.currentClockIn = {
        ...state.currentClockIn,
        punch_time: punch.punch_time,
      };
    }
    state.currentBreakStart = null;
  }
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

  const state: ShiftParsingState = {
    periods: [],
    incompleteShifts: [],
    currentClockIn: null,
    currentBreakStart: null,
  };

  for (const punch of dedupedPunches) {
    const punchTime = new Date(punch.punch_time);

    switch (punch.punch_type) {
      case 'clock_in':
        handleClockIn(punch, punchTime, state);
        break;
      case 'clock_out':
        handleClockOut(punchTime, state);
        break;
      case 'break_start':
        handleBreakStart(punch, punchTime, state);
        break;
      case 'break_end':
        handleBreakEnd(punch, punchTime, state);
        break;
    }
  }

  // Check for unclosed shifts at end of punch list
  if (state.currentClockIn) {
    state.incompleteShifts.push({
      type: 'missing_clock_out',
      punchTime: new Date(state.currentClockIn.punch_time),
      punchType: 'clock_in',
      message: `Missing clock-out for shift started at ${format(new Date(state.currentClockIn.punch_time), 'MMM d, h:mm a')}`,
    });
  }

  return { periods: state.periods, incompleteShifts: state.incompleteShifts };
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
 * Handles all compensation types: hourly, salary, contractor, and daily_rate
 * For hourly: partitions punches by calendar week and computes overtime
 * For salary/contractor: calculates prorated pay for the period
 * For daily_rate: counts unique days worked and multiplies by daily rate
 */
export function calculateEmployeePay(
  employee: Employee,
  punches: TimePunch[],
  tips: number, // In cents
  periodStartDate?: Date,
  periodEndDate?: Date,
  manualPayments: ManualPayment[] = [],
  tipsPaidOut: number = 0
): EmployeePayroll {
  const compensationType = employee.compensation_type || 'hourly';
  
  let totalRegularHours = 0;
  let totalOvertimeHours = 0;
  let regularPay = 0;
  let overtimePay = 0;
  let salaryPay = 0;
  let contractorPay = 0;
  let dailyRatePay = 0;
  let daysWorked = 0;
  const allIncompleteShifts: IncompleteShift[] = [];
  
  // Calculate based on compensation type
  if (compensationType === 'hourly') {
    const parsed = parseWorkPeriods(punches);
    const hoursByDate = new Map<string, number>();

    parsed.periods.forEach(period => {
      if (period.isBreak) return;
      const dateKey = format(new Date(period.startTime), 'yyyy-MM-dd');
      hoursByDate.set(dateKey, (hoursByDate.get(dateKey) || 0) + period.hours);
    });

    const weeklyTotals = new Map<string, { hours: number; payCents: number }>();
    hoursByDate.forEach((hours, dateStr) => {
      const payCents = calculateEmployeeDailyCostForDate(employee, dateStr, hours);
      const weekKey = format(startOfWeek(new Date(dateStr)), 'yyyy-MM-dd');
      const current = weeklyTotals.get(weekKey) || { hours: 0, payCents: 0 };
      current.hours += hours;
      current.payCents += payCents;
      weeklyTotals.set(weekKey, current);
    });

    weeklyTotals.forEach(({ hours, payCents }) => {
      const { regularHours, overtimeHours } = calculateRegularAndOvertimeHours(hours);
      totalRegularHours += regularHours;
      totalOvertimeHours += overtimeHours;

      const baseRatePerHour = hours > 0 ? payCents / hours : 0;
      regularPay += Math.round(regularHours * baseRatePerHour);
      overtimePay += Math.round(overtimeHours * baseRatePerHour * 1.5);
    });

    allIncompleteShifts.push(...parsed.incompleteShifts);
    
  } else if (compensationType === 'salary' && periodStartDate && periodEndDate) {
    // Salaried employees: calculate prorated salary for the period
    salaryPay = calculateSalaryForPeriod(employee, periodStartDate, periodEndDate);
    
  } else if (compensationType === 'contractor' && periodStartDate && periodEndDate) {
    // Contractors: calculate prorated payment for the period
    contractorPay = calculateContractorPayForPeriod(employee, periodStartDate, periodEndDate);
    
  } else if (compensationType === 'daily_rate' && periodStartDate && periodEndDate) {
    // Daily rate: count unique days with punches
    const uniqueDays = new Set<string>();
    
    punches.forEach(punch => {
      const dateKey = format(new Date(punch.punch_time), 'yyyy-MM-dd');
      const punchDate = new Date(dateKey);
      
      // Only count days within the pay period
      if (punchDate >= periodStartDate && punchDate <= periodEndDate) {
        uniqueDays.add(dateKey);
      }
    });
    
    daysWorked = uniqueDays.size;
    dailyRatePay = calculateDailyRatePay(employee, daysWorked);
  }

  // Calculate manual payments total
  const manualPaymentsTotal = manualPayments.reduce((sum, p) => sum + p.amount, 0);

  const grossPay = regularPay + overtimePay + salaryPay + contractorPay + dailyRatePay + manualPaymentsTotal;
  const tipsOwed = Math.max(0, tips - tipsPaidOut);
  const totalPay = grossPay + tipsOwed;

  return {
    employeeId: employee.id,
    employeeName: employee.name,
    position: employee.position,
    compensationType,
    hourlyRate: employee.hourly_rate,
    regularHours: Math.round(totalRegularHours * 100) / 100, // Round to 2 decimals
    overtimeHours: Math.round(totalOvertimeHours * 100) / 100,
    regularPay,
    overtimePay,
    salaryPay,
    contractorPay,
    dailyRatePay,
    daysWorked: (compensationType === 'daily_rate' || daysWorked > 0) ? daysWorked : undefined,
    manualPayments,
    manualPaymentsTotal,
    grossPay,
    totalTips: tips,
    tipsPaidOut,
    tipsOwed,
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
 * Determine if an employee should appear in a payroll period.
 * 
 * Rules:
 * - Active employees: Always included
 * - Inactive employees: Included only if the payroll period start date
 *   is on or before the end of their deactivation week
 * 
 * This ensures employees get paid for their final week and then stop appearing.
 */
export function shouldIncludeEmployeeInPayroll(
  employee: Employee,
  periodStartDate: Date
): boolean {
  // Active employees are always included
  if (employee.is_active) return true;
  
  // For inactive employees, check if payroll period overlaps with their last week
  const deactivationDate = employee.deactivated_at || employee.last_active_date;
  if (!deactivationDate) {
    // No deactivation date - shouldn't happen, but include to be safe
    return true;
  }
  
  // Get the end of the week containing the deactivation date
  const deactivationParsed = parseISO(deactivationDate);
  const endOfDeactivationWeek = endOfWeek(deactivationParsed, { weekStartsOn: WEEK_STARTS_ON });
  
  // Include if payroll period starts on or before the end of deactivation week
  return periodStartDate <= endOfDeactivationWeek;
}

/**
 * Calculate payroll for a pay period
 * Handles all compensation types: hourly, salary, and contractor
 */
export function calculatePayrollPeriod(
  startDate: Date,
  endDate: Date,
  employees: Employee[],
  punchesPerEmployee: Map<string, TimePunch[]>,
  tipsPerEmployee: Map<string, number>,
  manualPaymentsPerEmployee: Map<string, ManualPayment[]> = new Map(),
  tipPayoutsPerEmployee: Map<string, number> = new Map()
): PayrollPeriod {
  const employeePayrolls = employees.map(employee => {
    const punches = punchesPerEmployee.get(employee.id) || [];
    const tips = tipsPerEmployee.get(employee.id) || 0;
    const manualPayments = manualPaymentsPerEmployee.get(employee.id) || [];
    const tipsPaidOut = tipPayoutsPerEmployee.get(employee.id) || 0;
    // Pass period dates for salary/contractor calculations
    return calculateEmployeePay(employee, punches, tips, startDate, endDate, manualPayments, tipsPaidOut);
  });

  const totalRegularHours = employeePayrolls.reduce((sum, ep) => sum + ep.regularHours, 0);
  const totalOvertimeHours = employeePayrolls.reduce((sum, ep) => sum + ep.overtimeHours, 0);
  const totalGrossPay = employeePayrolls.reduce((sum, ep) => sum + ep.grossPay, 0);
  const totalTips = employeePayrolls.reduce((sum, ep) => sum + ep.totalTips, 0);
  const totalTipsPaidOut = employeePayrolls.reduce((sum, ep) => sum + ep.tipsPaidOut, 0);
  const totalTipsOwed = employeePayrolls.reduce((sum, ep) => sum + ep.tipsOwed, 0);

  return {
    startDate,
    endDate,
    employees: employeePayrolls,
    totalRegularHours,
    totalOvertimeHours,
    totalGrossPay,
    totalTips,
    totalTipsPaidOut,
    totalTipsOwed,
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
    'Tips Earned',
    'Tips Paid',
    'Tips Owed',
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
    formatCurrency(ep.tipsPaidOut),
    formatCurrency(ep.tipsOwed),
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
    formatCurrency(payrollPeriod.totalTipsPaidOut),
    formatCurrency(payrollPeriod.totalTipsOwed),
    formatCurrency(payrollPeriod.totalGrossPay + payrollPeriod.totalTipsOwed),
  ].join(',');

  return [headers, ...rows, '', totalRow].join('\n');
}
