import { addDaysToDateStr, daysBetweenDateStrs, firstInstantOfDay, isValidTimezone } from '@/lib/restaurantClock';
import {
  formatLocalDate,
  formatLocalDateInTz,
  formatLocalTimeInTz,
  requireTz,
  wallClockToInstant,
} from '@/lib/shiftInterval';

import type { Shift, TemplateShiftSnapshot } from '@/types/scheduling';
import type { BulkShiftInsert } from '@/lib/copyWeekShifts';

const DAYS_PER_WEEK = 7;
const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
const INVALID_TIME_MESSAGE = 'This template has an invalid shift time.';

/**
 * Template snapshots store restaurant-local wall clocks. Every conversion in
 * this file uses the restaurant zone `tz`, never the browser zone: a manager
 * whose device zone differs from the restaurant zone must save and apply the
 * same hours as a manager in the restaurant.
 *
 * `weekStart` / `targetMonday` are calendar dates that the UI picks
 * (host-local midnight), so `formatLocalDate` reads them correctly. This is
 * the same rule as `copyWeekShifts.ts`.
 */

/** Throw `INVALID_DATE` when `tz` is missing or is not a known IANA zone. */
function requireValidTz(tz: string | null | undefined): asserts tz is string {
  requireTz(tz);
  if (!isValidTimezone(tz)) {
    throw new TypeError('INVALID_DATE');
  }
}

/** Parse a stored `HH:MM:SS` (or legacy `HH:MM`) wall clock. */
function parseTime(time: string): { hhmm: string; seconds: number; sortKey: string } {
  const match = TIME_RE.exec(time);
  if (!match) throw new Error(INVALID_TIME_MESSAGE);

  const [, hh, mm, ss = '00'] = match;
  if (Number(hh) > 23 || Number(mm) > 59 || Number(ss) > 59) {
    throw new Error(INVALID_TIME_MESSAGE);
  }
  return { hhmm: `${hh}:${mm}`, seconds: Number(ss), sortKey: `${hh}:${mm}:${ss}` };
}

/** Resolve a restaurant-local wall clock to an instant, keeping the seconds. */
function toInstant(dateStr: string, time: { hhmm: string; seconds: number }, tz: string): Date {
  // The UTC offset is constant inside one minute, so adding the seconds after
  // the DST resolution is exact.
  return new Date(wallClockToInstant(dateStr, time.hhmm, tz).getTime() + time.seconds * 1000);
}

export function buildTemplateSnapshot(
  shifts: Shift[],
  weekStart: Date,
  tz: string,
): TemplateShiftSnapshot[] {
  requireValidTz(tz);
  const weekStartStr = formatLocalDate(weekStart);

  return shifts
    .filter((s) => s.status !== 'cancelled')
    .map((shift) => ({
      day_offset: daysBetweenDateStrs(weekStartStr, formatLocalDateInTz(new Date(shift.start_time), tz)),
      start_time: formatLocalTimeInTz(shift.start_time, tz),
      end_time: formatLocalTimeInTz(shift.end_time, tz),
      break_duration: shift.break_duration,
      position: shift.position,
      employee_id: shift.employee_id,
      employee_name: shift.employee?.name ?? 'Unknown',
      notes: shift.notes ?? null,
    }))
    // The shift list can hold shifts from the previous or the next restaurant
    // week when the browser zone differs from the restaurant zone. They are
    // not part of this week, and `day_offset` must stay in 0..6.
    .filter((snap) => snap.day_offset >= 0 && snap.day_offset < DAYS_PER_WEEK);
}

export function buildShiftsFromTemplate(
  snapshots: TemplateShiftSnapshot[],
  targetMonday: Date,
  restaurantId: string,
  tz: string,
): BulkShiftInsert[] {
  requireValidTz(tz);
  const mondayStr = formatLocalDate(targetMonday);

  return snapshots.map((snap) => {
    const dateStr = addDaysToDateStr(mondayStr, snap.day_offset);
    const start = parseTime(snap.start_time);
    const end = parseTime(snap.end_time);

    // Decide "overnight" from the wall clocks, not from the instants: on a
    // DST day the instants can reorder (see the check below).
    const endDateStr = end.sortKey <= start.sortKey ? addDaysToDateStr(dateStr, 1) : dateStr;

    const newStart = toInstant(dateStr, start, tz);
    const newEnd = toInstant(endDateStr, end, tz);

    // Example: 02:30-03:00 on a spring-forward day. 02:30 does not exist and
    // resolves after 03:00. The `shifts` table rejects `end_time <= start_time`.
    if (newEnd <= newStart) {
      throw new Error(`A template shift has no length on ${dateStr} after the DST change.`);
    }

    return {
      restaurant_id: restaurantId,
      employee_id: snap.employee_id,
      start_time: newStart.toISOString(),
      end_time: newEnd.toISOString(),
      break_duration: snap.break_duration,
      position: snap.position,
      notes: snap.notes,
      status: 'scheduled' as const,
      is_published: false,
      locked: false,
    };
  });
}

/**
 * The restaurant-local week that `apply_schedule_plan_template` clears in
 * `replace` mode: from the first instant of Monday to the last millisecond
 * before the next Monday, both in `tz`. The RPC compares with
 * `start_time <= p_target_end`, so the end is inclusive.
 */
export function templateWeekBounds(targetMonday: Date, tz: string): { start: string; end: string } {
  requireValidTz(tz);
  const mondayStr = formatLocalDate(targetMonday);
  const nextMondayStr = addDaysToDateStr(mondayStr, DAYS_PER_WEEK);

  return {
    start: firstInstantOfDay(mondayStr, tz).toISOString(),
    end: new Date(firstInstantOfDay(nextMondayStr, tz).getTime() - 1).toISOString(),
  };
}
