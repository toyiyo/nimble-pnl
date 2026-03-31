import type { Shift, TemplateShiftSnapshot } from '@/types/scheduling';
import type { BulkShiftInsert } from '@/lib/copyWeekShifts';

function formatTimeLocal(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function computeDayOffset(isoString: string, weekStart: Date): number {
  const d = new Date(isoString);
  const dMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const wMidnight = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
  return Math.round((dMidnight.getTime() - wMidnight.getTime()) / (24 * 60 * 60 * 1000));
}

function parseTime(time: string): { hours: number; minutes: number; seconds: number } {
  const [h, m, s] = time.split(':').map(Number);
  return { hours: h, minutes: m, seconds: s ?? 0 };
}

export function buildTemplateSnapshot(
  shifts: Shift[],
  weekStart: Date,
): TemplateShiftSnapshot[] {
  return shifts
    .filter((s) => s.status !== 'cancelled')
    .map((shift) => {
      const start = new Date(shift.start_time);
      const end = new Date(shift.end_time);

      return {
        day_offset: computeDayOffset(shift.start_time, weekStart),
        start_time: formatTimeLocal(start),
        end_time: formatTimeLocal(end),
        break_duration: shift.break_duration,
        position: shift.position,
        employee_id: shift.employee_id,
        employee_name: shift.employee?.name ?? 'Unknown',
        notes: shift.notes ?? null,
      };
    });
}

export function buildShiftsFromTemplate(
  snapshots: TemplateShiftSnapshot[],
  targetMonday: Date,
  restaurantId: string,
): BulkShiftInsert[] {
  return snapshots.map((snap) => {
    const targetDate = new Date(targetMonday);
    targetDate.setDate(targetMonday.getDate() + snap.day_offset);

    const startParts = parseTime(snap.start_time);
    const endParts = parseTime(snap.end_time);

    const newStart = new Date(
      targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(),
      startParts.hours, startParts.minutes, startParts.seconds,
    );

    const newEnd = new Date(
      targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(),
      endParts.hours, endParts.minutes, endParts.seconds,
    );

    if (newEnd <= newStart) {
      newEnd.setDate(newEnd.getDate() + 1);
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
