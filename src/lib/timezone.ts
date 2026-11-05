import { format, toZonedTime } from 'date-fns-tz';
import { toDateOnlyString } from '@/lib/dateOnly';

/**
 * Converts a UTC date to the restaurant's local timezone for display
 * Handles both date-only strings (YYYY-MM-DD) and full timestamps
 */
export function formatDateInTimezone(date: Date | string, timezone: string, formatStr: string = 'yyyy-MM-dd'): string {
  // If it's a date-only string (YYYY-MM-DD), parse it as a local date without timezone conversion
  // This prevents the date from shifting when stored as "2025-10-20" and displayed as "Oct 19"
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split('-').map(Number);
    const dateObj = new Date(year, month - 1, day);
    return format(dateObj, formatStr);
  }
  
  // For timestamps stored as "2025-10-20 00:00:00+00" (date with time at midnight UTC),
  // extract just the date portion to avoid timezone shift issues
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}\s+00:00:00/.test(date)) {
    const datePart = date.substring(0, 10); // Extract YYYY-MM-DD
    const [year, month, day] = datePart.split('-').map(Number);
    const dateObj = new Date(year, month - 1, day);
    return format(dateObj, formatStr);
  }
  
  // For full timestamps with actual time components,
  // convert to the target timezone. The database stores dates in UTC, so we need
  // to convert them to the restaurant's local timezone for display.
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  
  // toZonedTime converts the UTC date to the target timezone's local representation
  const zonedDate = toZonedTime(dateObj, timezone);
  
  // Format the zoned date - don't pass timeZone option as the date is already in the correct zone
  return format(zonedDate, formatStr);
}

/**
 * Gets "today" in the restaurant's timezone as a UTC date string (YYYY-MM-DD)
 * This is used for filtering UTC-stored dates that should appear as "today" to the restaurant
 */
export function getTodayInTimezone(timezone: string): string {
  const now = new Date();
  return formatDateInTimezone(now, timezone, 'yyyy-MM-dd');
}

/**
 * Checks if a UTC date falls on a specific local date in the restaurant's timezone
 */
export function isDateInTimezone(utcDate: Date | string, localDateStr: string, timezone: string): boolean {
  const dateObj = typeof utcDate === 'string' ? new Date(utcDate) : utcDate;
  const localDate = formatDateInTimezone(dateObj, timezone, 'yyyy-MM-dd');
  return localDate === localDateStr;
}

/**
 * Gets the default sale date (yyyy-MM-dd) and time (HH:mm) for a new sale.
 * Both values come from the same zone, the restaurant timezone.
 */
export function getSaleDateTimeDefaults(
  timezone: string,
  now: Date = new Date(),
): { saleDate: string; saleTime: string } {
  return {
    saleDate: formatDateInTimezone(now, timezone, 'yyyy-MM-dd'),
    saleTime: formatDateInTimezone(now, timezone, 'HH:mm'),
  };
}

/**
 * Gives the end date of a default date range for the restaurant day.
 * An end date that differs from the default is a user choice, so it stays.
 */
export function alignDefaultEndDate(
  currentEnd: string,
  defaultEnd: string,
  timezone: string,
  now: Date = new Date(),
): string {
  return currentEnd === defaultEnd ? getSaleDateTimeDefaults(timezone, now).saleDate : currentEnd;
}

// Group 1 is the date text. Group 2 is its day of the month.
const NON_ISO_DATE_PATTERNS = [
  /^(\d{1,2}[/-](\d{1,2})[/-]\d{2,4})\b/,
  /^([a-z]+\.?\s+(\d{1,2}),?\s+\d{4})\b/i,
  /^((\d{1,2})\s+[a-z]+\.?,?\s+\d{4})\b/i,
];

/** Date parsers roll 02/31 over to March, so the parsed day differs from the stated day. */
function hasRolledOverDay(text: string): boolean {
  for (const pattern of NON_ISO_DATE_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return new Date(match[1]).getDate() !== Number(match[2]);
  }
  return false;
}

/**
 * Converts imported date text to a YYYY-MM-DD sale day.
 * ISO text keeps its stated day, also with a time, Z, or an offset.
 * An impossible day gives ''. Other text uses the local fields of the
 * parsed date. Bad text gives ''.
 */
export function toImportedSaleDate(text: string | null | undefined): string {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].+)?$/.exec(trimmed);
  if (match) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const check = new Date(Date.UTC(year, month - 1, day));
    const isRealDay =
      check.getUTCFullYear() === year &&
      check.getUTCMonth() === month - 1 &&
      check.getUTCDate() === day;
    return isRealDay && !isNaN(new Date(trimmed).getTime()) ? trimmed.slice(0, 10) : '';
  }
  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime()) || hasRolledOverDay(trimmed)) return '';
  return toDateOnlyString(parsed);
}
