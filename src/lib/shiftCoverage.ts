/**
 * shiftCoverage.ts — pure coverage engine
 *
 * Computes time-based concurrent-minimum coverage for a template slot.
 * Algorithm: sweep-line over breakpoints derived from clipped shift intervals.
 * Identical logic is mirrored in SQL as shift_slot_min_concurrent().
 *
 * Key invariants (match the SQL exactly):
 *  - "distinct employees" per sub-interval (one person with 2 overlapping shifts = 1)
 *  - capacityFloor: 0/NaN/<1 → 1
 *  - W0 and W1 are always seeded into breakpoints (empty shift set → minConcurrent=0)
 *  - Overnight: when end ≤ start in minutes, add 1440 to end
 *  - All math in restaurant-local minutes from local midnight of dateStr
 */

import { toZonedTime } from 'date-fns-tz';
import type { CoverageShift, CoverageSegment, CoveringEmployee, SlotCoverage } from '@/types/scheduling';
import { formatCompactTime } from '@/lib/openShiftHelpers';

/**
 * Coerce a raw capacity value: 0, NaN, null, undefined, or < 1 → 1.
 * Matches SQL: GREATEST(1, capacity).
 */
export function capacityFloor(capacity: number | undefined | null): number {
  const c = Number(capacity);
  return Number.isFinite(c) && c >= 1 ? Math.floor(c) : 1;
}

/**
 * Convert minutes-from-midnight (possibly >1440 for overnight or negative for previous-day)
 * into a compact 12-hour label, e.g. 840 → "2p", 570 → "9:30a", 1500 → "1a".
 *
 * Delegates to `formatCompactTime` from openShiftHelpers so the display format is consistent
 * across the app. The `min % 1440` normalisation handles overnight clipped end-times that
 * shiftCoverage stores as values >= 1440.
 */
export function minutesToCompact(min: number): string {
  const norm = ((min % 1440) + 1440) % 1440; // wrap to [0, 1440)
  const h = Math.floor(norm / 60);
  const m = norm % 60;
  return formatCompactTime(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
}

/**
 * Parse "HH:MM:SS" or "HH:MM" into minutes from midnight (integer).
 */
function parseTimeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Convert a UTC ISO string to wall-clock minutes from local midnight of `dateStr`
 * (YYYY-MM-DD) in the given IANA `tz`.
 *
 * Handles cross-midnight shifts: if the instant falls on the day after dateStr,
 * the result will be ≥ 1440 (e.g. 02:00 next-day = 1560).
 * If it falls the day before, the result will be negative.
 */
function isoToLocalMinutes(iso: string, dateStr: string, tz: string): number {
  const zoned = toZonedTime(new Date(iso), tz);
  const wallMins = zoned.getHours() * 60 + zoned.getMinutes();

  // Compute the calendar-day delta between the zoned date and dateStr
  const [Y, M, D] = dateStr.split('-').map(Number);
  const anchorMs = new Date(Y, M - 1, D).getTime();
  const zonedDay = new Date(zoned.getFullYear(), zoned.getMonth(), zoned.getDate()).getTime();
  const dayDelta = Math.round((zonedDay - anchorMs) / 86_400_000);

  return wallMins + dayDelta * 1440;
}

interface Clip {
  employeeId: string;
  employeeName?: string | null;
  homeArea?: string | null;
  workArea?: string | null;
  cs: number; // clipped start (minutes from local midnight)
  ce: number; // clipped end
}

/**
 * Options bag for computeSlotCoverage.
 *
 * `position` and `tz` are required slot configuration.
 * `area` is opt-in: null / undefined → no area filter (whole-restaurant, back-compat).
 * Banner callers (Scheduling.tsx) omit `area` — they stay whole-floor intentionally.
 */
export interface ComputeSlotCoverageOptions {
  /** The position the slot requires (e.g. "Server"). */
  position: string;
  /** IANA timezone of the restaurant. */
  tz: string;
  /**
   * When non-null, only shifts whose `shift.area === area` are counted.
   * Pass the template's own `area` field (from ShiftTemplate.area).
   * null / undefined → no area filter (counts all same-position shifts).
   */
  area?: string | null;
}

/**
 * Compute coverage for a single template slot on a given date.
 *
 * @param windowStart  "HH:MM:SS" or "HH:MM" — local start of the slot
 * @param windowEnd    "HH:MM:SS" or "HH:MM" — local end of the slot (may be < start for overnight)
 * @param capacity     Template capacity (coerced via capacityFloor)
 * @param dateStr      "YYYY-MM-DD" — the local calendar date of the slot
 * @param shifts       Candidate shifts (all positions/statuses; engine filters internally)
 * @param options      Required bag — `{ position, tz }` always; `{ area }` for planner per-cell scoping.
 */
export function computeSlotCoverage(
  windowStart: string,
  windowEnd: string,
  capacity: number,
  dateStr: string,
  shifts: CoverageShift[],
  options: ComputeSlotCoverageOptions,
): SlotCoverage {
  const { position, tz } = options;
  const cap = capacityFloor(capacity);
  const w0 = parseTimeToMinutes(windowStart);
  const w1raw = parseTimeToMinutes(windowEnd);
  // Overnight window: if end ≤ start, treat end as next-day (+1440)
  const w1 = w1raw <= w0 ? w1raw + 1440 : w1raw;

  // --- Build clipped intervals ---
  const clips: Clip[] = [];
  for (const s of shifts) {
    // Filter: position must match; cancelled shifts are skipped
    if (s.position !== position) continue;
    if (s.status === 'cancelled') continue;
    // Opt-in area filter: when options.area is non-null/undefined, only count same-area shifts.
    // Omitted/null area → no filter (whole-restaurant, back-compat with banner callers).
    if (options.area != null && s.area !== options.area) continue;

    const ds = isoToLocalMinutes(s.start_time, dateStr, tz);
    let de = isoToLocalMinutes(s.end_time, dateStr, tz);
    // Overnight shift: if end ≤ start in local minutes, add 1440
    if (de <= ds) de += 1440;

    // Clip to window
    const cs = Math.max(w0, ds);
    const ce = Math.min(w1, de);
    if (cs < ce) {
      clips.push({
        employeeId: s.employee_id,
        employeeName: s.employee_name ?? null,
        homeArea: s.homeArea ?? null,
        workArea: s.area ?? null,
        cs,
        ce,
      });
    }
  }

  // --- Sweep line over breakpoints ---
  // Always seed W0 and W1 so an empty shift set still produces a full-window n=0 interval.
  const bpSet = new Set<number>([w0, w1]);
  for (const c of clips) {
    bpSet.add(c.cs);
    bpSet.add(c.ce);
  }
  const bps = Array.from(bpSet).sort((a, b) => a - b);

  let minConcurrent = Infinity;
  let coveredMin = 0;
  const segments: CoverageSegment[] = [];

  for (let i = 0; i < bps.length - 1; i++) {
    const a = bps[i];
    const b = bps[i + 1];
    // Only process sub-intervals within [w0, w1)
    if (b <= a || a < w0 || a >= w1) continue;

    // COUNT(DISTINCT employee_id) at instant a
    const emps = new Set<string>();
    for (const c of clips) {
      if (c.cs <= a && c.ce > a) emps.add(c.employeeId);
    }
    const n = emps.size;

    minConcurrent = Math.min(minConcurrent, n);
    const covered = n >= cap;
    if (covered) coveredMin += b - a;

    // Merge consecutive segments with the same coverage flag
    const last = segments[segments.length - 1];
    if (last && last.covered === covered && last.endMin === a) {
      last.endMin = b;
    } else {
      segments.push({ startMin: a, endMin: b, covered });
    }
  }

  // If no sub-intervals were processed (e.g. w0 === w1), default to 0
  if (!Number.isFinite(minConcurrent)) minConcurrent = 0;

  const span = w1 - w0;
  const coveragePct = span > 0 ? Math.round((coveredMin / span) * 100) : 100;

  // Build covering-employees list (sorted by start, all clips present)
  const coveringEmployees: CoveringEmployee[] = clips
    .map((c) => ({
      employeeId: c.employeeId,
      employeeName: c.employeeName ?? null,
      homeArea: c.homeArea ?? null,
      workArea: c.workArea ?? null,
      startMin: c.cs,
      endMin: c.ce,
    }))
    .sort((a, b) => a.startMin - b.startMin);

  // Loaned out: employees whose HOME area is this slot's area but who are
  // working a different area during the window. Only when slot area is set.
  const loanedOut: CoveringEmployee[] = [];
  if (options.area != null) {
    for (const s of shifts) {
      if (s.position !== position) continue;
      if (s.status === 'cancelled') continue;
      if ((s.homeArea ?? null) !== options.area) continue; // must be from this area
      if ((s.area ?? null) === options.area) continue;      // and working elsewhere
      const ds = isoToLocalMinutes(s.start_time, dateStr, tz);
      let de = isoToLocalMinutes(s.end_time, dateStr, tz);
      if (de <= ds) de += 1440;
      const cs = Math.max(w0, ds);
      const ce = Math.min(w1, de);
      if (cs < ce) {
        loanedOut.push({
          employeeId: s.employee_id,
          employeeName: s.employee_name ?? null,
          homeArea: s.homeArea ?? null,
          workArea: s.area ?? null,
          startMin: cs,
          endMin: ce,
        });
      }
    }
    loanedOut.sort((a, b) => a.startMin - b.startMin);
  }

  return {
    minConcurrent,
    openSpots: Math.max(0, cap - minConcurrent),
    coveragePct,
    segments,
    coveringEmployees,
    loanedOut,
  };
}
