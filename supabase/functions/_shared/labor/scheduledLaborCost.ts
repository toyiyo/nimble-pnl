/**
 * Scheduled labor cost: the estimate of the Scheduling page
 * (`useScheduledLaborCosts`) for a period of whole restaurant days.
 *
 * - The shift window is instants (`windowStart` / `windowEnd`) from the day
 *   strings and the restaurant timezone. It filters `start_time`, as
 *   `useShifts` does.
 * - The engine gets day tokens (`dayStart` / `dayEnd`).
 * - The employees are all employees (`status: 'all'`, as
 *   `useScheduledLaborCosts` reads them), so a past shift of an inactive
 *   employee still has its employee.
 * - Both reads page with `fetchAllRowsKeyset`.
 */
import { fetchAllKeyset, fetchLaborEmployees, fromTable } from './loaderQuery.ts';
import { calculateScheduledLaborCost } from './laborCalculations.ts';
import { businessDayRangeToInstants } from './restaurantClock.ts';
import { assertDayRange, dayTokens } from './dateOnly.ts';
import type { LaborEmployee, LaborQueryClient, LaborShift } from './types.ts';

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

/** The empty result (no restaurant or no employees). */
export function emptyScheduledLaborCosts(): ScheduledLaborCostsResult {
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

/**
 * `calculateScheduledLaborCost` in the shape of the Scheduling page. The
 * hook and the loader both use it, so the two cannot drift apart.
 */
export function scheduledLaborCosts(
  shifts: LaborShift[],
  employees: LaborEmployee[],
  dayStart: Date,
  dayEnd: Date,
  timezone: string,
): ScheduledLaborCostsResult {
  const { breakdown: serviceBreakdown, dailyCosts: serviceDailyCosts } =
    calculateScheduledLaborCost(shifts, employees, dayStart, dayEnd, timezone);

  const dailyCosts: ScheduledLaborCostData[] = serviceDailyCosts.map((day) => ({
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

  return { dailyCosts, totalCost: serviceBreakdown.total, breakdown };
}

export interface ScheduledLaborCostInput {
  restaurantId: string;
  /** First restaurant day, `YYYY-MM-DD`. The Scheduling page uses a Monday. */
  startDay: string;
  /** Last restaurant day (inclusive), `YYYY-MM-DD`. */
  endDay: string;
  /** Restaurant IANA timezone. */
  timeZone: string;
}

export interface LoadedScheduledLaborCost extends ScheduledLaborCostsResult {
  /** True when a paged read hit the `maxPages` cap. */
  capped: boolean;
}

/** The `shifts` columns that the engine reads, plus the cursor id. */
export const SHIFT_COLUMNS = 'id, employee_id, start_time, end_time, break_duration';

type ShiftRow = LaborShift & { id: string };

/**
 * Scheduled labor cost of a period of whole restaurant days: the shifts
 * that start in the period, all employees, and
 * `calculateScheduledLaborCost`.
 */
export async function loadScheduledLaborCost(
  client: LaborQueryClient,
  input: ScheduledLaborCostInput,
): Promise<LoadedScheduledLaborCost> {
  const { restaurantId, startDay, endDay, timeZone } = input;
  assertDayRange('loadScheduledLaborCost', startDay, endDay);
  const { start: windowStart, end: windowEnd } = businessDayRangeToInstants(startDay, endDay, timeZone);
  const { dayStart, dayEnd } = dayTokens(startDay, endDay);

  const [{ rows: shifts, capped: shiftsCapped }, { rows: employees, capped: employeesCapped }] =
    await Promise.all([
      fetchAllKeyset<ShiftRow, 'start_time'>(
        () =>
          fromTable(client, 'shifts')
            .select(SHIFT_COLUMNS)
            .eq('restaurant_id', restaurantId)
            .gte('start_time', windowStart.toISOString())
            .lte('start_time', windowEnd.toISOString()),
        'start_time',
      ),
      // All employees, as useEmployees(restaurantId, { status: 'all' }).
      fetchLaborEmployees(client, restaurantId),
    ]);

  const result =
    employees.length === 0
      ? emptyScheduledLaborCosts()
      : scheduledLaborCosts(shifts, employees, dayStart, dayEnd, timeZone);

  return { ...result, capped: shiftsCapped || employeesCapped };
}
