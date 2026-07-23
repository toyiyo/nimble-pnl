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

import { mondayOf, hourOfSale, distributeWorkedHours } from './splhAnalytics';
import type { SplhPoint, SplhGridCell, SplhSaleRow } from './splhAnalytics';
import { formatCoverageHour } from './coverageSummary';
import type { LaborCostData } from '@/hooks/useLaborCostsFromTimeTracking';
import type { WorkSession } from '@/utils/timePunchProcessing';

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
 *
 * KNOWN LIMITATION (design §10.5, accepted): `dailySales` buckets by
 * `unified_sales.sale_date` (restaurant-local) while `dailyLabor.date` comes
 * from `calculateActualLaborCost`, which reads the JS runtime's *local*
 * calendar day. When the viewer's device tz differs from the restaurant tz, a
 * sale/punch near local midnight can land in adjacent day buckets. Left as-is
 * so labor $ stays identical to the Payroll page (a tz-aware fix belongs in
 * `calculateActualLaborCost`, app-wide, with its own review).
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
    // Clamp to the documented 0..1 range: a negative cell (e.g. a net refund
    // hour) would otherwise produce a negative intensity and break styling.
    const intensity = maxSales > 0 ? Math.max(0, cell.totalSales / maxSales) : 0;
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
export function extractBalanceWindows(
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
 * The current period's restaurant-local date window for the `/labor` page's
 * Day/Week/Month toggle (design §2.2). The toggle is a *period* selector, not
 * just a re-bucketing of a fixed window: **Day** = today, **Week** = Monday of
 * this week → today, **Month** = the 1st of this month → today. `todayStr` is
 * the restaurant-tz "today" (`getTodayInTimezone`), passed in so this stays
 * pure/TZ-portable. Both bounds are inclusive `YYYY-MM-DD` strings.
 */
export function currentPeriodWindow(
  granularity: LaborGranularity,
  todayStr: string,
): { startStr: string; endStr: string } {
  if (granularity === 'week') return { startStr: mondayOf(todayStr), endStr: todayStr };
  if (granularity === 'month') return { startStr: `${monthKeyOf(todayStr)}-01`, endStr: todayStr };
  return { startStr: todayStr, endStr: todayStr };
}

/** Inclusive `[startStr, endStr]` membership for ISO `YYYY-MM-DD` strings
 * (lexicographic compare is correct for zero-padded ISO dates). */
export function dateInWindow(dateStr: string, startStr: string, endStr: string): boolean {
  return dateStr >= startStr && dateStr <= endStr;
}

/** Date-range presets for the `/labor` page selector. `custom` uses explicit
 * `start`/`end` from the date pickers. */
export type LaborRangePreset = 'today' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'custom';

export interface LaborRangeSelection {
  preset: LaborRangePreset;
  /** `custom` only — inclusive ISO `YYYY-MM-DD` bounds. */
  customStart?: string;
  customEnd?: string;
}

/** Adds `days` (may be negative) to an ISO `YYYY-MM-DD` via UTC math (TZ-safe). */
export function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function firstOfMonthStr(dateStr: string): string {
  return `${monthKeyOf(dateStr)}-01`;
}

/** First day of the calendar month before `dateStr`'s month. */
function firstOfPrevMonthStr(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10); // m is 1-based
}

/** Last day of `firstOfMonthStr`'s month (pass a first-of-month date). */
function lastOfMonthStr(firstOfMonth: string): string {
  const [y, m] = firstOfMonth.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // day 0 = last day of prev index → this month's last
}

/** Whole days between two ISO dates (end − start). */
export function daysBetween(startStr: string, endStr: string): number {
  const [ys, ms, ds] = startStr.split('-').map(Number);
  const [ye, me, de] = endStr.split('-').map(Number);
  return Math.round((Date.UTC(ye, me - 1, de) - Date.UTC(ys, ms - 1, ds)) / 86_400_000);
}

/**
 * Resolves a range selection to inclusive `{ startStr, endStr }` given the
 * restaurant-tz `todayStr` (design: Day/Week/Month → preset dropdown). `custom`
 * falls back to today when a bound is missing and normalizes a reversed range.
 */
export function resolveDateRange(
  selection: LaborRangeSelection,
  todayStr: string,
): { startStr: string; endStr: string } {
  switch (selection.preset) {
    case 'this_week':
      return { startStr: mondayOf(todayStr), endStr: todayStr };
    case 'last_week': {
      const thisMonday = mondayOf(todayStr);
      return { startStr: addDaysStr(thisMonday, -7), endStr: addDaysStr(thisMonday, -1) };
    }
    case 'this_month':
      return { startStr: firstOfMonthStr(todayStr), endStr: todayStr };
    case 'last_month': {
      const start = firstOfPrevMonthStr(todayStr);
      return { startStr: start, endStr: lastOfMonthStr(start) };
    }
    case 'custom': {
      const a = selection.customStart || todayStr;
      const b = selection.customEnd || todayStr;
      return a <= b ? { startStr: a, endStr: b } : { startStr: b, endStr: a };
    }
    case 'today':
    default:
      return { startStr: todayStr, endStr: todayStr };
  }
}

/**
 * Chart bucketing for a resolved range: a single day → `intraday` (hour-of-day);
 * up to ~2 weeks → `day`; longer → `week`. The KPI summary always uses the daily
 * series regardless (design §4) — this only picks the chart's x-axis unit.
 */
export function seriesGranularityForRange(startStr: string, endStr: string): 'intraday' | 'day' | 'week' {
  if (startStr === endStr) return 'intraday';
  return daysBetween(startStr, endStr) <= 16 ? 'day' : 'week';
}

/**
 * Intraday (hour-of-day) financial series for the Day view's chart (design
 * §2.2 "hour-of-day (Day)", §4/§9). Buckets a single restaurant-local
 * `dateStr`'s real sales by hour (`hourOfSale`, reused from `splhAnalytics`)
 * and its worked hours by hour (`distributeWorkedHours`), then prices labor as
 * `laborHours × avgHourlyRateCents` — an **average-rate shape estimate**, NOT
 * payroll-grade: the payroll engine (`calculateActualLaborCost`) attributes
 * cost at the day level, so sub-day labor $ can only be approximated (design
 * §9). The Day view's KPI row + verdict still come from the day's *payroll-grade*
 * daily total (design §4) — this series only drives the chart's shape.
 *
 * Emits one point per hour across the **contiguous** span from the first to the
 * last active hour (any hour with sales or labor), zero-filling gaps so the
 * area/line/ribbon x-axes stay aligned (mirrors `buildFinancialSeries`'s dense
 * output). `laborPct` is `null` — never `Infinity` — for an hour with no sales
 * (design §6). Returns `[]` when the day has no sales and no labor.
 */
export function buildIntradayFinancialSeries(
  sales: SplhSaleRow[],
  sessions: WorkSession[],
  tz: string,
  dateStr: string,
  avgHourlyRateCents: number,
  targetPct: number,
  capHour?: number,
): FinancialPoint[] {
  const salesByHour = new Map<number, number>();
  for (const s of sales) {
    if (s.sale_date !== dateStr) continue;
    const hour = hourOfSale(s, tz);
    if (hour === null || (capHour !== undefined && hour > capHour)) continue;
    salesByHour.set(hour, (salesByHour.get(hour) ?? 0) + Number(s.total_price));
  }

  const hoursByHour = new Map<number, number>();
  for (const session of sessions) {
    for (const c of distributeWorkedHours(session, tz)) {
      if (c.localDate !== dateStr || (capHour !== undefined && c.hour > capHour)) continue;
      hoursByHour.set(c.hour, (hoursByHour.get(c.hour) ?? 0) + c.hours);
    }
  }

  const activeHours = [...salesByHour.keys(), ...hoursByHour.keys()];
  if (activeHours.length === 0) return [];
  // Extend the axis through `capHour` ("now" for today) even if the last hour
  // had no activity, so the chart reads "so far today" up to the current hour.
  const minHour = Math.min(...activeHours);
  const maxHour = capHour !== undefined ? Math.max(...activeHours, capHour) : Math.max(...activeHours);
  const rate = avgHourlyRateCents / 100;

  const points: FinancialPoint[] = [];
  for (let hour = minHour; hour <= maxHour; hour++) {
    const sales_ = round2(salesByHour.get(hour) ?? 0);
    const laborHoursRaw = hoursByHour.get(hour) ?? 0;
    const laborHours = round2(laborHoursRaw);
    const laborCost = round2(laborHoursRaw * rate); // price off raw hours (single rounding)
    const laborPct = sales_ > 0 ? round2((laborCost / sales_) * 100) : null;
    points.push({
      bucketStart: `${dateStr}T${String(hour).padStart(2, '0')}`,
      label: formatCoverageHour(hour),
      sales: sales_,
      laborCost,
      laborHours,
      laborPct,
      balanceState: classifyBalance(laborPct, targetPct),
    });
  }
  return points;
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

/**
 * Pure: balance tone -> Tailwind arbitrary-value **background** class on the
 * same `--labor-over` / `--labor-under` / `--labor-balanced` tokens (design
 * §7) — the background counterpart to `balanceStateClassName` above. Shared
 * by `LaborBalanceRibbon`'s per-bucket chips and `LaborVerdict`'s tone dot,
 * which otherwise re-implemented the identical over/under/balanced mapping.
 * `noneClassName` lets each caller pick its own no-data fallback (the ribbon
 * never sees `'none'` — `FinancialPoint.balanceState` is always a
 * `BalanceState` — while the verdict dot wants a neutral gray, mirroring
 * `CoverageVerdict`'s "no demand configured" dot).
 */
export function balanceStateBgClassName(
  tone: BalanceState | 'none',
  noneClassName: string = 'bg-[hsl(var(--labor-balanced))]',
): string {
  if (tone === 'over') return 'bg-[hsl(var(--labor-over))]';
  if (tone === 'under') return 'bg-[hsl(var(--labor-under))]';
  if (tone === 'balanced') return 'bg-[hsl(var(--labor-balanced))]';
  return noneClassName;
}
