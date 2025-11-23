/**
 * Date utility functions for testing
 */

/**
 * Gets the next occurrence of a specific day of the week
 * @param dayOfWeek - 0 (Sunday) through 6 (Saturday)
 * @param fromDate - Starting date (defaults to today)
 * @returns Date object for the next occurrence of the specified day (always future, never today)
 */
export function getNextDayOfWeek(dayOfWeek: number, fromDate: Date = new Date()): Date {
  const result = new Date(fromDate);
  const currentDay = result.getDay();
  const daysUntilTarget = (dayOfWeek + 7 - currentDay) % 7 || 7;
  result.setDate(result.getDate() + daysUntilTarget);
  return result;
}

/**
 * Formats a date as YYYY-MM-DD for input fields using local time
 * (avoids UTC conversion issues that can cause off-by-one errors)
 */
export function formatDateForInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Gets a date N days from now
 */
export function getDaysFromNow(days: number): Date {
  const result = new Date();
  result.setDate(result.getDate() + days);
  return result;
}
