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

/** Per-bucket balance vs. the labor-% target (design §3). */
export type BalanceState = 'over' | 'balanced' | 'under';

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
