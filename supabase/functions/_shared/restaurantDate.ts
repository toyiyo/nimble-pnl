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

/** Whole calendar days from `fromYmd` to `toYmd` (both 'YYYY-MM-DD'). */
export function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = fromYmd.split('-').map(Number);
  const [ty, tm, td] = toYmd.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/**
 * "Now" for the labor paths of the AI tools.
 *
 * The labor paths keep the server clock. laborCalculations.ts puts each punch
 * into a day by runtime-local (UTC) fields, so a restaurant-day window would
 * drop the evening clock-ins. See
 * docs/superpowers/specs/2026-09-24-ai-chat-restaurant-today-design.md.
 */
export function laborServerNow(): Date {
  return new Date();
}

/**
 * Return why labor figures must be omitted when the labor window (server
 * clock) and the sales window (restaurant clock) are different days.
 * Return undefined when the two windows agree.
 */
export function laborWindowMismatchReason(
  sales: Pick<DateRange, 'startDateStr' | 'endDateStr'>,
  labor: Pick<DateRange, 'startDateStr' | 'endDateStr'>,
): string | undefined {
  if (sales.startDateStr === labor.startDateStr && sales.endDateStr === labor.endDateStr) {
    return undefined;
  }
  return (
    'Labor cost, prime cost, and profitability figures are omitted for this period. ' +
    "The labor calculation uses UTC days, and the UTC date is not the restaurant's local date now."
  );
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
 * Calculate the date range for a period string.
 *
 * `now` sets "today". For restaurant days, pass
 * `restaurantWallClock(new Date(), timeZone)`. The labor paths pass
 * `laborServerNow()`. The start and end Dates are wall-clock Dates: use
 * startDateStr / endDateStr for day filters.
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
