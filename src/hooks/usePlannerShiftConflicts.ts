import { useMemo } from 'react';

import { shiftOutsideAvailability } from '@/lib/effectiveAvailability';
import { formatConflictLine } from '@/lib/conflictFormatUtils';
import { addDaysToDateStr } from '@/lib/restaurantClock';
import { formatLocalDateInTz, formatLocalTimeInTz } from '@/lib/shiftInterval';

import type { EffectiveAvailability } from '@/lib/effectiveAvailability';
import type { ConflictCheck, Shift, TimeOffRequest } from '@/types/scheduling';

/**
 * Read-time conflict index for the planner grid.
 *
 * Client-side mirror of the two write-time conflict RPCs, in one batch pass:
 * - check_timeoff_conflict (migration 20260723180000): restaurant-local
 *   calendar dates, `status IN ('approved','pending')`, closed-interval
 *   overlap, and a shift that ends at local midnight belongs to its start
 *   day.
 * - check_availability_conflict, through the shared shiftOutsideAvailability
 *   predicate — the same mirror TimelineBar uses for its live amber marker.
 *
 * The RPCs stay authoritative at write time (AvailabilityConflictDialog).
 * This index only powers the persistent amber indicators, so the planner
 * needs zero network calls per chip.
 */

type AvailabilityByEmployee = Map<string, Map<number, EffectiveAvailability>>;

const CONFLICTABLE_TIME_OFF = new Set(['approved', 'pending']);

/** Local calendar dates of a shift in the restaurant frame, with the RPC's
 *  midnight rule: an end on `00:00:00` after the start day rolls back one day. */
function shiftLocalDates(shift: Shift, tz: string): { startDate: string; endDate: string } {
  const startDate = formatLocalDateInTz(new Date(shift.start_time), tz);
  const endDate = formatLocalDateInTz(new Date(shift.end_time), tz);
  const rollsBack = endDate > startDate && formatLocalTimeInTz(shift.end_time, tz) === '00:00:00';
  return { startDate, endDate: rollsBack ? addDaysToDateStr(endDate, -1) : endDate };
}

function timeOffConflicts(
  requestsForEmployee: readonly TimeOffRequest[] | undefined,
  startDate: string,
  endDate: string,
): ConflictCheck[] {
  if (!requestsForEmployee) return [];
  // Closed-interval overlap on ISO date strings — order-equivalent to the
  // RPC's DATE comparison.
  return requestsForEmployee
    .filter((request) => request.start_date <= endDate && request.end_date >= startDate)
    .map((request) => ({
      has_conflict: true,
      conflict_type: 'time-off',
      message: `Employee has ${request.status} time-off from ${request.start_date} to ${request.end_date}`,
      time_off_id: request.id,
      start_date: request.start_date,
      end_date: request.end_date,
      status: request.status,
    }));
}

function availabilityConflict(
  dowMap: Map<number, EffectiveAvailability> | undefined,
  shift: Shift,
  startDate: string,
  tz: string,
): ConflictCheck | null {
  if (!dowMap) return null;
  const localDate = new Date(startDate + 'T00:00:00');
  const dow = localDate.getDay();
  const today = dowMap.get(dow);
  if (!today) return null;
  const prev = dowMap.get((dow + 6) % 7);
  const next = dowMap.get((dow + 1) % 7);
  const outside = shiftOutsideAvailability(
    today,
    prev,
    new Date(shift.start_time),
    new Date(shift.end_time),
    tz,
    localDate,
    next,
  );
  if (!outside) return null;
  // A 'not-set' day can still conflict through the prev-day or next-day
  // rules; it maps to 'recurring' with no window fields.
  const firstWindow = today.slots.find((s) => s.isAvailable && s.startTime && s.endTime);
  return {
    has_conflict: true,
    conflict_type: today.type === 'exception' ? 'exception' : 'recurring',
    message: `Shift on ${startDate} is outside availability`,
    available_start: firstWindow?.startTime ?? undefined,
    available_end: firstWindow?.endTime ?? undefined,
  };
}

export function buildShiftConflictIndex(
  shifts: readonly Shift[],
  availabilityByEmployee: AvailabilityByEmployee,
  timeOffRequests: readonly TimeOffRequest[],
  timezone: string,
): Map<string, string[]> {
  const timeOffByEmployee = new Map<string, TimeOffRequest[]>();
  for (const request of timeOffRequests) {
    if (!CONFLICTABLE_TIME_OFF.has(request.status)) continue;
    const bucket = timeOffByEmployee.get(request.employee_id) ?? [];
    bucket.push(request);
    timeOffByEmployee.set(request.employee_id, bucket);
  }

  const index = new Map<string, string[]>();
  for (const shift of shifts) {
    if (shift.status === 'cancelled' || shift.status === 'completed') continue;
    if (!shift.employee_id) continue;

    const { startDate, endDate } = shiftLocalDates(shift, timezone);
    const conflicts = timeOffConflicts(timeOffByEmployee.get(shift.employee_id), startDate, endDate);
    const availability = availabilityConflict(
      availabilityByEmployee.get(shift.employee_id),
      shift,
      startDate,
      timezone,
    );
    if (availability) conflicts.push(availability);

    if (conflicts.length > 0) {
      index.set(
        shift.id,
        conflicts.map((conflict) => formatConflictLine(conflict, timezone)),
      );
    }
  }
  return index;
}

export interface UsePlannerShiftConflictsReturn {
  /** shiftId -> display-ready conflict lines. No entry means no conflict. */
  conflictsByShiftId: Map<string, string[]>;
  /** Number of shifts that have at least one conflict line. */
  conflictCount: number;
}

export function usePlannerShiftConflicts(
  shifts: readonly Shift[],
  availabilityByEmployee: AvailabilityByEmployee,
  timeOffRequests: readonly TimeOffRequest[],
  timezone: string,
): UsePlannerShiftConflictsReturn {
  return useMemo(() => {
    const conflictsByShiftId = buildShiftConflictIndex(
      shifts,
      availabilityByEmployee,
      timeOffRequests,
      timezone,
    );
    return { conflictsByShiftId, conflictCount: conflictsByShiftId.size };
  }, [shifts, availabilityByEmployee, timeOffRequests, timezone]);
}
