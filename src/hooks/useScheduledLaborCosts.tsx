import { useMemo } from 'react';
import { useEmployees } from './useEmployees';
import { Shift } from '@/types/scheduling';
import { useRestaurantClock } from './useRestaurantClock';
import {
  emptyScheduledLaborCosts,
  scheduledLaborCosts,
  type ScheduledLaborCostBreakdown,
  type ScheduledLaborCostData,
  type ScheduledLaborCostsResult,
} from '../../supabase/functions/_shared/labor/scheduledLaborCost';

export type { ScheduledLaborCostData, ScheduledLaborCostBreakdown, ScheduledLaborCostsResult };

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
  const { tz: timezone } = useRestaurantClock();

  const result = useMemo(() => {
    if (!restaurantId || employees.length === 0) {
      return emptyScheduledLaborCosts();
    }

    // The shared scheduled labor calculation (loadScheduledLaborCost uses
    // the same function).
    return scheduledLaborCosts(shifts, employees, dateFrom, dateTo, timezone);
  }, [shifts, dateFrom, dateTo, restaurantId, employees, timezone]);

  return result;
}
