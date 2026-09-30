/**
 * Format a cash runway value in days for display.
 * A value above 365 shows as "365+". Other values round down to a whole day.
 */
export function formatRunway(days: number): string {
  if (days > 365) return '365+';
  return Math.floor(days).toString();
}
