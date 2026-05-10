import { format } from 'date-fns';

const ISO_DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

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
