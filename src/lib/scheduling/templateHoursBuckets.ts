/**
 * Pure bucketing for the template-hours cascade. No React, no supabase.
 *
 * This module owns every piece of client-side timezone reasoning in the
 * feature: it is the only place that turns a shift's `timestamptz` into a
 * restaurant-local wall clock, so no component downstream has to think about
 * zones. The server re-derives the same buckets independently — see
 * `update_shift_template_with_cascade` — and this preview must agree with it.
 *
 * See docs/superpowers/specs/2026-08-03-template-hours-cascade-design.md.
 */

import { formatLocalDateInTz, formatLocalHHMMInTz } from '@/lib/shiftInterval';

export interface LinkedShift {
  id: string;
  /** ISO timestamptz, as returned by supabase. */
  start_time: string;
  end_time: string;
  is_published: boolean;
  locked: boolean;
  employee_id: string;
  /**
   * `shifts.employee_id` is NOT NULL, so there is no such thing as an
   * unassigned shift — this is null only when the employees join failed to
   * resolve a name. The UI labels that case "Unknown employee".
   */
  employeeName: string | null;
}

export interface DriftRow {
  shiftId: string;
  employeeName: string | null;
  /** Restaurant-local YYYY-MM-DD. */
  localDate: string;
  /** Restaurant-local HH:MM. */
  currentStart: string;
  currentEnd: string;
  /** Signed hours this shift gains if the manager opts it in. */
  hoursDelta: number;
  /**
   * Mirrors LinkedShift.is_published. A drifted shift can be posted to staff
   * same as a moving one — the "already posted" chip and the notify checkbox
   * both need to see this even though the shift never entered
   * `publishedMovingIds` (that array is scoped to the moving bucket only).
   */
  isPublished: boolean;
}

export interface TemplateHoursBuckets {
  /** Shift ids, in the order they were supplied. */
  past: string[];
  locked: string[];
  moving: string[];
  drifted: DriftRow[];
  /** Ids of published shifts that are actually moving — drives severity. */
  publishedMovingIds: string[];
  /** Signed hours added across `moving`, if no drift row is opted in. */
  movingHoursDelta: number;
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number.parseInt(h, 10) * 60 + Number.parseInt(m, 10);
}

/**
 * Minutes from `start` to `end` on a wall clock, wrapping past midnight.
 * An equal start and end is a full day, not zero — that is what a 24-hour
 * template means, and it is the same convention the RPC's
 * `p_end_time <= p_start_time` branch encodes.
 */
export function durationMinutes(start: string, end: string): number {
  const delta = toMinutes(end) - toMinutes(start);
  return delta > 0 ? delta : delta + 1440;
}

export function bucketTemplateShifts(input: {
  shifts: LinkedShift[];
  /** Template's currently-stored hours, HH:MM. */
  oldStart: string;
  oldEnd: string;
  /** What the manager has typed, HH:MM. */
  newStart: string;
  newEnd: string;
  tz: string;
  now: Date;
}): TemplateHoursBuckets {
  const { shifts, oldStart, oldEnd, newStart, newEnd, tz, now } = input;

  const past: string[] = [];
  const locked: string[] = [];
  const moving: string[] = [];
  const drifted: DriftRow[] = [];
  const publishedMovingIds: string[] = [];

  const newDuration = durationMinutes(newStart, newEnd);
  const perShiftDelta = (newDuration - durationMinutes(oldStart, oldEnd)) / 60;
  const nowMs = now.getTime();

  for (const s of shifts) {
    // Precedence: Past before Locked. A locked past shift reports as past,
    // because that is the more informative reason to a manager reading the
    // ledger.
    if (new Date(s.start_time).getTime() < nowMs) {
      past.push(s.id);
      continue;
    }
    if (s.locked) {
      locked.push(s.id);
      continue;
    }

    const currentStart = formatLocalHHMMInTz(s.start_time, tz);
    const currentEnd = formatLocalHHMMInTz(s.end_time, tz);

    if (currentStart === oldStart && currentEnd === oldEnd) {
      moving.push(s.id);
      if (s.is_published) publishedMovingIds.push(s.id);
      continue;
    }

    drifted.push({
      shiftId: s.id,
      employeeName: s.employeeName,
      localDate: formatLocalDateInTz(new Date(s.start_time), tz),
      currentStart,
      currentEnd,
      hoursDelta: (newDuration - durationMinutes(currentStart, currentEnd)) / 60,
      isPublished: s.is_published,
    });
  }

  return {
    past,
    locked,
    moving,
    drifted,
    publishedMovingIds,
    movingHoursDelta: perShiftDelta * moving.length,
  };
}
