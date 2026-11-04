/**
 * Format a cash runway value in days for display.
 * A value above 365 shows as "365+". Other values round down to a whole day.
 */
export function formatRunway(days: number): string {
  if (days > 365) return '365+';
  return Math.floor(days).toString();
}

/**
 * Format a cash runway value with its unit, for example "168 days".
 * The dashboard top card and the Banking section both use this, so the
 * same value shows with the same words in both places. No burn
 * (Infinity) shows as "Cash growing".
 */
export function formatRunwayDays(days: number): string {
  if (days === Infinity) return 'Cash growing';
  const value = formatRunway(days);
  return `${value} ${value === '1' ? 'day' : 'days'}`;
}
