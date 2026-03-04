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

/**
 * Offset a timestamp to a target week while preserving local wall-clock time.
 * Computes the calendar-day offset from sourceMonday, then reconstructs the
 * date using local Date constructor so hours/minutes/seconds are preserved
 * even across DST boundaries.
 */
function offsetPreservingLocalTime(
  isoString: string,
  sourceMonday: Date,
  targetMonday: Date,
): Date {
  const src = new Date(isoString);

  // Calendar-day offset from source Monday (0 = Monday, 1 = Tuesday, etc.)
  const srcMidnight = new Date(src.getFullYear(), src.getMonth(), src.getDate());
  const srcMondayMidnight = new Date(
    sourceMonday.getFullYear(), sourceMonday.getMonth(), sourceMonday.getDate(),
  );
  const dayOffset = Math.round(
    (srcMidnight.getTime() - srcMondayMidnight.getTime()) / (24 * 60 * 60 * 1000),
  );

  // Reconstruct in local time on the target week's equivalent day
  const targetDate = new Date(targetMonday);
  targetDate.setDate(targetMonday.getDate() + dayOffset);

  return new Date(
    targetDate.getFullYear(),
    targetDate.getMonth(),
    targetDate.getDate(),
    src.getHours(),
    src.getMinutes(),
    src.getSeconds(),
    src.getMilliseconds(),
  );
}

/**
 * Transform source week shifts into insert payloads for a target week.
 * Preserves local wall-clock time per shift (DST-safe), strips metadata
 * (IDs, timestamps, recurrence), resets publish/lock state.
 * Excludes cancelled shifts.
 */
export function buildCopyPayload(
  sourceShifts: Shift[],
  sourceMonday: Date,
  targetMonday: Date,
  restaurantId: string,
): BulkShiftInsert[] {
  return sourceShifts
    .filter((s) => s.status !== 'cancelled')
    .map((shift) => {
      const newStart = offsetPreservingLocalTime(shift.start_time, sourceMonday, targetMonday);
      const newEnd = offsetPreservingLocalTime(shift.end_time, sourceMonday, targetMonday);

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
