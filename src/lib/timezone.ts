import { format, toZonedTime } from 'date-fns-tz';

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