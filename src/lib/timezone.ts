import { format, toZonedTime } from 'date-fns-tz';

/**
 * Converts a UTC date to the restaurant's local timezone for display
 */
export function formatDateInTimezone(date: Date | string, timezone: string, formatStr: string = 'yyyy-MM-dd'): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const zonedDate = toZonedTime(dateObj, timezone);
  return format(zonedDate, formatStr, { timeZone: timezone });
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