/**
 * Small shared display formatters for the Sales Trends panel's sub-charts.
 *
 * Kept out of `@/lib/salesTrends.ts` (which is deliberately React-free and
 * unit-tested in isolation) — these are pure but presentation-only, so they
 * live next to the components that use them.
 */

export function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export function formatHour(hour: number): string {
  const period = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}${period}`;
}

/** `2026-07-01` -> `Jul 1` (local, no timezone conversion — sale_date is a DATE). */
export function formatShortDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) return isoDate;
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
}
