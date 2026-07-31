import {
  formatLocalDate,
  formatLocalDateInTz,
  formatLocalTimeInTz,
  wallClockToInstant,
} from '@/lib/shiftInterval';

import type { Shift } from '@/types/scheduling';

export interface BulkShiftInsert {
  restaurant_id: string;
  employee_id: string;
  start_time: string;
  end_time: string;
  break_duration: number;
  position: string;
  notes: string | null;
  status: 'scheduled';
  is_published: boolean;
  locked: boolean;
}

/** Add `days` (may be negative) to an ISO `YYYY-MM-DD` string via UTC field math. */
function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const rolled = new Date(Date.UTC(y, m - 1, d + days));
  const yy = rolled.getUTCFullYear();
  const mm = String(rolled.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(rolled.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Whole calendar days from `fromStr` to `toStr` (both `YYYY-MM-DD`), via UTC field math. */
function daysBetweenDateStrs(fromStr: string, toStr: string): number {
  const [fy, fm, fd] = fromStr.split('-').map(Number);
  const [ty, tm, td] = toStr.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / (24 * 60 * 60 * 1000));
}

/**
 * Reproject a shift instant onto the target week, preserving the
 * restaurant-local calendar day-of-week and wall-clock time.
 *
 * The day offset from `sourceMonday` is computed from the restaurant-local
 * calendar-day string of the instant (`formatLocalDateInTz`), never a
 * host-local `Date` getter — a manager whose device timezone differs from
 * the restaurant's would otherwise see the shift's day-of-week computed
 * against the wrong midnight and land the copy on the wrong calendar day
 * (see design doc, surface 5). The target instant is then rebuilt with
 * `wallClockToInstant`, which resolves DST identically to Postgres — that's
 * what makes this actually DST-safe, not the host-local reconstruction the
 * previous implementation used despite its "DST-safe" doc comment.
 *
 * `sourceMonday`/`targetMonday` are plain calendar dates picked from the UI
 * (host-local midnight `Date`s with no meaningful time component), so
 * extracting their `YYYY-MM-DD` via the host-local `formatLocalDate` is
 * correct — the ambiguity this function guards against is specific to
 * `isoString`, which is a real UTC instant that must be bucketed by the
 * restaurant's calendar, not the viewer's.
 */
function reprojectOntoTargetWeek(
  isoString: string,
  sourceMonday: Date,
  targetMonday: Date,
  tz: string,
): Date {
  const shiftDateStr = formatLocalDateInTz(new Date(isoString), tz);
  const wallClockTime = formatLocalTimeInTz(isoString, tz).slice(0, 5);

  const dayOffset = daysBetweenDateStrs(formatLocalDate(sourceMonday), shiftDateStr);
  const targetDateStr = addDaysToDateStr(formatLocalDate(targetMonday), dayOffset);

  return wallClockToInstant(targetDateStr, wallClockTime, tz);
}

/**
 * Transform source week shifts into insert payloads for a target week.
 * Preserves the restaurant-local calendar day-of-week and wall-clock time
 * per shift, resolving DST the same way the server does. Strips metadata
 * (IDs, timestamps, recurrence), resets publish/lock state. Excludes
 * cancelled shifts.
 */
export function buildCopyPayload(
  sourceShifts: Shift[],
  sourceMonday: Date,
  targetMonday: Date,
  restaurantId: string,
  tz: string,
): BulkShiftInsert[] {
  return sourceShifts
    .filter((s) => s.status !== 'cancelled')
    .map((shift) => {
      const newStart = reprojectOntoTargetWeek(shift.start_time, sourceMonday, targetMonday, tz);
      const newEnd = reprojectOntoTargetWeek(shift.end_time, sourceMonday, targetMonday, tz);

      return {
        restaurant_id: restaurantId,
        employee_id: shift.employee_id,
        start_time: newStart.toISOString(),
        end_time: newEnd.toISOString(),
        break_duration: shift.break_duration,
        position: shift.position,
        notes: shift.notes ?? null,
        status: 'scheduled' as const,
        is_published: false,
        locked: false,
      };
    });
}
