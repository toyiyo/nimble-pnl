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
 * Transform source week shifts into insert payloads for a target week.
 * Offsets dates by the week delta, strips metadata (IDs, timestamps, recurrence),
 * resets publish/lock state. Excludes cancelled shifts.
 *
 * Uses .toISOString() for timestamps to match the codebase convention
 * (shifts.start_time is timestamptz in the database).
 */
export function buildCopyPayload(
  sourceShifts: Shift[],
  sourceMonday: Date,
  targetMonday: Date,
  restaurantId: string,
): BulkShiftInsert[] {
  const offsetMs = targetMonday.getTime() - sourceMonday.getTime();

  return sourceShifts
    .filter((s) => s.status !== 'cancelled')
    .map((shift) => {
      const newStart = new Date(new Date(shift.start_time).getTime() + offsetMs);
      const newEnd = new Date(new Date(shift.end_time).getTime() + offsetMs);

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
