/**
 * Small shared display formatters for the Sales Trends panel's sub-charts.
 *
 * All three re-export the implementations in `@/lib/salesTrends.ts` (which
 * needs them for `deriveInsights`' copy text) rather than duplicating the
 * logic here — single source of truth.
 */

export { formatCurrency, formatHour, formatShortDate } from '@/lib/salesTrends';
