import { toZonedTime } from 'date-fns-tz';
import { EmployeeAvailability, AvailabilityException } from '@/types/scheduling';
import { utcTimeToLocalTime } from '@/lib/availabilityTimeUtils';
import { formatUTCTimeToLocal } from '@/lib/conflictFormatUtils';

export interface EffectiveSlot {
  isAvailable: boolean;
  startTime: string | null;
  endTime: string | null;
  reason?: string;
  sourceRecord: EmployeeAvailability | AvailabilityException;
}

export interface EffectiveAvailability {
  type: 'recurring' | 'exception' | 'not-set';
  slots: EffectiveSlot[];
}

function getWeekDates(weekStart: Date): Map<string, number> {
  const dates = new Map<string, number>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    dates.set(dateStr, d.getDay());
  }
  return dates;
}

export function computeEffectiveAvailability(
  availability: EmployeeAvailability[],
  exceptions: AvailabilityException[],
  weekStart: Date,
  employeeIds: string[],
): Map<string, Map<number, EffectiveAvailability>> {
  const weekDates = getWeekDates(weekStart);
  const result = new Map<string, Map<number, EffectiveAvailability>>();

  // Index exceptions by "empId:dateStr" — only those within the displayed week
  const exceptionsByEmpDate = new Map<string, AvailabilityException[]>();
  for (const exc of exceptions) {
    if (!weekDates.has(exc.date)) continue;
    const key = `${exc.employee_id}:${exc.date}`;
    const existing = exceptionsByEmpDate.get(key) ?? [];
    existing.push(exc);
    exceptionsByEmpDate.set(key, existing);
  }

  // Index recurring availability by "empId:dayOfWeek"
  const recurringByEmpDay = new Map<string, EmployeeAvailability[]>();
  for (const avail of availability) {
    const key = `${avail.employee_id}:${avail.day_of_week}`;
    const existing = recurringByEmpDay.get(key) ?? [];
    existing.push(avail);
    recurringByEmpDay.set(key, existing);
  }

  // Build reverse map: day_of_week → dateStr (only one date per DOW in a week)
  const dowToDate = new Map<number, string>();
  for (const [dateStr, dow] of weekDates) {
    dowToDate.set(dow, dateStr);
  }

  for (const empId of employeeIds) {
    const empMap = new Map<number, EffectiveAvailability>();

    for (let dow = 0; dow < 7; dow++) {
      const dateStr = dowToDate.get(dow);

      // Check exceptions first (they override recurring)
      if (dateStr) {
        const excKey = `${empId}:${dateStr}`;
        const dayExceptions = exceptionsByEmpDate.get(excKey);
        if (dayExceptions && dayExceptions.length > 0) {
          empMap.set(dow, {
            type: 'exception',
            slots: dayExceptions.map((exc) => ({
              isAvailable: exc.is_available,
              startTime: exc.start_time ?? null,
              endTime: exc.end_time ?? null,
              reason: exc.reason || undefined,
              sourceRecord: exc,
            })),
          });
          continue;
        }
      }

      // Fall back to recurring availability
      const recurKey = `${empId}:${dow}`;
      const recurring = recurringByEmpDay.get(recurKey);
      if (recurring && recurring.length > 0) {
        empMap.set(dow, {
          type: 'recurring',
          slots: recurring.map((avail) => ({
            isAvailable: avail.is_available,
            startTime: avail.start_time ?? null,
            endTime: avail.end_time ?? null,
            sourceRecord: avail,
          })),
        });
        continue;
      }

      // No data for this day
      empMap.set(dow, { type: 'not-set', slots: [] });
    }

    result.set(empId, empMap);
  }

  return result;
}

export interface AvailabilityClasses {
  bg: string;
  text: string;
}

/**
 * Semantic tint for an EffectiveAvailability — the exact treatment used by
 * TeamAvailabilityGrid.AvailabilityCell, extracted here so the grid, the
 * planner sidebar strip, and the timeline bar marker can't drift apart.
 */
export function availabilityColorClasses(effective: EffectiveAvailability): AvailabilityClasses {
  const slot = effective.slots[0];
  const isAvailable = slot?.isAvailable ?? false;
  const isException = effective.type === 'exception';
  const isExceptionAvailable = isException && isAvailable;
  const isExceptionUnavailable = isException && !isAvailable;
  const isRecurringAvailable = effective.type === 'recurring' && isAvailable;
  const isRecurringUnavailable = effective.type === 'recurring' && !isAvailable;

  if (isRecurringAvailable || isExceptionAvailable) {
    return { bg: 'bg-emerald-500/10 hover:bg-emerald-500/20', text: 'text-emerald-700 dark:text-emerald-400' };
  }
  if (isExceptionUnavailable) {
    return { bg: 'bg-amber-500/10 hover:bg-amber-500/20', text: 'text-amber-700 dark:text-amber-400' };
  }
  if (isRecurringUnavailable) {
    return { bg: 'bg-red-500/5 hover:bg-red-500/10', text: 'text-red-600/70 dark:text-red-400/70' };
  }
  return { bg: 'bg-muted/30 hover:bg-muted/50', text: 'text-muted-foreground' };
}

/** Localized one-line label for an EffectiveAvailability cell. */
export function availabilityLabel(effective: EffectiveAvailability, timezone: string, date: Date): string {
  if (effective.type === 'not-set') return 'No availability set';
  const slot = effective.slots[0];
  if (!slot?.isAvailable) return 'Unavailable';
  if (!slot.startTime || !slot.endTime) return 'Available';
  return `Available ${formatUTCTimeToLocal(slot.startTime, timezone, date)} – ${formatUTCTimeToLocal(slot.endTime, timezone, date)}`;
}

/**
 * Slots from a previous local day whose converted window is locally
 * overnight (end <= start), i.e. windows that spill into today's early hours.
 */
function overnightPrevSlots(
  slots: EffectiveSlot[],
  timezone: string,
  date: Date,
): EffectiveSlot[] {
  return slots.filter((s) => {
    if (!s.isAvailable || !s.startTime || !s.endTime) return false;
    const [sh, sm] = utcTimeToLocalTime(s.startTime, timezone, date).split(':').map(Number);
    const [eh, em] = utcTimeToLocalTime(s.endTime, timezone, date).split(':').map(Number);
    return eh * 60 + em <= sh * 60 + sm;
  });
}

/**
 * True when [shiftStart, shiftEnd] (instants) falls outside the employee's
 * available window(s) for the given local day. Client-side mirror of the
 * `check_availability_conflict` RPC's local-frame logic: trust the stored
 * day_of_week, convert only time-of-day, and treat a local end <= start as
 * overnight. `prevDay` is the previous local day's EffectiveAvailability
 * (needed so an overnight window from yesterday can cover today's early
 * hours).
 */
export function shiftOutsideAvailability(
  today: EffectiveAvailability,
  prevDay: EffectiveAvailability | undefined,
  shiftStart: Date,
  shiftEnd: Date,
  timezone: string,
  date: Date,
): boolean {
  // not-set / no data => unknown => not flagged (matches the RPC's "no conflict").
  if (today.type === 'not-set') return false;
  const slot = today.slots[0];
  if (slot && !slot.isAvailable) return true; // recurring off / unavailable exception

  // Convert the shift INSTANTS to restaurant-local wall clock (NOT host TZ — lesson 2026-05-10).
  const zStart = toZonedTime(shiftStart, timezone);
  const zEnd = toZonedTime(shiftEnd, timezone);
  const startMin = zStart.getHours() * 60 + zStart.getMinutes();
  const dayDelta = Math.round(
    (new Date(zEnd.getFullYear(), zEnd.getMonth(), zEnd.getDate()).getTime() -
      new Date(zStart.getFullYear(), zStart.getMonth(), zStart.getDate()).getTime()) /
      86_400_000,
  );
  const endMin = zEnd.getHours() * 60 + zEnd.getMinutes() + dayDelta * 1440;

  const windows: Array<[number, number]> = [];
  const pushWindow = (slots: EffectiveSlot[], offsetMin: number) => {
    for (const s of slots) {
      if (!s.isAvailable || !s.startTime || !s.endTime) continue;
      const [sh, sm] = utcTimeToLocalTime(s.startTime, timezone, date).split(':').map(Number);
      const [eh, em] = utcTimeToLocalTime(s.endTime, timezone, date).split(':').map(Number);
      const ws = sh * 60 + sm + offsetMin;
      let we = eh * 60 + em + offsetMin;
      if (we <= ws) we += 1440; // overnight local window
      windows.push([ws, we]);
    }
  };
  pushWindow(today.slots, 0);
  if (prevDay) pushWindow(overnightPrevSlots(prevDay.slots, timezone, date), -1440);

  if (windows.length === 0) return false; // available-all-day / unknown
  return !windows.some(([ws, we]) => startMin >= ws && endMin <= we);
}
