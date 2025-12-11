/**
 * Centralized Labor Cost Calculation Service
 * 
 * SINGLE SOURCE OF TRUTH for all labor cost calculations across the application.
 * 
 * Used by:
 * - Dashboard (usePeriodMetrics → useCostsFromSource → useLaborCostsFromTimeTracking)
 * - Scheduling (useScheduledLaborCosts)
 * - Payroll (usePayroll → payrollCalculations)
 * 
 * All calculations use the same underlying logic from compensationCalculations.ts
 * to ensure consistency across the entire application.
 * 
 * @module services/laborCalculations
 */

import {
  calculateDailySalaryAllocation,
  calculateDailyContractorAllocation,
} from '@/utils/compensationCalculations';
import { parseWorkPeriods } from '@/utils/payrollCalculations';
import type { Employee, Shift, CompensationType } from '@/types/scheduling';
import type { TimePunch } from '@/types/timeTracking';


// ============================================================================
// Helpers
// ============================================================================

/**
 * Format a date as YYYY-MM-DD using UTC components to avoid timezone issues
 */
function formatDateUTC(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Generate an array of date strings in YYYY-MM-DD format for the inclusive range.
 * Works entirely in UTC to avoid timezone issues.
 */
function generateDateRange(startDate: Date, endDate: Date): string[] {
  const dates: string[] = [];
  const current = new Date(Date.UTC(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth(),
    startDate.getUTCDate()
  ));
  const end = new Date(Date.UTC(
    endDate.getUTCFullYear(),
    endDate.getUTCMonth(),
    endDate.getUTCDate()
  ));
  
  while (current <= end) {
    dates.push(formatDateUTC(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  
  return dates;
}

// ============================================================================
// Types
// ============================================================================

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
  total: number;
}

export interface DailyLaborCost {
  date: string;
  hourly_cost: number;
  salary_cost: number;
  contractor_cost: number;
  total_cost: number;
  hours_worked: number;
}

export interface EmployeeLaborCost {
  employeeId: string;
  employeeName: string;
  compensationType: CompensationType;
  dailyCost: number;
  periodCost: number;
  hoursWorked?: number;
}

// ============================================================================
// Core Calculation Functions
// ============================================================================

/**
 * Calculate the daily labor cost for a single employee
 * 
 * This is the core function used by all other calculations.
 * 
 * @param employee - The employee record
 * @param hoursWorked - Actual hours worked (for hourly employees only)
 * @returns Daily labor cost in cents
 */
export function calculateEmployeeDailyCost(
  employee: Employee,
  hoursWorked?: number
): number {
  switch (employee.compensation_type) {
    case 'hourly':
      if (hoursWorked === undefined || hoursWorked === 0) {
        return 0;
      }
      // hourly_rate is in cents, hours is decimal
      return Math.round((employee.hourly_rate / 100) * hoursWorked * 100);

    case 'salary':
      if (!employee.salary_amount || !employee.pay_period_type) {
        return 0;
      }
      // Returns cents
      return calculateDailySalaryAllocation(
        employee.salary_amount,
        employee.pay_period_type
      );

    case 'contractor':
      if (!employee.contractor_payment_amount || !employee.contractor_payment_interval) {
        return 0;
      }
      if (employee.contractor_payment_interval === 'per-job') {
        // Per-job contractors don't get daily allocation
        return 0;
      }
      // Returns cents
      return calculateDailyContractorAllocation(
        employee.contractor_payment_amount,
        employee.contractor_payment_interval
      );

    default:
      return 0;
  }
}

/**
 * Calculate labor cost for a period (date range)
 * 
 * Used by: Dashboard metrics, Payroll calculations
 * 
 * @param employee - The employee record
 * @param startDate - Period start date
 * @param endDate - Period end date (inclusive)
 * @param hoursPerDay - Map of date string to hours worked (for hourly employees)
 * @returns Period labor cost in cents
 */
export function calculateEmployeePeriodCost(
  employee: Employee,
  startDate: Date,
  endDate: Date,
  hoursPerDay?: Map<string, number>
): number {
  // Generate date range in UTC to avoid timezone issues
  const dates = generateDateRange(startDate, endDate);
  let totalCost = 0;

  for (const dateStr of dates) {
    const hours = hoursPerDay?.get(dateStr) || 0;

    switch (employee.compensation_type) {
      case 'hourly':
        totalCost += calculateEmployeeDailyCost(employee, hours);
        break;

      case 'salary':
        // Salary employees get daily allocation for every day in period
        totalCost += calculateEmployeeDailyCost(employee);
        break;

      case 'contractor':
        // Non per-job contractors get daily allocation
        if (employee.contractor_payment_interval !== 'per-job') {
          totalCost += calculateEmployeeDailyCost(employee);
        }
        break;
    }
  }

  return totalCost;
}

// ============================================================================
// Scheduled Labor Calculations (Forward-Looking)
// ============================================================================

/**
 * Calculate labor cost from scheduled shifts (future projection)
 * 
 * Used by: Scheduling page
 * 
 * @param shifts - Array of scheduled shifts
 * @param employees - Array of employees
 * @param startDate - Period start date
 * @param endDate - Period end date
 * @returns Labor cost breakdown with daily details
 */
export function calculateScheduledLaborCost(
  shifts: Shift[],
  employees: Employee[],
  startDate: Date,
  endDate: Date
): { breakdown: LaborCostBreakdown; dailyCosts: DailyLaborCost[] } {
  const employeeMap = new Map(employees.map(e => [e.id, e]));
  const dateMap = new Map<string, DailyLaborCost>();
  
  // Initialize all dates using UTC date range to avoid timezone issues
  const dateStrings = generateDateRange(startDate, endDate);
  dateStrings.forEach(dateStr => {
    dateMap.set(dateStr, {
      date: dateStr,
      hourly_cost: 0,
      salary_cost: 0,
      contractor_cost: 0,
      total_cost: 0,
      hours_worked: 0,
    });
  });

  // Track which employees are scheduled each day (for salary/contractor)
  const employeesScheduledPerDay = new Map<string, Set<string>>();
  
  // Helper to calculate shift hours
  const calculateShiftHours = (shift: Shift): number => {
    const start = new Date(shift.start_time);
    const end = new Date(shift.end_time);
    const totalMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
    const netMinutes = Math.max(totalMinutes - shift.break_duration, 0);
    return netMinutes / 60;
  };

  // Process hourly employee shifts
  shifts.forEach(shift => {
    const employee = employeeMap.get(shift.employee_id);
    if (!employee || employee.status !== 'active') return;

    const shiftDate = formatDateUTC(new Date(shift.start_time));
    const dayData = dateMap.get(shiftDate);
    if (!dayData) return;

    // Track scheduled employees
    if (!employeesScheduledPerDay.has(shiftDate)) {
      employeesScheduledPerDay.set(shiftDate, new Set());
    }
    employeesScheduledPerDay.get(shiftDate)?.add(employee.id);

    // Calculate cost based on compensation type
    if (employee.compensation_type === 'hourly') {
      const hours = calculateShiftHours(shift);
      const cost = calculateEmployeeDailyCost(employee, hours) / 100; // Convert to dollars
      
      dayData.hourly_cost += cost;
      dayData.hours_worked += hours;
      dayData.total_cost += cost;
    }
  });

  // Add salary costs - salary employees get paid per pay period regardless of scheduled hours
  // We need to calculate what portion of their pay period overlaps with our date range
  const salaryEmployees = employees.filter(e => 
    e.compensation_type === 'salary' && e.status === 'active'
  );
  
  salaryEmployees.forEach(employee => {
    // Calculate total cost for this employee across the entire date range
    const periodCost = calculateEmployeePeriodCost(employee, startDate, endDate) / 100; // Convert to dollars
    
    if (periodCost > 0 && dateStrings.length > 0) {
      // For scheduled view, distribute the period cost evenly across all days in the range
      // This is just for display purposes - the employee gets paid once per pay period
      const dailyAllocation = periodCost / dateStrings.length;
      
      dateStrings.forEach(dateStr => {
        const dayData = dateMap.get(dateStr);
        if (dayData) {
          dayData.salary_cost += dailyAllocation;
          dayData.total_cost += dailyAllocation;
        }
      });
    }
  });

  // Add contractor costs - non-per-job contractors get paid per payment interval regardless of scheduled hours
  const contractorEmployees = employees.filter(e => 
    e.compensation_type === 'contractor' && 
    e.status === 'active' &&
    e.contractor_payment_interval !== 'per-job'
  );
  
  contractorEmployees.forEach(employee => {
    // Calculate total cost for this employee across the entire date range
    const periodCost = calculateEmployeePeriodCost(employee, startDate, endDate) / 100; // Convert to dollars
    
    if (periodCost > 0 && dateStrings.length > 0) {
      // For scheduled view, distribute the period cost evenly across all days in the range
      // This is just for display purposes - the contractor gets paid per their payment interval
      const dailyAllocation = periodCost / dateStrings.length;
      
      dateStrings.forEach(dateStr => {
        const dayData = dateMap.get(dateStr);
        if (dayData) {
          dayData.contractor_cost += dailyAllocation;
          dayData.total_cost += dailyAllocation;
        }
      });
    }
  });

  // Calculate breakdown
  const dailyCosts = Array.from(dateMap.values()).sort((a, b) => 
    a.date.localeCompare(b.date)
  );

  const breakdown: LaborCostBreakdown = {
    hourly: {
      cost: dailyCosts.reduce((sum, day) => sum + day.hourly_cost, 0),
      hours: dailyCosts.reduce((sum, day) => sum + day.hours_worked, 0),
    },
    salary: {
      cost: dailyCosts.reduce((sum, day) => sum + day.salary_cost, 0),
      employees: salaryEmployees.length,
      daysScheduled: Array.from(employeesScheduledPerDay.values()).filter(
        emps => salaryEmployees.some(se => emps.has(se.id))
      ).length,
    },
    contractor: {
      cost: dailyCosts.reduce((sum, day) => sum + day.contractor_cost, 0),
      employees: contractorEmployees.length,
      daysScheduled: Array.from(employeesScheduledPerDay.values()).filter(
        emps => contractorEmployees.some(ce => emps.has(ce.id))
      ).length,
    },
    total: dailyCosts.reduce((sum, day) => sum + day.total_cost, 0),
  };

  return { breakdown, dailyCosts };
}

// ============================================================================
// Actual Labor Calculations (Historical/Time Punches)
// ============================================================================

/**
 * Calculate actual labor cost from time punches (historical data)
 * 
 * Used by: Dashboard metrics, Payroll
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
  
  // Initialize all dates using UTC date range to avoid timezone issues
  const dateStrings = generateDateRange(startDate, endDate);
  dateStrings.forEach(dateStr => {
    dateMap.set(dateStr, {
      date: dateStr,
      hourly_cost: 0,
      salary_cost: 0,
      contractor_cost: 0,
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
    const employeePunches = punchesByEmployee.get(punch.employee_id);
    if (employeePunches) {
      employeePunches.push(punch);
    }
  });

  // Map to store hours worked per employee per day
  const hoursPerEmployeePerDay = new Map<string, Map<string, number>>();
  const employeesActivePerDay = new Map<string, Set<string>>();

  // Parse work periods for each employee and calculate daily hours
  punchesByEmployee.forEach((punches, employeeId) => {
    const employee = employeeMap.get(employeeId);
    if (!employee || employee.status !== 'active') {
      return;
    }

    const { periods } = parseWorkPeriods(punches);
    
    if (!hoursPerEmployeePerDay.has(employeeId)) {
      hoursPerEmployeePerDay.set(employeeId, new Map<string, number>());
    }
    const employeeHours = hoursPerEmployeePerDay.get(employeeId);
    if (!employeeHours) return;

    periods.forEach(period => {
      // Skip break periods - only count actual work time
      if (period.isBreak) {
        return;
      }
      
      const workDate = formatDateUTC(new Date(period.startTime));
      const hoursWorked = period.hours;
      
      // Accumulate hours for this employee on this date (start date of work period)
      employeeHours.set(workDate, (employeeHours.get(workDate) || 0) + hoursWorked);
      
      // Track that this employee was active on ALL dates in the period range
      // This handles overnight shifts where work spans multiple days
      const startTimestamp = new Date(period.startTime);
      const endTimestamp = new Date(period.endTime);
      const periodStart = new Date(Date.UTC(
        startTimestamp.getUTCFullYear(),
        startTimestamp.getUTCMonth(),
        startTimestamp.getUTCDate()
      ));
      const periodEnd = new Date(Date.UTC(
        endTimestamp.getUTCFullYear(),
        endTimestamp.getUTCMonth(),
        endTimestamp.getUTCDate()
      ));
      
      // Add employee to active set for each day the period touches
      for (let d = new Date(periodStart); d <= periodEnd; d.setUTCDate(d.getUTCDate() + 1)) {
        const dateStr = formatDateUTC(d);
        if (!employeesActivePerDay.has(dateStr)) {
          employeesActivePerDay.set(dateStr, new Set());
        }
        const activeSet = employeesActivePerDay.get(dateStr);
        if (activeSet) {
          activeSet.add(employeeId);
        }
      }
    });
  });

  // Calculate costs for each date
  dateStrings.forEach(dateStr => {
    const dayData = dateMap.get(dateStr);
    if (!dayData) {
      return;
    }

    const activeEmployees = employeesActivePerDay.get(dateStr);
    if (!activeEmployees) {
      return;
    }

    activeEmployees.forEach(empId => {
      const employee = employeeMap.get(empId);
      if (!employee) return;

      const employeeHours = hoursPerEmployeePerDay.get(empId);
      const hoursWorked = employeeHours?.get(dateStr) || 0;

      switch (employee.compensation_type) {
        case 'hourly': {
          if (hoursWorked > 0) {
            const hourlyCost = (employee.hourly_rate / 100) * hoursWorked; // Convert cents to dollars
            dayData.hourly_cost += hourlyCost;
            dayData.hours_worked += hoursWorked;
            dayData.total_cost += hourlyCost;
          }
          break;
        }

        case 'salary': {
          const salaryCost = calculateEmployeeDailyCost(employee) / 100; // Convert to dollars
          dayData.salary_cost += salaryCost;
          dayData.total_cost += salaryCost;
          break;
        }

        case 'contractor': {
          if (employee.contractor_payment_interval !== 'per-job') {
            const contractorCost = calculateEmployeeDailyCost(employee) / 100; // Convert to dollars
            dayData.contractor_cost += contractorCost;
            dayData.total_cost += contractorCost;
          }
          break;
        }
      }
    });
  });

  const dailyCosts = Array.from(dateMap.values()).sort((a, b) => 
    a.date.localeCompare(b.date)
  );

  const breakdown: LaborCostBreakdown = {
    hourly: {
      cost: dailyCosts.reduce((sum, day) => sum + day.hourly_cost, 0),
      hours: dailyCosts.reduce((sum, day) => sum + day.hours_worked, 0),
    },
    salary: {
      cost: dailyCosts.reduce((sum, day) => sum + day.salary_cost, 0),
      employees: employees.filter(e => e.compensation_type === 'salary' && e.status === 'active').length,
      daysScheduled: dailyCosts.filter(d => d.salary_cost > 0).length,
    },
    contractor: {
      cost: dailyCosts.reduce((sum, day) => sum + day.contractor_cost, 0),
      employees: employees.filter(e => e.compensation_type === 'contractor' && e.status === 'active').length,
      daysScheduled: dailyCosts.filter(d => d.contractor_cost > 0).length,
    },
    total: dailyCosts.reduce((sum, day) => sum + day.total_cost, 0),
  };

  return { breakdown, dailyCosts };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Validate employee compensation data is complete
 */
export function isEmployeeCompensationValid(employee: Employee): boolean {
  switch (employee.compensation_type) {
    case 'hourly':
      return !!employee.hourly_rate && employee.hourly_rate > 0;
    case 'salary':
      return !!employee.salary_amount && 
             employee.salary_amount > 0 && 
             !!employee.pay_period_type;
    case 'contractor':
      return !!employee.contractor_payment_amount && 
             employee.contractor_payment_amount > 0 && 
             !!employee.contractor_payment_interval;
    default:
      return false;
  }
}

/**
 * Get human-readable description of employee's daily rate
 */
export function getEmployeeDailyRateDescription(employee: Employee): string {
  if (!isEmployeeCompensationValid(employee)) {
    return 'No rate configured';
  }

  const dailyCost = calculateEmployeeDailyCost(employee);
  const dailyRate = (dailyCost / 100).toFixed(2);

  switch (employee.compensation_type) {
    case 'hourly':
      return `$${(employee.hourly_rate / 100).toFixed(2)}/hr`;
    case 'salary':
      return `~$${dailyRate}/day (${employee.pay_period_type})`;
    case 'contractor':
      if (employee.contractor_payment_interval === 'per-job' && employee.contractor_payment_amount) {
        return `$${(employee.contractor_payment_amount / 100).toFixed(2)}/job`;
      }
      return `~$${dailyRate}/day (${employee.contractor_payment_interval})`;
    default:
      return 'Unknown';
  }
}
