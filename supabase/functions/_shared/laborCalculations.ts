/**
 * Labor Calculations Shared Module for Deno (Edge Functions)
 *
 * Port of src/services/laborCalculations.ts for use in Supabase Edge Functions.
 * This module provides the same labor cost calculation logic used by the Dashboard.
 *
 * Used by:
 * - ai-execute-tool/index.ts (AI tools for labor costs, payroll, etc.)
 *
 * Pattern follows:
 * - supabase/functions/_shared/periodMetrics.ts
 * - supabase/functions/_shared/recipeAnalytics.ts
 */

// ============================================================================
// Type Definitions
// ============================================================================

export type CompensationType = 'hourly' | 'salary' | 'contractor' | 'daily_rate';
export type PayPeriodType = 'weekly' | 'bi-weekly' | 'semi-monthly' | 'monthly';
export type ContractorPaymentInterval = 'weekly' | 'bi-weekly' | 'monthly' | 'per-job';
export type PunchType = 'clock_in' | 'clock_out' | 'break_start' | 'break_end';

export interface Employee {
  id: string;
  name: string;
  restaurant_id: string;
  status: 'active' | 'inactive' | 'terminated';
  position: string;
  compensation_type: CompensationType;
  hourly_rate: number; // cents
  salary_amount?: number; // cents
  pay_period_type?: PayPeriodType;
  contractor_payment_amount?: number; // cents
  contractor_payment_interval?: ContractorPaymentInterval;
  daily_rate_amount?: number; // cents
  hire_date?: string;
  termination_date?: string;
  compensation_history?: CompensationHistoryEntry[];
}

export interface CompensationHistoryEntry {
  effective_date: string;
  compensation_type: CompensationType;
  amount_cents: number;
  pay_period_type?: PayPeriodType;
}

export interface TimePunch {
  id: string;
  employee_id: string;
  restaurant_id: string;
  punch_time: string;
  punch_type: PunchType;
}

export interface LaborCostBreakdown {
  hourly: {
    cost: number;
    hours: number;
  };
  salary: {
    cost: number;
    employees: number;
    daysScheduled: number;
  };
  contractor: {
    cost: number;
    employees: number;
    daysScheduled: number;
  };
  daily_rate: {
    cost: number;
    employees: number;
    daysScheduled: number;
  };
  total: number;
}

export interface DailyLaborCost {
  date: string;
  hourly_cost: number;
  salary_cost: number;
  contractor_cost: number;
  daily_rate_cost: number;
  total_cost: number;
  hours_worked: number;
}

export interface WorkPeriod {
  startTime: Date;
  endTime: Date;
  hours: number;
  isBreak: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/** Average days per pay period type (for salary allocation) */
const DAYS_PER_PAY_PERIOD: Record<PayPeriodType, number> = {
  weekly: 7,
  'bi-weekly': 14,
  'semi-monthly': 15.22,
  monthly: 30.44,
};

/** Average days per contractor payment interval */
const DAYS_PER_CONTRACTOR_INTERVAL: Record<Exclude<ContractorPaymentInterval, 'per-job'>, number> = {
  weekly: 7,
  'bi-weekly': 14,
  monthly: 30.44,
};

const MAX_SHIFT_GAP_HOURS = 18;

// ============================================================================
// Helper Functions
// ============================================================================

function formatDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function generateDateRange(startDate: Date, endDate: Date): string[] {
  const dates: string[] = [];
  const current = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

  while (current <= end) {
    dates.push(formatDateLocal(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

function normalizeDateString(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : new Date(input);
  return date.toISOString().split('T')[0];
}

// ============================================================================
// Compensation History Resolution
// ============================================================================

interface CompensationSnapshot {
  compensation_type: CompensationType;
  hourly_rate?: number;
  salary_amount?: number;
  pay_period_type?: PayPeriodType;
  contractor_payment_amount?: number;
  contractor_payment_interval?: ContractorPaymentInterval;
}

function resolveCompensationForDate(employee: Employee, targetDate: string | Date): CompensationSnapshot {
  const dateStr = normalizeDateString(targetDate);
  const history = [...(employee.compensation_history || [])].sort(
    (a, b) => b.effective_date.localeCompare(a.effective_date)
  );
  const entry = history.find(h => h.effective_date <= dateStr);

  const snapshot: CompensationSnapshot = {
    compensation_type: entry?.compensation_type || employee.compensation_type,
  };

  switch (snapshot.compensation_type) {
    case 'hourly':
      snapshot.hourly_rate = entry?.amount_cents ?? employee.hourly_rate;
      break;
    case 'salary':
      snapshot.salary_amount = entry?.amount_cents ?? employee.salary_amount;
      snapshot.pay_period_type = (entry?.pay_period_type as PayPeriodType | null) ?? employee.pay_period_type;
      break;
    case 'contractor':
      snapshot.contractor_payment_amount = entry?.amount_cents ?? employee.contractor_payment_amount;
      snapshot.contractor_payment_interval = employee.contractor_payment_interval;
      break;
  }

  return snapshot;
}

export function getEmployeeSnapshotForDate(employee: Employee, targetDate: string | Date): Employee {
  const snapshot = resolveCompensationForDate(employee, targetDate);

  return {
    ...employee,
    compensation_type: snapshot.compensation_type,
    hourly_rate: snapshot.hourly_rate ?? 0,
    salary_amount: snapshot.salary_amount,
    pay_period_type: snapshot.pay_period_type,
    contractor_payment_amount: snapshot.contractor_payment_amount,
    contractor_payment_interval: snapshot.contractor_payment_interval,
  };
}

// ============================================================================
// Salary and Contractor Period Calculations
// ============================================================================

function calculateDailySalaryAllocation(salaryAmount: number, payPeriodType: PayPeriodType): number {
  const daysInPeriod = DAYS_PER_PAY_PERIOD[payPeriodType];
  return Math.round(salaryAmount / daysInPeriod);
}

function calculateDailyContractorAllocation(paymentAmount: number, interval: ContractorPaymentInterval): number {
  if (interval === 'per-job') return 0;
  const daysInInterval = DAYS_PER_CONTRACTOR_INTERVAL[interval];
  return Math.round(paymentAmount / daysInInterval);
}

export function calculateSalaryForPeriod(employee: Employee, startDate: Date, endDate: Date): number {
  let totalRawCents = 0;
  const start = new Date(startDate);
  const end = new Date(endDate);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dayDate = new Date(normalizeDateString(d));
    const hireDate = employee.hire_date ? new Date(employee.hire_date) : null;
    const terminationDate = employee.termination_date ? new Date(employee.termination_date) : null;

    if (hireDate && dayDate < hireDate) continue;
    if (terminationDate && dayDate > terminationDate) continue;

    const snapshot = resolveCompensationForDate(employee, dayDate);
    if (snapshot.compensation_type !== 'salary' || !snapshot.salary_amount || !snapshot.pay_period_type) {
      continue;
    }

    const daysInPeriod = DAYS_PER_PAY_PERIOD[snapshot.pay_period_type];
    totalRawCents += snapshot.salary_amount / daysInPeriod;
  }

  return Math.round(totalRawCents);
}

export function calculateContractorPayForPeriod(employee: Employee, startDate: Date, endDate: Date): number {
  let total = 0;
  const start = new Date(startDate);
  const end = new Date(endDate);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dayDate = new Date(normalizeDateString(d));
    const hireDate = employee.hire_date ? new Date(employee.hire_date) : null;
    const terminationDate = employee.termination_date ? new Date(employee.termination_date) : null;

    if (hireDate && dayDate < hireDate) continue;
    if (terminationDate && dayDate > terminationDate) continue;

    const snapshot = resolveCompensationForDate(employee, dayDate);
    if (
      snapshot.compensation_type !== 'contractor' ||
      !snapshot.contractor_payment_amount ||
      !snapshot.contractor_payment_interval ||
      snapshot.contractor_payment_interval === 'per-job'
    ) {
      continue;
    }

    total += calculateDailyContractorAllocation(
      snapshot.contractor_payment_amount,
      snapshot.contractor_payment_interval
    );
  }

  return total;
}

// ============================================================================
// Time Punch Parsing
// ============================================================================

function deduplicatePunches(punches: TimePunch[]): TimePunch[] {
  if (punches.length <= 1) return punches;

  const result: TimePunch[] = [];
  let i = 0;

  while (i < punches.length) {
    const current = punches[i];
    let lastOfType = current;

    while (i + 1 < punches.length) {
      const next = punches[i + 1];
      const timeDiff = Math.abs(
        new Date(next.punch_time).getTime() - new Date(lastOfType.punch_time).getTime()
      );

      if (next.punch_type === current.punch_type && timeDiff < 5 * 60 * 1000) {
        lastOfType = next;
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

export function parseWorkPeriods(punches: TimePunch[]): { periods: WorkPeriod[] } {
  if (!punches || punches.length === 0) {
    return { periods: [] };
  }

  const sortedPunches = [...punches].sort(
    (a, b) => new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime()
  );

  const dedupedPunches = deduplicatePunches(sortedPunches);

  const periods: WorkPeriod[] = [];
  let currentClockIn: TimePunch | null = null;
  let currentBreakStart: TimePunch | null = null;

  for (const punch of dedupedPunches) {
    const punchTime = new Date(punch.punch_time);

    switch (punch.punch_type) {
      case 'clock_in':
        currentClockIn = punch;
        currentBreakStart = null;
        break;

      case 'clock_out':
        if (currentClockIn) {
          const startTime = new Date(currentClockIn.punch_time);
          const endTime = punchTime;
          const hours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);

          if (hours > 0 && hours <= MAX_SHIFT_GAP_HOURS) {
            periods.push({ startTime, endTime, hours, isBreak: false });
          }
          currentClockIn = null;
          currentBreakStart = null;
        }
        break;

      case 'break_start':
        if (currentClockIn && !currentBreakStart) {
          const startTime = new Date(currentClockIn.punch_time);
          const hours = (punchTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);

          if (hours > 0 && hours <= MAX_SHIFT_GAP_HOURS) {
            periods.push({ startTime, endTime: punchTime, hours, isBreak: false });
          }
          currentBreakStart = punch;
        }
        break;

      case 'break_end':
        if (currentBreakStart) {
          const breakStartTime = new Date(currentBreakStart.punch_time);
          const breakHours = (punchTime.getTime() - breakStartTime.getTime()) / (1000 * 60 * 60);

          periods.push({ startTime: breakStartTime, endTime: punchTime, hours: breakHours, isBreak: true });

          if (currentClockIn) {
            currentClockIn = Object.assign({}, currentClockIn, { punch_time: punch.punch_time });
          }
          currentBreakStart = null;
        }
        break;
    }
  }

  return { periods };
}

// ============================================================================
// Daily Cost Calculations
// ============================================================================

function calculateEmployeeDailyCost(employee: Employee, hoursWorked?: number): number {
  switch (employee.compensation_type) {
    case 'hourly':
      if (hoursWorked === undefined || hoursWorked === 0) return 0;
      return Math.round((employee.hourly_rate / 100) * hoursWorked * 100);

    case 'salary':
      if (!employee.salary_amount || !employee.pay_period_type) return 0;
      return calculateDailySalaryAllocation(employee.salary_amount, employee.pay_period_type);

    case 'contractor':
      if (!employee.contractor_payment_amount || !employee.contractor_payment_interval) return 0;
      if (employee.contractor_payment_interval === 'per-job') return 0;
      return calculateDailyContractorAllocation(
        employee.contractor_payment_amount,
        employee.contractor_payment_interval
      );

    case 'daily_rate':
      if (!employee.daily_rate_amount) return 0;
      return employee.daily_rate_amount;

    default:
      return 0;
  }
}

function calculateEmployeeDailyCostForDate(employee: Employee, dateStr: string, hoursWorked?: number): number {
  const snapshot = getEmployeeSnapshotForDate(employee, dateStr);
  return calculateEmployeeDailyCost(snapshot, hoursWorked);
}

// ============================================================================
// Fixed Cost Distribution
// ============================================================================

function distributeFixedCosts(
  employees: Employee[],
  startDate: Date,
  endDate: Date,
  dateStrings: string[],
  dateMap: Map<string, DailyLaborCost>,
  costType: 'salary' | 'contractor'
): void {
  employees.forEach(employee => {
    let periodCost = 0;

    if (costType === 'salary') {
      periodCost = calculateSalaryForPeriod(employee, startDate, endDate) / 100;
    } else {
      periodCost = calculateContractorPayForPeriod(employee, startDate, endDate) / 100;
    }

    if (periodCost > 0 && dateStrings.length > 0) {
      const dailyAllocation = periodCost / dateStrings.length;

      dateStrings.forEach(dateStr => {
        const dayData = dateMap.get(dateStr);
        if (dayData) {
          if (costType === 'salary') {
            dayData.salary_cost += dailyAllocation;
          } else {
            dayData.contractor_cost += dailyAllocation;
          }
          dayData.total_cost += dailyAllocation;
        }
      });
    }
  });
}

// ============================================================================
// Main Calculation Function
// ============================================================================

/**
 * Calculate actual labor cost from time punches (historical data)
 *
 * Used by: AI tools (get_labor_costs, get_kpis labor calculation)
 *
 * @param employees - Array of employees
 * @param timePunches - Array of time punch records
 * @param startDate - Period start date
 * @param endDate - Period end date
 * @returns Labor cost breakdown with daily details
 */
export function calculateActualLaborCost(
  employees: Employee[],
  timePunches: TimePunch[],
  startDate: Date,
  endDate: Date
): { breakdown: LaborCostBreakdown; dailyCosts: DailyLaborCost[] } {
  const employeeMap = new Map(employees.map(e => [e.id, e]));
  const dateMap = new Map<string, DailyLaborCost>();

  const dateStrings = generateDateRange(startDate, endDate);
  dateStrings.forEach(dateStr => {
    dateMap.set(dateStr, {
      date: dateStr,
      hourly_cost: 0,
      salary_cost: 0,
      contractor_cost: 0,
      daily_rate_cost: 0,
      total_cost: 0,
      hours_worked: 0,
    });
  });

  // Group time punches by employee and parse into work periods
  const punchesByEmployee = new Map<string, TimePunch[]>();
  timePunches.forEach(punch => {
    if (!punchesByEmployee.has(punch.employee_id)) {
      punchesByEmployee.set(punch.employee_id, []);
    }
    punchesByEmployee.get(punch.employee_id)?.push(punch);
  });

  // Map to store hours worked per employee per day
  const hoursPerEmployeePerDay = new Map<string, Map<string, number>>();
  const employeesActivePerDay = new Map<string, Set<string>>();

  // Parse work periods for each employee
  punchesByEmployee.forEach((punches, employeeId) => {
    const employee = employeeMap.get(employeeId);
    if (!employee) return;

    const { periods } = parseWorkPeriods(punches);

    if (!hoursPerEmployeePerDay.has(employeeId)) {
      hoursPerEmployeePerDay.set(employeeId, new Map<string, number>());
    }
    const employeeHours = hoursPerEmployeePerDay.get(employeeId);
    if (!employeeHours) return;

    periods.forEach(period => {
      if (period.isBreak) return;

      const workDate = formatDateLocal(new Date(period.startTime));
      const hoursWorked = period.hours;

      employeeHours.set(workDate, (employeeHours.get(workDate) || 0) + hoursWorked);

      // Track active days
      const periodStart = new Date(
        period.startTime.getFullYear(),
        period.startTime.getMonth(),
        period.startTime.getDate()
      );
      const periodEnd = new Date(
        period.endTime.getFullYear(),
        period.endTime.getMonth(),
        period.endTime.getDate()
      );

      for (let d = new Date(periodStart); d <= periodEnd; d.setDate(d.getDate() + 1)) {
        const dateStr = formatDateLocal(d);
        if (!employeesActivePerDay.has(dateStr)) {
          employeesActivePerDay.set(dateStr, new Set());
        }
        employeesActivePerDay.get(dateStr)?.add(employeeId);
      }
    });
  });

  // Calculate costs for hourly and daily_rate employees
  dateStrings.forEach(dateStr => {
    const dayData = dateMap.get(dateStr);
    if (!dayData) return;

    const activeEmployees = employeesActivePerDay.get(dateStr);
    if (!activeEmployees) return;

    activeEmployees.forEach(empId => {
      const employee = employeeMap.get(empId);
      if (!employee) return;

      const effectiveEmployee = getEmployeeSnapshotForDate(employee, dateStr);
      const employeeHours = hoursPerEmployeePerDay.get(empId);
      const hoursWorked = employeeHours?.get(dateStr) || 0;

      if (effectiveEmployee.compensation_type === 'hourly' && hoursWorked > 0) {
        const hourlyCost = calculateEmployeeDailyCostForDate(employee, dateStr, hoursWorked) / 100;
        dayData.hourly_cost += hourlyCost;
        dayData.hours_worked += hoursWorked;
        dayData.total_cost += hourlyCost;
      } else if (effectiveEmployee.compensation_type === 'daily_rate') {
        const dailyRateCost = calculateEmployeeDailyCost(effectiveEmployee) / 100;
        dayData.daily_rate_cost += dailyRateCost;
        dayData.total_cost += dailyRateCost;
      }
    });
  });

  // Handle salary costs - pass all employees since calculateSalaryForPeriod
  // checks compensation_type per-day via resolveCompensationForDate.
  // This correctly handles employees who changed from salary to another type mid-period.
  distributeFixedCosts(employees, startDate, endDate, dateStrings, dateMap, 'salary');

  // Handle contractor costs - same approach for historical compensation handling.
  // calculateContractorPayForPeriod already skips per-job contractors internally.
  distributeFixedCosts(employees, startDate, endDate, dateStrings, dateMap, 'contractor');

  const dailyCosts = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  // Employee counts use current compensation_type (reflects present state).
  // Note: Cost calculations above do properly include historical type changes.
  const activeSalaryCount = employees.filter(e => e.compensation_type === 'salary' && e.status === 'active').length;
  const activeContractorCount = employees.filter(e => e.compensation_type === 'contractor' && e.status === 'active').length;
  const activeDailyRateCount = employees.filter(e => e.compensation_type === 'daily_rate' && e.status === 'active').length;

  const breakdown: LaborCostBreakdown = {
    hourly: {
      cost: dailyCosts.reduce((sum, day) => sum + day.hourly_cost, 0),
      hours: dailyCosts.reduce((sum, day) => sum + day.hours_worked, 0),
    },
    salary: {
      cost: dailyCosts.reduce((sum, day) => sum + day.salary_cost, 0),
      employees: activeSalaryCount,
      daysScheduled: dailyCosts.filter(d => d.salary_cost > 0).length,
    },
    contractor: {
      cost: dailyCosts.reduce((sum, day) => sum + day.contractor_cost, 0),
      employees: activeContractorCount,
      daysScheduled: dailyCosts.filter(d => d.contractor_cost > 0).length,
    },
    daily_rate: {
      cost: dailyCosts.reduce((sum, day) => sum + day.daily_rate_cost, 0),
      employees: activeDailyRateCount,
      daysScheduled: dailyCosts.filter(d => d.daily_rate_cost > 0).length,
    },
    total: dailyCosts.reduce((sum, day) => sum + day.total_cost, 0),
  };

  return { breakdown, dailyCosts };
}

/**
 * Calculate scheduled labor cost from shifts (future projection)
 */
export function calculateScheduledLaborCost(
  shifts: Array<{
    employee_id: string;
    start_time: string;
    end_time: string;
    break_duration: number;
  }>,
  employees: Employee[],
  startDate: Date,
  endDate: Date
): { breakdown: LaborCostBreakdown; dailyCosts: DailyLaborCost[] } {
  const employeeMap = new Map(employees.map(e => [e.id, e]));
  const dateMap = new Map<string, DailyLaborCost>();

  const dateStrings = generateDateRange(startDate, endDate);
  dateStrings.forEach(dateStr => {
    dateMap.set(dateStr, {
      date: dateStr,
      hourly_cost: 0,
      salary_cost: 0,
      contractor_cost: 0,
      daily_rate_cost: 0,
      total_cost: 0,
      hours_worked: 0,
    });
  });

  // Track daily_rate employees counted per day to avoid double-counting
  const dailyRateCountedPerDay = new Map<string, Set<string>>();

  // Process shifts
  shifts.forEach(shift => {
    const employee = employeeMap.get(shift.employee_id);
    if (!employee || employee.status !== 'active') return;

    const shiftDate = formatDateLocal(new Date(shift.start_time));
    const dayData = dateMap.get(shiftDate);
    if (!dayData) return;

    const effectiveEmployee = getEmployeeSnapshotForDate(employee, shiftDate);

    if (effectiveEmployee.compensation_type === 'hourly') {
      const start = new Date(shift.start_time);
      const end = new Date(shift.end_time);
      const totalMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
      const netMinutes = Math.max(totalMinutes - shift.break_duration, 0);
      const hours = netMinutes / 60;

      const cost = calculateEmployeeDailyCost(effectiveEmployee, hours) / 100;
      dayData.hourly_cost += cost;
      dayData.hours_worked += hours;
      dayData.total_cost += cost;
    } else if (effectiveEmployee.compensation_type === 'daily_rate') {
      if (!dailyRateCountedPerDay.has(shiftDate)) {
        dailyRateCountedPerDay.set(shiftDate, new Set());
      }

      const countedEmployees = dailyRateCountedPerDay.get(shiftDate)!;
      if (!countedEmployees.has(employee.id)) {
        const cost = calculateEmployeeDailyCost(effectiveEmployee) / 100;
        dayData.daily_rate_cost += cost;
        dayData.total_cost += cost;
        countedEmployees.add(employee.id);
      }
    }
  });

  // Handle salary and contractor costs - pass all active employees since
  // calculateSalaryForPeriod/calculateContractorPayForPeriod check type per-day.
  // This correctly handles employees who changed compensation type mid-period.
  const activeEmployees = employees.filter(e => e.status === 'active');

  distributeFixedCosts(activeEmployees, startDate, endDate, dateStrings, dateMap, 'salary');
  distributeFixedCosts(activeEmployees, startDate, endDate, dateStrings, dateMap, 'contractor');

  // For employee counts in breakdown, use current types (reflects present state)
  const salaryEmployees = activeEmployees.filter(e => e.compensation_type === 'salary');
  const contractorEmployees = activeEmployees.filter(
    e => e.compensation_type === 'contractor' && e.contractor_payment_interval !== 'per-job'
  );
  const dailyRateEmployees = activeEmployees.filter(e => e.compensation_type === 'daily_rate');

  const dailyCosts = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  const breakdown: LaborCostBreakdown = {
    hourly: {
      cost: dailyCosts.reduce((sum, day) => sum + day.hourly_cost, 0),
      hours: dailyCosts.reduce((sum, day) => sum + day.hours_worked, 0),
    },
    salary: {
      cost: dailyCosts.reduce((sum, day) => sum + day.salary_cost, 0),
      employees: salaryEmployees.length,
      daysScheduled: dailyCosts.filter(d => d.salary_cost > 0).length,
    },
    contractor: {
      cost: dailyCosts.reduce((sum, day) => sum + day.contractor_cost, 0),
      employees: contractorEmployees.length,
      daysScheduled: dailyCosts.filter(d => d.contractor_cost > 0).length,
    },
    daily_rate: {
      cost: dailyCosts.reduce((sum, day) => sum + day.daily_rate_cost, 0),
      employees: dailyRateEmployees.length,
      daysScheduled: dailyCosts.filter(d => d.daily_rate_cost > 0).length,
    },
    total: dailyCosts.reduce((sum, day) => sum + day.total_cost, 0),
  };

  return { breakdown, dailyCosts };
}
