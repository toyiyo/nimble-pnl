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

/** Format a Date as a local ISO string (YYYY-MM-DDTHH:mm:ss) without UTC conversion. */
function toLocalISOString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}:${s}`;
}

/**
 * Transform source week shifts into insert payloads for a target week.
 * Offsets dates by the week delta, strips metadata (IDs, timestamps, recurrence),
 * resets publish/lock state. Excludes cancelled shifts.
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
        start_time: toLocalISOString(newStart),
        end_time: toLocalISOString(newEnd),
        break_duration: shift.break_duration,
        position: shift.position,
        notes: shift.notes ?? null,
        status: 'scheduled' as const,
        is_published: false,
        locked: false,
      };
    });
}
