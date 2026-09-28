/**
 * scheduleOverview.ts
 *
 * Restaurant-day grouping and period logic for the get_schedule_overview AI
 * tool. Pure, with no Deno imports, so Vitest can import this file.
 *
 * A shift's start_time is a UTC instant. Group it by the restaurant's local
 * calendar day (ymdInTimeZone), not the server's UTC day, so a late shift
 * lands on the day staff mean.
 */

import { addDays, calculateDateRange, ymdInTimeZone, toLocalYMD, PeriodType } from './restaurantDate.ts';

export interface ScheduleShiftInput {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
  position?: string | null;
  employee?: { name?: string | null; position?: string | null } | null;
}

export interface ScheduleShiftRow {
  id: string;
  employee_name: string;
  position: string | null;
  start_time: string;
  end_time: string;
  status: string;
}

/**
 * Group shifts by their restaurant calendar day in `timeZone`. Keeps each
 * day's shifts in the order they arrive (the caller sorts, this groups).
 */
export function groupShiftsByRestaurantDay(
  shifts: ScheduleShiftInput[],
  timeZone: string
): Record<string, ScheduleShiftRow[]> {
  const byDate: Record<string, ScheduleShiftRow[]> = {};
  for (const shift of shifts) {
    const dateKey = ymdInTimeZone(new Date(shift.start_time), timeZone);
    if (!byDate[dateKey]) {
      byDate[dateKey] = [];
    }
    byDate[dateKey].push({
      id: shift.id,
      employee_name: shift.employee?.name || 'Unknown',
      position: shift.position || shift.employee?.position || null,
      start_time: shift.start_time,
      end_time: shift.end_time,
      status: shift.status,
    });
  }
  return byDate;
}

/**
 * The start/end restaurant days for get_schedule_overview.
 *
 * `now` must already be the restaurant wall clock (see
 * restaurantWallClock in restaurantDate.ts). 'week' and 'month' look
 * forward from today, unlike calculateDateRange's backward-looking
 * defaults. Every other period defers to calculateDateRange.
 */
export function scheduleOverviewDays(
  period: PeriodType,
  startDateArg: string | undefined,
  endDateArg: string | undefined,
  now: Date
): { startDateStr: string; endDateStr: string } {
  if (period === 'week') {
    return { startDateStr: toLocalYMD(now), endDateStr: toLocalYMD(addDays(now, 7)) };
  }
  if (period === 'month') {
    // One month out from today, day clamped to the target month's last day
    // (2026-01-31 + 1 month -> 2026-02-28, not an overflow into March).
    const targetMonth = now.getMonth() + 1;
    const daysInTargetMonth = new Date(now.getFullYear(), targetMonth + 1, 0).getDate();
    const day = Math.min(now.getDate(), daysInTargetMonth);
    const end = new Date(now.getFullYear(), targetMonth, day);
    return { startDateStr: toLocalYMD(now), endDateStr: toLocalYMD(end) };
  }
  const range = calculateDateRange(period, startDateArg, endDateArg, now);
  return { startDateStr: range.startDateStr, endDateStr: range.endDateStr };
}
