/**
 * Pure hourly coverage summary.
 *
 * Demand is only hourly-resolution, so we aggregate 15-min coverage samples to
 * hours for a clean, honest comparison.  All functions are timezone-agnostic:
 * they consume pre-computed minute values, not wall-clock times.
 */

import { computeDayCoverage } from '@/lib/shiftCoverage';
import { UNASSIGNED_LABEL } from '@/lib/scheduleGrouping';
import type { Shift, Employee, HourlyStaffingRecommendation } from '@/types/scheduling';

export interface CoverageHour {
  /** 0–23 clock hour (use Math.floor(startMin / 60) % 24 for the display label) */
  hour: number;
  /** Absolute minute offset where the hour begins (e.g. 600 = 10:00 AM) */
  startMin: number;
  /** Per-hour minimum headcount (conservative: mid-hour dip counts as short) */
  scheduled: number;
  /** Hourly demand target, or null when no demand is configured */
  needed: number | null;
  /** scheduled − needed, or null when needed is null */
  delta: number | null;
  /** Projected sales for this hour from staffing recommendations (null when unavailable). */
  projectedSales: number | null;
  /** Estimated labor % for this hour (null when unavailable). */
  laborPct: number | null;
}

export interface CoverageVerdict {
  /** True when at least one hour has a demand target */
  hasDemand: boolean;
  /** True only when demand exists and every hour meets or exceeds it */
  metAll: boolean;
  /** Count of hours where delta < 0 */
  shortHours: number;
  /** Total hours in the window */
  totalHours: number;
  /** Hour with the most-negative delta (null when no shorts or no demand) */
  worst: { hour: number; delta: number } | null;
}

const HOUR = 60;

/**
 * Format a clock hour (0–23) into a compact 12-hour label without minutes,
 * e.g. 0 → "12 AM", 17 → "5 PM".  Used by CoverageVerdict, CoverageChart,
 * and CoverageStatusStrip so the label style is consistent across all three.
 */
export function formatCoverageHour(hour: number): string {
  const h24 = ((hour % 24) + 24) % 24;
  const period = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12} ${period}`;
}

/**
 * Aggregate 15-min coverage samples into per-hour summaries aligned with
 * the hourly demand targets.
 *
 * @param coverage  Array of { min, count } — one entry per 15-min slot.
 * @param demand    Array of { min, target } — one entry per demand hour start,
 *                  or null if no demand is configured.
 * @param window    { startMin, endMin } — the visible day window in minutes.
 * @param recs      Optional staffing recommendations; when provided, each hour
 *                  entry gains projectedSales and laborPct from the matching rec.
 */
export function summarizeCoverageHours(
  coverage: { min: number; count: number }[],
  demand: { min: number; target: number }[] | null,
  window: { startMin: number; endMin: number },
  recs?: HourlyStaffingRecommendation[],
): CoverageHour[] {
  // Do NOT short-circuit on empty coverage — when demand is configured but no
  // shifts are scheduled, every hour must be returned with scheduled=0 so that
  // buildVerdict reports hasDemand:true and the correct shortfall count, rather
  // than silently hiding a fully-unstaffed period.
  const hasAnyCoverage = coverage.length > 0;

  // Build a lookup: hourStart → demand target
  const demandMap: Map<number, number> | null = demand
    ? new Map(demand.map((d) => [d.min, d.target]))
    : null;

  // Build a lookup: clock hour (0–23) → staffing recommendation
  const recByHour: Map<number, HourlyStaffingRecommendation> = new Map(
    recs?.map((r) => [r.hour, r]) ?? [],
  );

  /**
   * Returns the demand target for the hour that contains `min`.
   * Demand entries are keyed by their hour's start minute.
   * Returns null if the map exists but has no entry for this hour — this
   * treats "demand configured but not for this hour" as no-target rather than
   * zero-target, preventing off-peak hours from being silently reported as met.
   */
  const needForHourStart = (hourStart: number): number | null => {
    if (!demandMap) return null;
    return demandMap.get(hourStart) ?? null;
  };

  const out: CoverageHour[] = [];

  // Iterate over each complete hour bucket within the window.
  // When there is no coverage but demand IS configured, we must still emit an
  // hour entry with scheduled=0 so buildVerdict surfaces the shortfall.
  const firstHourStart = Math.floor(window.startMin / HOUR) * HOUR;
  for (let start = firstHourStart; start < window.endMin; start += HOUR) {
    // All 15-min samples whose minute falls within the intersection of
    // [start, start+60) and the visible window [window.startMin, window.endMin).
    // Clamping to window bounds prevents samples outside the visible range from
    // bleeding into the first or last bucket when the window is not hour-aligned.
    const inHour = hasAnyCoverage
      ? coverage.filter(
          (c) =>
            c.min >= Math.max(start, window.startMin) &&
            c.min < Math.min(start + HOUR, window.endMin),
        )
      : [];

    const needed = needForHourStart(start);

    // Skip the hour only when there is neither coverage data nor a demand
    // target — i.e. an hour completely outside the operating window.
    if (inHour.length === 0 && needed === null) continue;

    const scheduled = inHour.length > 0 ? Math.min(...inHour.map((c) => c.count)) : 0;

    const clockHour = Math.floor(start / HOUR) % 24;
    const rec = recByHour.get(clockHour) ?? null;

    out.push({
      hour: clockHour,
      startMin: start,
      scheduled,
      needed,
      delta: needed === null ? null : scheduled - needed,
      projectedSales: rec?.projectedSales ?? null,
      laborPct: rec?.laborPct ?? null,
    });
  }

  return out;
}

/**
 * Derive a plain-language verdict from the hourly summary.
 */
export function buildVerdict(hours: CoverageHour[]): CoverageVerdict {
  const hasDemand = hours.some((h) => h.needed !== null);
  const shortHours = hours.filter((h) => h.delta !== null && h.delta < 0);

  let worst: { hour: number; delta: number } | null = null;
  for (const h of shortHours) {
    if (worst === null || h.delta! < worst.delta) {
      worst = { hour: h.hour, delta: h.delta! };
    }
  }

  return {
    hasDemand,
    metAll: hasDemand && shortHours.length === 0,
    shortHours: shortHours.length,
    totalHours: hours.length,
    worst,
  };
}

/**
 * Expand a clicked understaffed hour into the contiguous run of understaffed
 * (`delta < 0`) hours adjacent to it within the single day-wide hourly status
 * strip, and return the merged `[startMin, endMin)` range covering that run.
 *
 * "Adjacent" means consecutive entries in `hours` whose `startMin` values are
 * exactly 60 minutes apart — i.e. back-to-back cells in the strip, with no
 * covered/no-demand hour in between. The walk stops as soon as it hits a
 * non-short hour (covered or no-demand) or a gap in `startMin` continuity, so
 * the merged range never crosses into a covered hour or jumps across a gap to
 * reach a non-adjacent short run.
 *
 * If `clickedStartMin` doesn't match any hour in `hours` (shouldn't happen —
 * only short cells are clickable), or the matching hour isn't itself short,
 * the single matching (or nearest) hour is returned unchanged as a 60-minute
 * range — this is a defensive fallback, not an expected call path.
 */
export function mergeUnderStaffedRange(
  hours: CoverageHour[],
  clickedStartMin: number,
): { startMin: number; endMin: number } {
  const clickedIndex = hours.findIndex((h) => h.startMin === clickedStartMin);

  // Defensive fallback: no matching hour found — degrade to a single 60-min
  // window at the requested minute rather than throwing.
  if (clickedIndex === -1) {
    return { startMin: clickedStartMin, endMin: clickedStartMin + HOUR };
  }

  const isShort = (h: CoverageHour) => h.delta !== null && h.delta < 0;

  // Defensive fallback: the clicked hour isn't short — return just that hour.
  if (!isShort(hours[clickedIndex])) {
    return { startMin: clickedStartMin, endMin: clickedStartMin + HOUR };
  }

  // Walk backward from the clicked hour while the previous entry is short AND
  // exactly one hour earlier (no gap).
  let firstIndex = clickedIndex;
  while (
    firstIndex > 0 &&
    isShort(hours[firstIndex - 1]) &&
    hours[firstIndex - 1].startMin === hours[firstIndex].startMin - HOUR
  ) {
    firstIndex -= 1;
  }

  // Walk forward from the clicked hour while the next entry is short AND
  // exactly one hour later (no gap).
  let lastIndex = clickedIndex;
  while (
    lastIndex < hours.length - 1 &&
    isShort(hours[lastIndex + 1]) &&
    hours[lastIndex + 1].startMin === hours[lastIndex].startMin + HOUR
  ) {
    lastIndex += 1;
  }

  return {
    startMin: hours[firstIndex].startMin,
    endMin: hours[lastIndex].startMin + HOUR,
  };
}

// ---------------------------------------------------------------------------
// Per-area scheduled coverage (no per-area demand)
// ---------------------------------------------------------------------------

export interface AreaCoverage {
  area: string;
  /** Scheduled-only hours (needed and delta are always null). */
  hours: CoverageHour[];
}

const AREA_STEP = 15;

/**
 * Per-area SCHEDULED coverage (no per-area demand). Groups shifts by the
 * employee's `area` (same key as buildRosterDay), then reuses computeDayCoverage
 * + summarizeCoverageHours with demand=null. Areas sorted alphabetically,
 * Unassigned last.
 */
export function summarizeAreaCoverage(
  shifts: Shift[],
  employees: Employee[],
  dateStr: string,
  tz: string,
  window: { startMin: number; endMin: number },
): AreaCoverage[] {
  if (shifts.length === 0) return [];

  // Build a lookup: employeeId → area key (empty string for unassigned)
  const areaById = new Map(
    employees.map((e) => [e.id, (e.area ?? '').trim()]),
  );

  // Group non-cancelled shifts by area
  const byArea = new Map<string, Shift[]>();
  for (const s of shifts) {
    if (s.status === 'cancelled') continue;
    const key = areaById.get(s.employee_id) ?? '';
    const arr = byArea.get(key);
    if (arr) arr.push(s);
    else byArea.set(key, [s]);
  }

  if (byArea.size === 0) return [];

  // Sort: alphabetical, Unassigned (empty string) last
  const keys = Array.from(byArea.keys()).sort((a, b) => {
    if (a === '') return 1;
    if (b === '') return -1;
    return a.localeCompare(b);
  });

  return keys.map((key) => {
    const areaShifts = byArea.get(key)!;
    const coverage = computeDayCoverage(
      areaShifts,
      dateStr,
      tz,
      AREA_STEP,
      window.startMin,
      window.endMin,
    );
    return {
      area: key || UNASSIGNED_LABEL,
      hours: summarizeCoverageHours(coverage, null, window),
    };
  });
}
