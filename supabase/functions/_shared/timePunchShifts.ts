/**
 * timePunchShifts.ts
 *
 * Restaurant-day shift rows for the get_time_punches AI tool. Pure, with no
 * Deno imports, so Vitest can import this file.
 *
 * A punch's clock-in time is a UTC instant. `date` groups it by the
 * restaurant's local calendar day (ymdInTimeZone), not the server's UTC day,
 * so a late clock-in lands on the day staff mean.
 *
 * This module does not call calculateHoursPerEmployee. That function also
 * feeds startDate/endDate to calculateSalaryForPeriod and
 * calculateContractorPayForPeriod, which read UTC calendar fields — an
 * instant bounds would count one extra day. The get_time_punches output
 * never reads those totals, so this module skips that path.
 */

import { Employee, CompensationType, TimePunch, parseWorkPeriods, getEmployeeSnapshotForDate } from './laborCalculations.ts';
import { ymdInTimeZone } from './restaurantDate.ts';

export interface TimePunchShift {
  employee_id: string;
  employee_name: string;
  position: string | null;
  compensation_type: CompensationType;
  start_time: string;
  end_time: string;
  hours: number;
  cost_cents: number | null;
  date: string;
}

/**
 * Build one row per work period (clock-in/out pair), scoped to `bounds`.
 *
 * Keeps a period when `bounds.start <= startTime <= bounds.end`, it is not a
 * break, and `hours >= minHours`. An overnight period whose clock-out lands
 * after `bounds.end` is still kept — only the clock-in decides membership.
 *
 * `date` is `ymdInTimeZone(startTime, timeZone)`. The pay snapshot for cost
 * uses that same day: an hourly snapshot gives `hourly_rate x hours`; salary,
 * contractor, and daily_rate give `null` (period-allocated, not per-shift).
 */
export function buildTimePunchShifts(
  employees: Employee[],
  punches: TimePunch[],
  bounds: { start: Date; end: Date },
  timeZone: string,
  minHours: number,
): TimePunchShift[] {
  const employeesById: Record<string, Employee> = {};
  for (const employee of employees) {
    employeesById[employee.id] = employee;
  }

  const punchesByEmployee: Record<string, TimePunch[]> = {};
  for (const punch of punches) {
    if (!punchesByEmployee[punch.employee_id]) {
      punchesByEmployee[punch.employee_id] = [];
    }
    punchesByEmployee[punch.employee_id].push(punch);
  }

  const shifts: TimePunchShift[] = [];

  for (const [employeeId, employeePunches] of Object.entries(punchesByEmployee)) {
    const employee = employeesById[employeeId];
    if (!employee) continue;

    const { periods } = parseWorkPeriods(employeePunches);

    for (const period of periods) {
      if (period.isBreak) continue;
      if (period.hours < minHours) continue;
      if (period.startTime < bounds.start || period.startTime > bounds.end) continue;

      const day = ymdInTimeZone(period.startTime, timeZone);
      const snapshot = getEmployeeSnapshotForDate(employee, day);
      const cost_cents =
        snapshot.compensation_type === 'hourly' && snapshot.hourly_rate
          ? Math.round(snapshot.hourly_rate * period.hours)
          : null;

      shifts.push({
        employee_id: employeeId,
        employee_name: employee.name,
        position: employee.position ?? null,
        compensation_type: snapshot.compensation_type,
        start_time: period.startTime.toISOString(),
        end_time: period.endTime.toISOString(),
        hours: Number(period.hours.toFixed(4)),
        cost_cents,
        date: day,
      });
    }
  }

  return shifts;
}
