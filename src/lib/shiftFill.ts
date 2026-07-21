/**
 * shiftFill.ts — per-template "filled by assignment" engine.
 *
 * Replaces the whole-floor position sweep (the old `computeSlotCoverage`
 * badge path) with a per-template rule: a slot is filled when >= capacity
 * DISTINCT employees are assigned to *this template* (by `shift_template_id`,
 * or the legacy exact-time/position/area fallback), regardless of whether
 * their hours span the whole window.
 *
 * The caller is responsible for bucketing shifts per (template, day) —
 * mirroring `buildTemplateGridData` / `findAreaAwareTemplate`
 * (see templateAreaMatch.ts) — and passing only that bucket in here.
 * `computeCellFill` never looks beyond the bucket it's given, so a
 * same-position shift belonging to a different template can never leak into
 * this cell's fill count (the bug this file fixes).
 *
 * See docs/superpowers/specs/2026-07-20-shift-fill-by-assignment-design.md.
 */

import { capacityFloor, computeSlotCoverage } from '@/lib/shiftCoverage';
import type { CoverageShift, CoverageSegment, CoveringEmployee } from '@/types/scheduling';

/**
 * COUNT(DISTINCT employee_id) among the non-cancelled shifts in a template's
 * day-bucket. This — not the time-based sweep — drives `openSpots`.
 */
export function distinctAssignedCount(bucketShifts: CoverageShift[]): number {
  const ids = new Set<string>();
  for (const s of bucketShifts) {
    if (s.status === 'cancelled') continue;
    ids.add(s.employee_id);
  }
  return ids.size;
}

export interface ComputeCellFillOptions {
  /** The position the slot requires (e.g. "Server"). */
  position: string;
  /** IANA timezone of the restaurant. */
  tz: string;
  /** "YYYY-MM-DD" — the local calendar date of the slot. */
  dateStr: string;
  /** "HH:MM:SS" or "HH:MM" — local start of the slot. */
  windowStart: string;
  /** "HH:MM:SS" or "HH:MM" — local end of the slot (may be < start for overnight). */
  windowEnd: string;
}

/** Fill fields for one (template, day) cell — everything `SlotCoverage` needs except `loanedOut`. */
export interface CellFill {
  /** Sweep-line min-concurrent over the bucket only. Informational (progress bar/popover) —
   *  does NOT drive `openSpots`. */
  minConcurrent: number;
  /** max(0, capacityFloor(capacity) − distinctAssignedCount(bucketShifts)). */
  openSpots: number;
  coveragePct: number;
  segments: CoverageSegment[];
  coveringEmployees: CoveringEmployee[];
}

/**
 * Compute the fill badge + secondary time-coverage info for one template's
 * day-bucket.
 *
 * `openSpots` is driven by distinct-employee assignment count (the fix).
 * `minConcurrent` / `coveragePct` / `segments` / `coveringEmployees` are the
 * existing sweep-line result (from `computeSlotCoverage`) scoped to the
 * bucket only — retained as secondary info for the progress bar + popover.
 */
export function computeCellFill(
  bucketShifts: CoverageShift[],
  capacity: number,
  options: ComputeCellFillOptions,
): CellFill {
  const { position, tz, dateStr, windowStart, windowEnd } = options;
  const cap = capacityFloor(capacity);

  const assignedCount = distinctAssignedCount(bucketShifts);
  const openSpots = Math.max(0, cap - assignedCount);

  // Reuse the existing sweep-line math, scoped to this template's own bucket
  // (no area filter — the bucket is already scoped to this template).
  const swept = computeSlotCoverage(windowStart, windowEnd, capacity, dateStr, bucketShifts, { position, tz });

  return {
    minConcurrent: swept.minConcurrent,
    openSpots,
    coveragePct: swept.coveragePct,
    segments: swept.segments,
    coveringEmployees: swept.coveringEmployees,
  };
}
