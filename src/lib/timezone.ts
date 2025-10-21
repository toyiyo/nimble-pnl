import { format, toZonedTime } from 'date-fns-tz';

/**
 * Converts a UTC date to the restaurant's local timezone for display
 * If given a date-only string (YYYY-MM-DD), treats it as a local date without conversion
 */
export function formatDateInTimezone(date: Date | string, timezone: string, formatStr: string = 'yyyy-MM-dd'): string {
  // If it's a date-only string (YYYY-MM-DD), parse it as a local date without timezone conversion
  // This prevents the date from shifting when stored as "2025-10-20" and displayed as "Oct 19"
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split('-').map(Number);
    const dateObj = new Date(year, month - 1, day);
    return format(dateObj, formatStr);
  }
  
  // For full timestamps, convert to the target timezone
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