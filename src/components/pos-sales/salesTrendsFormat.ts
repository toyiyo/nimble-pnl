/**
 * Small shared display formatters for the Sales Trends panel's sub-charts.
 *
 * `formatCurrency`/`formatHour` re-export the implementations in
 * `@/lib/salesTrends.ts` (which already needs them for `deriveInsights`'
 * copy text) rather than duplicating the logic here — this file only adds
 * `formatShortDate`, which is presentation-only and has no lib-side caller.
 */

export { formatCurrency, formatHour } from '@/lib/salesTrends';

/** `2026-07-01` -> `Jul 1` (local, no timezone conversion — sale_date is a DATE). */
export function formatShortDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) return isoDate;
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
}
