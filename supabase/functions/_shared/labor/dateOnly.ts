import { format } from 'date-fns/format';

const ISO_DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar-day string, `YYYY-MM-DD`. Format only: no calendar check. */
export const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True when `day` is `YYYY-MM-DD` and names a real calendar day. UTC field
 * math, so the host timezone does not change the result. `2026-02-30` rolls
 * to `2026-03-02` and fails.
 */
function isCalendarDay(day: unknown): day is string {
  if (typeof day !== 'string' || !DATE_ONLY_RE.test(day)) return false;
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date)).toISOString().slice(0, 10) === day;
}

/**
 * Check the day range of a labor loader at its entry. Throws a clear error
 * that names the loader, before any read, when a bound is not a calendar day
 * (`YYYY-MM-DD`) or when `startDay` is after `endDay`.
 */
export function assertDayRange(fn: string, startDay: string, endDay: string): void {
  if (!isCalendarDay(startDay)) {
    throw new Error(`${fn}: startDay must be a calendar day (YYYY-MM-DD), received ${JSON.stringify(startDay)}`);
  }
  if (!isCalendarDay(endDay)) {
    throw new Error(`${fn}: endDay must be a calendar day (YYYY-MM-DD), received ${JSON.stringify(endDay)}`);
  }
  if (startDay > endDay) {
    throw new Error(`${fn}: startDay ${startDay} is after endDay ${endDay}`);
  }
}

/**
 * Parse a YYYY-MM-DD calendar-day string into a Date anchored at LOCAL midnight.
 *
 * Sidesteps the trap that `new Date("2026-05-29")` parses as UTC midnight per
 * the ECMAScript spec — which then renders as the previous day in any browser
 * TZ behind UTC (US, all of the Americas, etc.). Postgres `DATE` columns are
 * pure calendar days; this helper preserves them as such.
 */
export function parseDateOnly(value: string): Date {
  const match = ISO_DATE_ONLY_RE.exec(value);
  if (!match) {
    throw new Error(`Invalid date-only string: ${JSON.stringify(value)}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const d = new Date(year, month - 1, day);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    throw new Error(`Invalid date-only string: ${JSON.stringify(value)}`);
  }
  return d;
}

/**
 * The engine day token for the end of a calendar day: the local end of the
 * day (23:59:59.999) of the `YYYY-MM-DD` string. The engine reads its local
 * fields, so it names that day on every host.
 */
export function dayTokenEnd(day: string): Date {
  const end = parseDateOnly(day);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * The engine day tokens for an inclusive day range: local midnight of
 * `startDay` and the local end of `endDay`. They are not instants. A loader
 * gives them to the engine period arguments, never to a query filter.
 */
export function dayTokens(startDay: string, endDay: string): { dayStart: Date; dayEnd: Date } {
  return { dayStart: parseDateOnly(startDay), dayEnd: dayTokenEnd(endDay) };
}

/**
 * Convert a Date object (typically from a calendar/date picker) into a YYYY-MM-DD
 * calendar-day string using LOCAL fields. Appropriate for storing a calendar
 * day the user clicked on into a Postgres DATE column — no UTC math.
 */
export function toDateOnlyString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format a YYYY-MM-DD calendar-day string for display via date-fns.
 * Always parses as local midnight first, so format() renders the correct day
 * regardless of browser TZ.
 */
export function formatDateOnly(value: string, pattern = 'MMM d, yyyy'): string {
  return format(parseDateOnly(value), pattern);
}

/**
 * Convert a YYYY-MM-DD calendar-day string into an inclusive upper bound for
 * a `timestamptz` column filter. A bare 'yyyy-MM-dd' bound on `.lte()` reads
 * as midnight and drops the whole final day, so callers filtering a
 * `timestamptz` column by calendar day must pass this to `.lte()` instead of
 * the bare date string.
 */
export function toInclusiveDayEnd(dateOnly: string): string {
  return `${dateOnly}T23:59:59.999Z`;
}
