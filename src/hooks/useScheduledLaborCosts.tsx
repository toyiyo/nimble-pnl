import { useMemo } from 'react';
import { useEmployees } from './useEmployees';
import { Shift } from '@/types/scheduling';
import { calculateScheduledLaborCost } from '@/services/laborCalculations';

export interface ScheduledLaborCostData {
  date: string;
  total_labor_cost: number;
  hourly_wages: number;
  salary_wages: number;
  contractor_payments: number;
  daily_rate_wages: number;
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
  daily_rate: {
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
  // Fetch ALL employees (including inactive) for historical labor cost accuracy
  // Shifts from inactive employees should still be counted in past periods
  const { employees } = useEmployees(restaurantId, { status: 'all' });

  const result = useMemo(() => {
    if (!restaurantId || employees.length === 0) {
      return {
        dailyCosts: [],
        totalCost: 0,
        breakdown: {
          hourly: { cost: 0, hours: 0 },
          salary: { cost: 0, estimatedDays: 0 },
          contractor: { cost: 0, estimatedDays: 0 },
          daily_rate: { cost: 0, estimatedDays: 0 },
          total: 0,
        },
      };
    }

    // Use centralized labor calculation service
    const { breakdown: serviceBreakdown, dailyCosts: serviceDailyCosts } = 
      calculateScheduledLaborCost(shifts, employees, dateFrom, dateTo);

    // Transform service output to match hook interface
    const dailyCosts: ScheduledLaborCostData[] = serviceDailyCosts.map(day => ({
      date: day.date,
      total_labor_cost: day.total_cost,
      hourly_wages: day.hourly_cost,
      salary_wages: day.salary_cost,
      contractor_payments: day.contractor_cost,
      daily_rate_wages: day.daily_rate_cost,
      total_hours: day.hours_worked,
    }));

    const breakdown: ScheduledLaborCostBreakdown = {
      hourly: {
        cost: serviceBreakdown.hourly.cost,
        hours: serviceBreakdown.hourly.hours,
      },
      salary: {
        cost: serviceBreakdown.salary.cost,
        estimatedDays: serviceBreakdown.salary.daysScheduled,
      },
      contractor: {
        cost: serviceBreakdown.contractor.cost,
        estimatedDays: serviceBreakdown.contractor.daysScheduled,
      },
      daily_rate: {
        cost: serviceBreakdown.daily_rate.cost,
        estimatedDays: serviceBreakdown.daily_rate.daysScheduled,
      },
      total: serviceBreakdown.total,
    };

    const totalCost = serviceBreakdown.total;

    return { dailyCosts, totalCost, breakdown };
  }, [shifts, dateFrom, dateTo, restaurantId, employees]);

  return result;
}
