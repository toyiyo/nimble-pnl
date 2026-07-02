import { useMemo } from 'react';
import { isoToLocalMinutes, minutesToCompact, computeDayCoverage } from '@/lib/shiftCoverage';
import { getPositionColors } from '@/lib/positionColors';
import { calculateShiftHours } from '@/lib/scheduleRoster';
import { type GroupByMode, UNASSIGNED_LABEL } from '@/lib/scheduleGrouping';
import type { Shift, Employee, HourlyStaffingRecommendation } from '@/types/scheduling';
import type { PositionColors } from '@/lib/positionColors';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TimelineWindow {
  startMin: number;
  endMin: number;
}

export interface TimelineBar {
  shift: Shift;
  row: number;
  leftMin: number;
  endMin: number;
  label: string;
  ariaLabel: string;
  color: PositionColors;
}

export interface TimelineLane {
  key: string;
  label: string;
  hours: number;
  bars: TimelineBar[];
}

export interface TimelineGap {
  startMin: number;
  endMin: number;
}

export interface TimelineModel {
  window: TimelineWindow;
  lanes: TimelineLane[];
  coverage: { min: number; count: number }[];
  demand: { min: number; target: number }[] | null;
  gaps: TimelineGap[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_START = 600; // 10:00
const DEFAULT_END = 1380;  // 23:00

// ─── Window derivation ────────────────────────────────────────────────────────

/**
 * Derive the visible time window for the given day's shifts.
 * Floors start and ceils end to the nearest hour.
 * Overnight shifts may yield endMin > 1440.
 * Returns a sane default when no shifts are present.
 */
export function deriveWindow(
  shifts: Shift[],
  dateStr: string,
  tz: string,
): TimelineWindow {
  if (shifts.length === 0) {
    return { startMin: DEFAULT_START, endMin: DEFAULT_END };
  }

  let minStart = Infinity;
  let maxEnd = -Infinity;

  for (const s of shifts) {
    const ds = isoToLocalMinutes(s.start_time, dateStr, tz);
    let de = isoToLocalMinutes(s.end_time, dateStr, tz);
    if (de <= ds) de += 1440;
    minStart = Math.min(minStart, ds);
    maxEnd = Math.max(maxEnd, de);
  }

  return {
    startMin: Math.floor(minStart / 60) * 60,
    endMin: Math.ceil(maxEnd / 60) * 60,
  };
}

// ─── Lane building ────────────────────────────────────────────────────────────

/**
 * Assign row indices to an ordered list of {shift, employee} pairs using a
 * first-fit sweep: a bar lands on the lowest row whose last end-time ≤ this
 * bar's start.  Shifts must already be sorted by start time so the sweep is
 * deterministic.
 */
function assignRows(
  pairs: Array<{ shift: Shift; employee: Employee; hours: number }>,
  dateStr: string,
  tz: string,
): TimelineBar[] {
  const rowEnds: number[] = []; // last endMin per row
  return pairs.map(({ shift: s, employee: e, hours }) => {
    const leftMin = isoToLocalMinutes(s.start_time, dateStr, tz);
    let endMin = isoToLocalMinutes(s.end_time, dateStr, tz);
    if (endMin <= leftMin) endMin += 1440;

    let row = rowEnds.findIndex((end) => leftMin >= end);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(endMin);
    } else {
      rowEnds[row] = endMin;
    }

    const start12 = minutesToCompact(leftMin);
    const end12 = minutesToCompact(endMin % 1440);
    return {
      shift: s,
      row,
      leftMin,
      endMin,
      label: e.name,
      ariaLabel: `${e.name}, ${s.position}, ${start12} to ${end12}, ${hours.toFixed(1)} hours`,
      color: getPositionColors(s.position),
    };
  });
}

/**
 * Build timeline lanes for the given day's shifts.
 *
 * Shifts are expected to be already filtered to the target day — this function
 * does NOT re-apply a date filter (avoids host-TZ issues from date-based isSameDay).
 *
 * Groups by `groupBy` ('area' → employee.area, 'position' → employee.position,
 * 'none' → single unlabelled lane).  Within each lane, shifts are sorted by
 * start time then stacked onto rows using first-fit sweeping.
 */
export function buildLanes(
  shifts: Shift[],
  employees: Employee[],
  dateStr: string,
  tz: string,
  groupBy: GroupByMode,
): TimelineLane[] {
  const empById = new Map(employees.map((e) => [e.id, e]));

  // Join each shift to its employee (drop orphans)
  const rows = shifts
    .filter((s) => empById.has(s.employee_id))
    .map((s) => ({
      shift: s,
      employee: empById.get(s.employee_id)!,
      hours: calculateShiftHours(s),
    }));

  // Sort by start time (ascending) within each group for deterministic row-stacking
  rows.sort((a, b) => a.shift.start_time.localeCompare(b.shift.start_time));

  if (groupBy === 'none') {
    const bars = assignRows(rows, dateStr, tz);
    const totalHours = rows.reduce((sum, r) => sum + r.hours, 0);
    return rows.length ? [{ key: '', label: '', hours: totalHours, bars }] : [];
  }

  // Group by the chosen dimension
  const sectionMap = new Map<string, typeof rows>();
  for (const row of rows) {
    const raw = (groupBy === 'area' ? row.employee.area : row.employee.position) ?? '';
    const key = raw.trim();
    const arr = sectionMap.get(key);
    if (arr) arr.push(row);
    else sectionMap.set(key, [row]);
  }

  // Sort sections: alphabetical, unassigned ('') last
  const sortedKeys = Array.from(sectionMap.keys()).sort((a, b) => {
    if (a === '') return 1;
    if (b === '') return -1;
    return a.localeCompare(b);
  });

  return sortedKeys.map((key) => {
    const sectionRows = sectionMap.get(key) ?? [];
    const totalHours = sectionRows.reduce((sum, r) => sum + r.hours, 0);
    return {
      key: key || 'unassigned',
      label: key || UNASSIGNED_LABEL,
      hours: totalHours,
      bars: assignRows(sectionRows, dateStr, tz),
    };
  });
}

// ─── Demand expansion ─────────────────────────────────────────────────────────

const STEP_MIN = 15;

/**
 * Expand hourly staffing recommendations into a fine-grained step grid
 * spanning [startMin, endMin].  Returns null when there are no recommendations
 * (so the chart can omit the demand line and gap detection).
 */
export function expandDemand(
  recs: HourlyStaffingRecommendation[],
  startMin: number,
  endMin: number,
  step = STEP_MIN,
): { min: number; target: number }[] | null {
  if (recs.length === 0) return null;
  const byHour = new Map(recs.map((r) => [r.hour, r.recommendedStaff]));
  const out: { min: number; target: number }[] = [];
  for (let m = startMin; m <= endMin; m += step) {
    const hour = Math.floor((m % 1440) / 60);
    out.push({ min: m, target: byHour.get(hour) ?? 0 });
  }
  return out;
}

// ─── Gap detection ────────────────────────────────────────────────────────────

/**
 * Find contiguous time windows where actual coverage falls below demand.
 * Returns an empty array when demand is null (no recommendations loaded).
 *
 * The returned gaps use the minute values of the coverage samples: `startMin`
 * is the first under-staffed sample; `endMin` is the last under-staffed sample
 * in the run.
 */
export function computeGaps(
  coverage: { min: number; count: number }[],
  demand: { min: number; target: number }[] | null,
): TimelineGap[] {
  if (!demand) return [];
  const targetAt = new Map(demand.map((d) => [d.min, d.target]));
  const gaps: TimelineGap[] = [];
  let open: TimelineGap | null = null;
  for (const c of coverage) {
    const short = c.count < (targetAt.get(c.min) ?? 0);
    if (short) {
      if (open) {
        open.endMin = c.min;
      } else {
        open = { startMin: c.min, endMin: c.min };
      }
    } else if (open) {
      gaps.push(open);
      open = null;
    }
  }
  if (open) gaps.push(open);
  return gaps;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Derive the full timeline model for a single day.
 *
 * Pure transform — safe to call from any environment (no DOM access).
 * Memoized so the object reference is stable when inputs haven't changed.
 */
export function useTimelineModel(
  shifts: Shift[],
  employees: Employee[],
  dateStr: string,
  tz: string,
  groupBy: GroupByMode,
  recommendations: HourlyStaffingRecommendation[],
): TimelineModel {
  return useMemo(() => {
    const dayShifts = shifts.filter((s) => s.status !== 'cancelled');
    const window = deriveWindow(dayShifts, dateStr, tz);
    const lanes = buildLanes(dayShifts, employees, dateStr, tz, groupBy);
    // Shift structurally satisfies the fields computeDayCoverage reads
    // (start_time, end_time, status) so the cast is safe.
    const coverage = computeDayCoverage(
      dayShifts as Parameters<typeof computeDayCoverage>[0],
      dateStr,
      tz,
      STEP_MIN,
      window.startMin,
      window.endMin,
    );
    const demand = expandDemand(recommendations, window.startMin, window.endMin);
    const gaps = computeGaps(coverage, demand);
    return { window, lanes, coverage, demand, gaps };
  }, [shifts, employees, dateStr, tz, groupBy, recommendations]);
}
