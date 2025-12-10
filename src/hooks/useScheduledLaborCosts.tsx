import { useMemo } from 'react';
import { useEmployees } from './useEmployees';
import { format, eachDayOfInterval } from 'date-fns';
import { Shift } from '@/types/scheduling';

export interface ScheduledLaborCostData {
  date: string;
  total_labor_cost: number;
  hourly_wages: number;
  salary_wages: number;
  contractor_payments: number;
  total_hours: number;
}

export interface ScheduledLaborCostBreakdown {
  hourly: {
    cost: number;
    hours: number;
  };
  salary: {
    cost: number;
    estimatedDays: number;
  };
  contractor: {
    cost: number;
    estimatedDays: number;
  };
  total: number;
}

export interface ScheduledLaborCostsResult {
  dailyCosts: ScheduledLaborCostData[];
  totalCost: number;
  breakdown: ScheduledLaborCostBreakdown;
}

/**
 * Calculate estimated labor costs from scheduled shifts.
 * 
 * This provides a forward-looking estimate based on:
 * 1. Hourly employees: scheduled shift hours × hourly rate
 * 2. Salary employees: prorated daily allocation for scheduled days
 * 3. Contractors: estimated daily rate for scheduled days
 * 
 * @param shifts - Array of scheduled shifts
 * @param dateFrom - Start date for the period
 * @param dateTo - End date for the period
 * @param restaurantId - Restaurant ID (for employees lookup)
 * @returns Estimated labor cost data by date
 */
export function useScheduledLaborCosts(
  shifts: Shift[],
  dateFrom: Date,
  dateTo: Date,
  restaurantId: string | null
): ScheduledLaborCostsResult {
  const { employees } = useEmployees(restaurantId);

  const result = useMemo(() => {
    if (!restaurantId || employees.length === 0) {
      return {
        dailyCosts: [],
        totalCost: 0,
        breakdown: {
          hourly: { cost: 0, hours: 0 },
          salary: { cost: 0, estimatedDays: 0 },
          contractor: { cost: 0, estimatedDays: 0 },
          total: 0,
        },
      };
    }

    // Helper to calculate shift hours (excluding break)
    const calculateShiftHours = (shift: Shift): number => {
      const start = new Date(shift.start_time);
      const end = new Date(shift.end_time);
      const totalMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
      const netMinutes = Math.max(totalMinutes - shift.break_duration, 0);
      return netMinutes / 60;
    };

    // Initialize all dates with zero costs
    const allDates = eachDayOfInterval({ start: dateFrom, end: dateTo });
    const dateMap = new Map<string, ScheduledLaborCostData>();
    
    allDates.forEach(date => {
      const dateStr = format(date, 'yyyy-MM-dd');
      dateMap.set(dateStr, {
        date: dateStr,
        total_labor_cost: 0,
        hourly_wages: 0,
        salary_wages: 0,
        contractor_payments: 0,
        total_hours: 0,
      });
    });

    // Track employees scheduled per day for salary/contractor prorating
    const employeesScheduledPerDay = new Map<string, Set<string>>(); // date -> Set<employeeId>
    const salaryEmployees = employees.filter(e => e.compensation_type === 'salary' && e.status === 'active');
    const contractorEmployees = employees.filter(e => e.compensation_type === 'contractor' && e.status === 'active');

    // Process each shift
    shifts.forEach(shift => {
      const employee = employees.find(e => e.id === shift.employee_id);
      if (!employee || employee.status !== 'active') return;

      const shiftDate = format(new Date(shift.start_time), 'yyyy-MM-dd');
      const dayData = dateMap.get(shiftDate);
      if (!dayData) return;

      // Track that this employee was scheduled this day
      if (!employeesScheduledPerDay.has(shiftDate)) {
        employeesScheduledPerDay.set(shiftDate, new Set());
      }
      employeesScheduledPerDay.get(shiftDate)?.add(employee.id);

      // Calculate cost based on compensation type
      if (employee.compensation_type === 'hourly') {
        const hours = calculateShiftHours(shift);
        const cost = (employee.hourly_rate / 100) * hours; // hourly_rate is in cents
        
        dayData.hourly_wages += cost;
        dayData.total_hours += hours;
        dayData.total_labor_cost += cost;
      }
    });

    // Add prorated salary costs for days where salary employees are scheduled
    salaryEmployees.forEach(employee => {
      if (!employee.salary_amount) return;

      const dailySalaryRate = (employee.salary_amount / 100) / 365; // Annual salary to daily rate
      
      allDates.forEach(date => {
        const dateStr = format(date, 'yyyy-MM-dd');
        const scheduledEmployees = employeesScheduledPerDay.get(dateStr);
        
        // Only add salary cost if this employee is scheduled that day
        // OR if no shifts exist yet (show full estimated cost)
        if (shifts.length === 0 || scheduledEmployees?.has(employee.id)) {
          const dayData = dateMap.get(dateStr);
          if (dayData) {
            dayData.salary_wages += dailySalaryRate;
            dayData.total_labor_cost += dailySalaryRate;
          }
        }
      });
    });

    // Add estimated contractor costs for days where contractors are scheduled
    contractorEmployees.forEach(employee => {
      // Estimate contractor daily rate from recent manual payments or use a default
      // For now, we'll just mark that contractors are scheduled
      allDates.forEach(date => {
        const dateStr = format(date, 'yyyy-MM-dd');
        const scheduledEmployees = employeesScheduledPerDay.get(dateStr);
        
        if (shifts.length === 0 || scheduledEmployees?.has(employee.id)) {
          // Could add estimated contractor cost here if we had historical data
          // For now, just note that contractors are scheduled (cost tracked separately)
        }
      });
    });

    const dailyCosts = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    const totalCost = dailyCosts.reduce((sum, day) => sum + day.total_labor_cost, 0);

    // Calculate breakdown
    const breakdown: ScheduledLaborCostBreakdown = {
      hourly: {
        cost: dailyCosts.reduce((sum, day) => sum + day.hourly_wages, 0),
        hours: dailyCosts.reduce((sum, day) => sum + day.total_hours, 0),
      },
      salary: {
        cost: dailyCosts.reduce((sum, day) => sum + day.salary_wages, 0),
        estimatedDays: Array.from(employeesScheduledPerDay.values()).filter(
          employees => salaryEmployees.some(se => employees.has(se.id))
        ).length,
      },
      contractor: {
        cost: dailyCosts.reduce((sum, day) => sum + day.contractor_payments, 0),
        estimatedDays: Array.from(employeesScheduledPerDay.values()).filter(
          employees => contractorEmployees.some(ce => employees.has(ce.id))
        ).length,
      },
      total: totalCost,
    };

    return { dailyCosts, totalCost, breakdown };
  }, [shifts, dateFrom, dateTo, restaurantId, employees]);

  return result;
}
