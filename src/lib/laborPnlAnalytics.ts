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
import type { SplhPoint, SplhGridCell } from './splhAnalytics';
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
 * Fraction of a busy-hours window's max cell (0..1) at/above which a
 * `SalesVolumeCell` is flagged `peak` (design §5: "≥72% of max, matching
 * prototype").
 */
export const SALES_VOLUME_PEAK_THRESHOLD = 0.72;

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

/**
 * Locale-aware comparator for bucket keys (`bucketKeyOf`'s output: ISO
 * `YYYY-MM-DD` day/week-Monday keys, or `YYYY-MM` month keys). SonarCloud
 * rule S2871 flags any `.sort()` on a Sonar-scoped array without an explicit
 * comparator, even when the default lexicographic sort happens to already be
 * correct for ISO strings (memory/lessons.md) — pass this to `Array.sort`
 * directly wherever bucket keys are ordered.
 */
export function bucketKeyComparator(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Rounds to 2 decimal places, matching `buildSplhTimeseries`'s $ rounding. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Rounds to 1 decimal place — used for the verdict's `%`/`pt` display only. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
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
  ).sort(bucketKeyComparator);

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

/**
 * Builds the busy-hours sales-volume grid (design §5) from the SPLH
 * feature's existing per-(dow,hour) `SplhGridCell[]` (`buildSplhGrid`,
 * reused without modification). `intensity` normalizes each cell's
 * `totalSales` against the window's max cell (0 when the window is entirely
 * zero — never `NaN`); `peak` flags cells at/above
 * `SALES_VOLUME_PEAK_THRESHOLD`. `estimated` is **not** per-cell on
 * `SplhGridCell` — `buildSplhGrid` either derives every cell from real
 * per-sale hours or spreads every cell from the daily-total fallback (never
 * a mix, design §6) — so callers pass the single window-level flag through,
 * mirroring `SplhHeatmap`'s `estimated` prop (`!hasHourlyBreakdown`).
 */
export function buildSalesVolumeGrid(
  cells: SplhGridCell[],
  estimated: boolean,
): SalesVolumeCell[] {
  const maxSales = cells.reduce((max, cell) => Math.max(max, cell.totalSales), 0);
  return cells.map((cell) => {
    const intensity = maxSales > 0 ? cell.totalSales / maxSales : 0;
    return {
      dow: cell.dow,
      hour: cell.hour,
      totalSales: cell.totalSales,
      intensity,
      peak: intensity >= SALES_VOLUME_PEAK_THRESHOLD,
      estimated,
    };
  });
}

/**
 * Collapses `points` (already bucket-ordered by `buildFinancialSeries`) into
 * contiguous runs sharing `state`, for `summarizeLaborPnl`'s
 * `overWindows`/`underWindows` staffing callouts (design §5/§8). "Contiguous"
 * means adjacent *array entries*, not necessarily adjacent calendar dates —
 * `buildFinancialSeries` already drops no buckets (outer join), so for a
 * caller-supplied window without gaps the two coincide.
 */
function extractBalanceWindows(
  points: readonly FinancialPoint[],
  state: BalanceState,
): LaborBalanceWindow[] {
  const windows: LaborBalanceWindow[] = [];
  let runStart: number | null = null;
  for (let i = 0; i < points.length; i++) {
    if (points[i].balanceState === state) {
      if (runStart === null) runStart = i;
    } else if (runStart !== null) {
      windows.push({
        startLabel: points[runStart].label,
        endLabel: points[i - 1].label,
        bucketCount: i - runStart,
      });
      runStart = null;
    }
  }
  if (runStart !== null) {
    windows.push({
      startLabel: points[runStart].label,
      endLabel: points[points.length - 1].label,
      bucketCount: points.length - runStart,
    });
  }
  return windows;
}

/**
 * Rolls a `FinancialPoint[]` window up into the KPI-row / verdict-line
 * summary (design §5, §2.1/§2.2). Totals are re-summed from `points` rather
 * than trusting any single point's `laborPct`, so the summary always agrees
 * with the series it was built from. `verdictTone` is `'none'` — distinct
 * from `classifyBalance`'s per-bucket `'balanced'` guard — when there isn't
 * enough data to say anything (empty series, or `laborPct` is `null` because
 * the window has no sales), mirroring `SplhSummary.verdictTone`'s `'none'`.
 */
export function summarizeLaborPnl(
  points: readonly FinancialPoint[],
  targetPct: number,
): LaborPnlSummary {
  const sales = round2(points.reduce((sum, p) => sum + p.sales, 0));
  const laborCost = round2(points.reduce((sum, p) => sum + p.laborCost, 0));
  const laborHours = round2(points.reduce((sum, p) => sum + p.laborHours, 0));
  const laborPct = sales > 0 ? round2((laborCost / sales) * 100) : null;
  const revPerLaborHr = laborHours > 0 ? round2(sales / laborHours) : null;
  const overWindows = extractBalanceWindows(points, 'over');
  const underWindows = extractBalanceWindows(points, 'under');

  if (laborPct === null) {
    return {
      sales,
      laborCost,
      laborPct,
      revPerLaborHr,
      verdict: 'Not enough data to assess labor yet.',
      verdictTone: 'none',
      overWindows,
      underWindows,
    };
  }

  const verdictTone = classifyBalance(laborPct, targetPct);
  const pctLabel = round1(laborPct);
  const deltaLabel = round1(Math.abs(laborPct - targetPct));
  let verdict: string;
  if (verdictTone === 'over') {
    verdict = `Labor ran ${pctLabel}% of sales — ${deltaLabel}pt over target.`;
  } else if (verdictTone === 'under') {
    verdict = `Labor ran ${pctLabel}% of sales — ${deltaLabel}pt under target.`;
  } else {
    verdict = `Labor ran ${pctLabel}% of sales — right on your ${targetPct}% target.`;
  }
  if (revPerLaborHr !== null) {
    verdict += ` Team earned $${Math.round(revPerLaborHr)}/labor-hour.`;
  }

  return { sales, laborCost, laborPct, revPerLaborHr, verdict, verdictTone, overWindows, underWindows };
}

/**
 * Pure: balance tone -> inline text color, using the dedicated
 * `--labor-over` / `--labor-under` / `--labor-balanced` tokens (design §7,
 * added in `src/index.css` by Phase B). Deliberately **not** reusing
 * `splhAnalytics.verdictToneClassName`'s `--splh-lean/slack` tokens: those
 * are semantically inverted here (`--splh-lean` = red = *understaffed*)
 * and both cards can be on-screen together, so sharing tokens would make
 * red mean opposite things on adjacent cards. Returns `''` for `'none'` so
 * callers' default `text-muted-foreground` className applies instead of
 * forcing a color, mirroring `verdictToneClassName`'s no-data case.
 */
export function balanceStateClassName(tone: BalanceState | 'none'): string {
  if (tone === 'over') return 'text-[hsl(var(--labor-over))]';
  if (tone === 'under') return 'text-[hsl(var(--labor-under))]';
  if (tone === 'balanced') return 'text-[hsl(var(--labor-balanced))]';
  return '';
}
