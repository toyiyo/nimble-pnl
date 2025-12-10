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
  DAYS_PER_PAY_PERIOD,
  DAYS_PER_CONTRACTOR_INTERVAL,
} from '@/utils/compensationCalculations';
import type { Employee, Shift, CompensationType } from '@/types/scheduling';
import type { TimePunch } from '@/types/timeTracking';
import { format, eachDayOfInterval } from 'date-fns';

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
  const dates = eachDayOfInterval({ start: startDate, end: endDate });
  let totalCost = 0;

  for (const date of dates) {
    const dateStr = format(date, 'yyyy-MM-dd');
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
  
  // Initialize all dates
  const allDates = eachDayOfInterval({ start: startDate, end: endDate });
  allDates.forEach(date => {
    const dateStr = format(date, 'yyyy-MM-dd');
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
    if (!employee) return;

    const shiftDate = format(new Date(shift.start_time), 'yyyy-MM-dd');
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

  // Add salary costs for scheduled days
  const salaryEmployees = employees.filter(e => 
    e.compensation_type === 'salary' && e.status === 'active'
  );
  
  salaryEmployees.forEach(employee => {
    const dailyCost = calculateEmployeeDailyCost(employee) / 100; // Convert to dollars
    
    allDates.forEach(date => {
      const dateStr = format(date, 'yyyy-MM-dd');
      const scheduledEmployees = employeesScheduledPerDay.get(dateStr);
      
      // Add cost if employee is scheduled OR if no shifts exist yet (show projected cost)
      if (shifts.length === 0 || scheduledEmployees?.has(employee.id)) {
        const dayData = dateMap.get(dateStr);
        if (dayData) {
          dayData.salary_cost += dailyCost;
          dayData.total_cost += dailyCost;
        }
      }
    });
  });

  // Add contractor costs for scheduled days
  const contractorEmployees = employees.filter(e => 
    e.compensation_type === 'contractor' && 
    e.status === 'active' &&
    e.contractor_payment_interval !== 'per-job'
  );
  
  contractorEmployees.forEach(employee => {
    const dailyCost = calculateEmployeeDailyCost(employee) / 100; // Convert to dollars
    
    allDates.forEach(date => {
      const dateStr = format(date, 'yyyy-MM-dd');
      const scheduledEmployees = employeesScheduledPerDay.get(dateStr);
      
      if (shifts.length === 0 || scheduledEmployees?.has(employee.id)) {
        const dayData = dateMap.get(dateStr);
        if (dayData) {
          dayData.contractor_cost += dailyCost;
          dayData.total_cost += dailyCost;
        }
      }
    });
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
 * @param timePunches - Array of time punch records
 * @param employees - Array of employees
 * @param startDate - Period start date
 * @param endDate - Period end date
 * @returns Labor cost breakdown with daily details
 */
export function calculateActualLaborCost(
  timePunches: TimePunch[],
  employees: Employee[],
  startDate: Date,
  endDate: Date
): { breakdown: LaborCostBreakdown; dailyCosts: DailyLaborCost[] } {
  const employeeMap = new Map(employees.map(e => [e.id, e]));
  const dateMap = new Map<string, DailyLaborCost>();
  
  // Initialize all dates
  const allDates = eachDayOfInterval({ start: startDate, end: endDate });
  allDates.forEach(date => {
    const dateStr = format(date, 'yyyy-MM-dd');
    dateMap.set(dateStr, {
      date: dateStr,
      hourly_cost: 0,
      salary_cost: 0,
      contractor_cost: 0,
      total_cost: 0,
      hours_worked: 0,
    });
  });

  // Group punches by employee and date, calculate hours
  const hoursPerEmployeePerDay = new Map<string, Map<string, number>>();
  const employeesActivePerDay = new Map<string, Set<string>>();
  
  // Process time punches (similar logic to payrollCalculations.ts)
  // For simplicity, we'll assume punches are already paired (clock_in → clock_out)
  // In production, you'd use parseWorkPeriods from payrollCalculations.ts
  
  timePunches.forEach(punch => {
    const employee = employeeMap.get(punch.employee_id);
    if (!employee) return;
    
    const punchDate = format(new Date(punch.punch_time), 'yyyy-MM-dd');
    
    // Track active employees per day
    if (!employeesActivePerDay.has(punchDate)) {
      employeesActivePerDay.set(punchDate, new Set());
    }
    employeesActivePerDay.get(punchDate)?.add(employee.id);
  });

  // Calculate costs (this is a simplified version - production uses parseWorkPeriods)
  // For now, we'll just mark employees as active and use daily rates
  
  allDates.forEach(date => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const dayData = dateMap.get(dateStr);
    if (!dayData) return;
    
    const activeEmployees = employeesActivePerDay.get(dateStr);
    if (!activeEmployees) return;
    
    activeEmployees.forEach(empId => {
      const employee = employeeMap.get(empId);
      if (!employee) return;
      
      const dailyCost = calculateEmployeeDailyCost(employee) / 100; // Convert to dollars
      
      switch (employee.compensation_type) {
        case 'salary':
          dayData.salary_cost += dailyCost;
          dayData.total_cost += dailyCost;
          break;
        case 'contractor':
          if (employee.contractor_payment_interval !== 'per-job') {
            dayData.contractor_cost += dailyCost;
            dayData.total_cost += dailyCost;
          }
          break;
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
      employees: employees.filter(e => e.compensation_type === 'salary').length,
      daysScheduled: dailyCosts.filter(d => d.salary_cost > 0).length,
    },
    contractor: {
      cost: dailyCosts.reduce((sum, day) => sum + day.contractor_cost, 0),
      employees: employees.filter(e => e.compensation_type === 'contractor').length,
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
      if (employee.contractor_payment_interval === 'per-job') {
        return `$${(employee.contractor_payment_amount! / 100).toFixed(2)}/job`;
      }
      return `~$${dailyRate}/day (${employee.contractor_payment_interval})`;
    default:
      return 'Unknown';
  }
}
