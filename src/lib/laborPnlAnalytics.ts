/**
 * Pure financial-analytics transforms for the Labor P&L feature (dashboard
 * card + `/labor` page). No React, no fetch — see
 * docs/superpowers/specs/2026-07-20-labor-financial-view-design.md §5.
 *
 * Distinct from `src/lib/splhAnalytics.ts` (the scheduling SPLH feature,
 * PR #611): that lib answers "how do I build next week's schedule" with an
 * avg-hourly-rate SPLH read. This lib answers "how did my sales run against
 * what my team cost me" with payroll-grade labor $ (see design §1.1/§4).
 */

import { mondayOf } from './splhAnalytics';
import type { SplhPoint } from './splhAnalytics';
import type { LaborCostData } from '@/hooks/useLaborCostsFromTimeTracking';

/** Per-bucket balance vs. the labor-% target (design §3). */
export type BalanceState = 'over' | 'balanced' | 'under';

/** Timeline granularity for `buildFinancialSeries` / the `/labor` page toggle. */
export type LaborGranularity = 'day' | 'week' | 'month';

/**
 * Default balance band, in percentage points, around `target_labor_pct`.
 * `labor% > target + band` → over; `labor% < target - band` → under;
 * otherwise balanced (design §3). Configurable per-call via `classifyBalance`'s
 * `band` param — this is only the default.
 */
export const LABOR_BALANCE_BAND = 6;

/**
 * One bucket (day/week/month) of the demand-vs-staffing series
 * (`buildFinancialSeries`, design §5). `laborPct` is `null` — never
 * `Infinity` — when `sales <= 0` (design §6).
 */
export interface FinancialPoint {
  /** Local YYYY-MM-DD (Monday for week, first-of-month for month). */
  bucketStart: string;
  label: string;
  sales: number;
  laborCost: number;
  laborHours: number;
  laborPct: number | null;
  balanceState: BalanceState;
}

/**
 * One (day-of-week, hour) cell of the busy-hours sales-volume heatmap
 * (`buildSalesVolumeGrid`, design §5) — a distinct read from the SPLH
 * efficiency heatmap's per-cell SPLH coloring.
 */
export interface SalesVolumeCell {
  /** 0=Sun..6=Sat, matching `SplhGridCell.dow`. */
  dow: number;
  hour: number;
  totalSales: number;
  /** Normalized 0..1 against the window's max cell — never NaN. */
  intensity: number;
  /** True at/above the prototype's peak threshold (≥72% of window max). */
  peak: boolean;
  /** Passed through from the underlying `SplhGridCell`'s daily-spread fallback. */
  estimated: boolean;
}

/** A contiguous run of over/under buckets surfaced as a staffing callout. */
export interface LaborBalanceWindow {
  startLabel: string;
  endLabel: string;
  bucketCount: number;
}

/**
 * Period summary for the KPI row / dashboard card verdict
 * (`summarizeLaborPnl`, design §5). `verdictTone` adds `'none'` for the
 * no-data case, mirroring `SplhSummary.verdictTone`.
 */
export interface LaborPnlSummary {
  sales: number;
  laborCost: number;
  laborPct: number | null;
  revPerLaborHr: number | null;
  verdict: string;
  verdictTone: BalanceState | 'none';
  overWindows: LaborBalanceWindow[];
  underWindows: LaborBalanceWindow[];
}

/**
 * Classifies a labor-% reading against `targetPct` ± `band` (design §3).
 * Guards: `targetPct <= 0` and a `null` `laborPct` (a no-sales bucket, per
 * `FinancialPoint.laborPct`) both return `'balanced'` rather than
 * mis-signaling over/under on data that isn't there.
 */
export function classifyBalance(
  laborPct: number | null,
  targetPct: number,
  band: number = LABOR_BALANCE_BAND,
): BalanceState {
  if (targetPct <= 0 || laborPct === null) return 'balanced';
  if (laborPct > targetPct + band) return 'over';
  if (laborPct < targetPct - band) return 'under';
  return 'balanced';
}

/**
 * Calendar-month bucket key (`YYYY-MM`) for a local `YYYY-MM-DD` date. Pure
 * string/UTC math — TZ-portable, no `Date`-local-offset surprises (design §5).
 */
export function monthKeyOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/**
 * Bucket key for `buildFinancialSeries` (design §5): day passes the date
 * through unchanged; week reuses `splhAnalytics.mondayOf` (the existing
 * Monday-start rule, design §5); month uses `monthKeyOf`.
 */
export function bucketKeyOf(dateStr: string, granularity: LaborGranularity): string {
  switch (granularity) {
    case 'week':
      return mondayOf(dateStr);
    case 'month':
      return monthKeyOf(dateStr);
    default:
      return dateStr;
  }
}

/** Rounds to 2 decimal places, matching `buildSplhTimeseries`'s $ rounding. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Joins a real daily sales series (`buildSplhTimeseries(..., 'day')`) with a
 * real daily labor series (`useLaborCostsFromTimeTracking.dailyCosts`) on
 * restaurant-local date, then rolls both up to the requested granularity
 * (design §5). This is an **outer join**: a bucket appears if it has sales,
 * labor, or both — a labor-only or sales-only day is never dropped (design
 * §4/§6). `laborPct` is `null` — never `Infinity` — when the bucket's `sales`
 * is `<= 0` (design §6), matching `FinancialPoint.laborPct` / `classifyBalance`.
 */
export function buildFinancialSeries(
  dailySales: SplhPoint[],
  dailyLabor: LaborCostData[],
  granularity: LaborGranularity,
  targetPct: number,
): FinancialPoint[] {
  const salesByBucket = new Map<string, number>();
  const laborCostByBucket = new Map<string, number>();
  const laborHoursByBucket = new Map<string, number>();

  for (const point of dailySales) {
    const bucket = bucketKeyOf(point.bucketStart, granularity);
    salesByBucket.set(bucket, (salesByBucket.get(bucket) ?? 0) + point.totalSales);
  }
  for (const day of dailyLabor) {
    const bucket = bucketKeyOf(day.date, granularity);
    laborCostByBucket.set(bucket, (laborCostByBucket.get(bucket) ?? 0) + day.total_labor_cost);
    laborHoursByBucket.set(bucket, (laborHoursByBucket.get(bucket) ?? 0) + day.total_hours);
  }

  const buckets = Array.from(
    new Set([...salesByBucket.keys(), ...laborCostByBucket.keys()]),
  ).sort((a, b) => a.localeCompare(b));

  return buckets.map((bucketStart) => {
    const sales = round2(salesByBucket.get(bucketStart) ?? 0);
    const laborCost = round2(laborCostByBucket.get(bucketStart) ?? 0);
    const laborHours = round2(laborHoursByBucket.get(bucketStart) ?? 0);
    const laborPct = sales > 0 ? round2((laborCost / sales) * 100) : null;
    return {
      bucketStart,
      label: bucketStart,
      sales,
      laborCost,
      laborHours,
      laborPct,
      balanceState: classifyBalance(laborPct, targetPct),
    };
  });
}
