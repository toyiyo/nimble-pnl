/**
 * restaurantDate.ts
 *
 * Calendar-day helpers for the AI tools. Pure, with no Deno imports, so
 * Vitest can import this file.
 *
 * Edge functions run in UTC. After 19:00 CDT the UTC date is the next day, so
 * "today" from the server clock is the wrong restaurant day. Use
 * `restaurantWallClock` to get "now" for the restaurant, then do the day math
 * on its local fields.
 *
 * Rule: a wall-clock Date is not a real instant. Build it only with the local
 * constructor. Never call toISOString() or getTime() on it to get an instant.
 * Use toLocalYMD() to get its calendar day.
 */

import { safeTz, tzOffsetMs } from './timezone.ts';

/**
 * Return the wall clock of `timeZone` at `instant`, shifted into UTC fields.
 * An invalid zone falls back to the restaurant default (see `safeTz`).
 */
function wallClockAsUtcFields(instant: Date, timeZone: string): Date {
  const tz = safeTz(timeZone);
  return new Date(instant.getTime() + tzOffsetMs(instant, tz));
}

/**
 * Return a Date whose local fields (getFullYear, getMonth, getDate,
 * getHours, ...) equal the wall clock of `timeZone` at `instant`.
 */
export function restaurantWallClock(instant: Date, timeZone: string): Date {
  const w = wallClockAsUtcFields(instant, timeZone);
  return new Date(
    w.getUTCFullYear(),
    w.getUTCMonth(),
    w.getUTCDate(),
    w.getUTCHours(),
    w.getUTCMinutes(),
    w.getUTCSeconds(),
  );
}

/** The 'YYYY-MM-DD' calendar day of `instant` in `timeZone`. */
export function ymdInTimeZone(instant: Date, timeZone: string): string {
  const w = wallClockAsUtcFields(instant, timeZone);
  const m = String(w.getUTCMonth() + 1).padStart(2, '0');
  const d = String(w.getUTCDate()).padStart(2, '0');
  return `${w.getUTCFullYear()}-${m}-${d}`;
}

/** Move a local-field Date by `days` calendar days. */
export function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes(), d.getSeconds());
}

/**
 * "Now" for a restaurant, plus its timezone. `now` is a wall-clock Date (see
 * the rule at the top of this file).
 */
export interface RestaurantClock {
  now: Date;
  timeZone: string;
}

export interface DateRange {
  startDate: Date;
  endDate: Date;
  startDateStr: string;
  endDateStr: string;
}

export type PeriodType =
  | 'today' | 'yesterday' | 'tomorrow'
  | 'week' | 'month' | 'quarter' | 'year'
  | 'current_week' | 'last_week' | 'current_month' | 'last_month'
  | 'custom';

// Format a Date's local calendar fields as 'YYYY-MM-DD'. Mirrors
// src/lib/dateOnly.ts toDateOnlyString(), which Deno cannot import. Use this
// (never toISOString().split('T')[0]) for a Date that holds a calendar day.
// toISOString reads UTC fields and can give the previous or next day.
export const toLocalYMD = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/**
 * Calculate date range from period string
 * Centralizes the repeated date calculation logic across tool handlers
 */
export function calculateDateRange(
  period: PeriodType,
  customStartDate: string | undefined,
  customEndDate: string | undefined,
  now: Date
): DateRange {
  let startDate: Date;
  let endDate: Date = now;

  switch (period) {
    case 'today':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      break;
    case 'yesterday':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);
      break;
    case 'tomorrow':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 59);
      break;
    case 'week':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      break;
    case 'current_week': {
      const dayOfWeek = now.getDay();
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (6 - dayOfWeek), 23, 59, 59);
      break;
    }
    case 'last_week': {
      const dayOfWeek = now.getDay();
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek - 7);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek - 1, 23, 59, 59);
      break;
    }
    case 'month':
    case 'current_month':
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      break;
    case 'last_month':
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      break;
    case 'quarter': {
      const quarter = Math.floor(now.getMonth() / 3);
      startDate = new Date(now.getFullYear(), quarter * 3, 1);
      break;
    }
    case 'year':
      startDate = new Date(now.getFullYear(), 0, 1);
      break;
    case 'custom':
      if (!customStartDate || !customEndDate) {
        throw new Error('Custom period requires start_date and end_date');
      }
      const [sy, sm, sd] = customStartDate.split('-').map(Number);
      startDate = new Date(sy, sm - 1, sd);
      const [ey, em, ed] = customEndDate.split('-').map(Number);
      // End-of-day so the inclusive range matches every other branch above.
      endDate = new Date(ey, em - 1, ed, 23, 59, 59);
      break;
    default:
      // Default to current week
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
  }

  return {
    startDate,
    endDate,
    startDateStr: toLocalYMD(startDate),
    endDateStr: toLocalYMD(endDate),
  };
}
