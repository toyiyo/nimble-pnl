import { toZonedTime } from 'date-fns-tz';
import { EmployeeAvailability, AvailabilityException } from '@/types/scheduling';
import { utcTimeToLocalTime } from '@/lib/availabilityTimeUtils';
import { formatLocalTimeOfDay } from '@/lib/conflictFormatUtils';

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
  timezone: string,
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
          // Exception times are stored as UTC clock values. Convert them with the
          // exception date as the DST anchor (same formula as the RPC).
          const [ey, em, ed] = dateStr.split('-').map(Number);
          const anchor = new Date(ey, em - 1, ed);
          const toLocal = (t: string | null | undefined) =>
            t ? utcTimeToLocalTime(t, timezone, anchor) : null;
          empMap.set(dow, {
            type: 'exception',
            slots: dayExceptions.map((exc) => ({
              isAvailable: exc.is_available,
              startTime: toLocal(exc.start_time),
              endTime: toLocal(exc.end_time),
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
            startTime: avail.start_time_local ?? null,
            endTime: avail.end_time_local ?? null,
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

export type WeekAvailabilityStatus = 'time_off' | 'limited' | 'available' | 'unset';

export interface WeekAvailabilitySummary {
  status: WeekAvailabilityStatus;
  label: string;
}

/** True when a day's EffectiveAvailability is a hard "unavailable" (recurring off or unavailable exception). */
function isDayUnavailable(day: EffectiveAvailability): boolean {
  return day.type !== 'not-set' && day.slots[0]?.isAvailable === false;
}

/** True when a day's EffectiveAvailability has at least one available slot. */
function isDayAvailable(day: EffectiveAvailability): boolean {
  return day.slots.some((slot) => slot.isAvailable);
}

/**
 * Rolls up one employee's per-day EffectiveAvailability for the displayed
 * week (plus approved time off) into a single chip status. Priority order:
 * approved time off > any unavailable/exception day ("limited") > any
 * available day > unset (no data at all — renders no chip).
 */
export function summarizeWeekAvailability(
  week: Map<number, EffectiveAvailability> | undefined,
  hasTimeOff: boolean,
  offLabel?: string,
): WeekAvailabilitySummary {
  if (hasTimeOff) {
    return { status: 'time_off', label: offLabel ?? 'Time off' };
  }

  const days = week ? Array.from(week.values()) : [];

  if (days.some(isDayUnavailable)) {
    return { status: 'limited', label: 'Limited availability' };
  }

  if (days.some(isDayAvailable)) {
    return { status: 'available', label: 'Available' };
  }

  return { status: 'unset', label: 'Availability not set' };
}

/**
 * Tint for the weekly availability chip beside an employee's name. `unset`
 * returns null so the caller renders no chip (avoids decorative noise for
 * employees with no availability data at all).
 */
export function weekAvailabilityChipClasses(status: WeekAvailabilityStatus): AvailabilityClasses | null {
  switch (status) {
    case 'time_off':
      return { bg: 'bg-muted/50', text: 'text-muted-foreground' };
    case 'limited':
      return { bg: 'bg-amber-500/10', text: 'text-amber-700 dark:text-amber-400' };
    case 'available':
      return { bg: 'bg-success/10', text: 'text-success' };
    case 'unset':
    default:
      return null;
  }
}

/**
 * The `time_off` chip tint, precomputed once — `weekAvailabilityChipClasses`
 * never returns null for this status. Both the desktop grid and the mobile
 * day-focused view use this exact tint for the "off" pill, so it's shared
 * here instead of each caller re-deriving its own copy.
 */
export const TIME_OFF_CHIP_CLASSES: AvailabilityClasses = weekAvailabilityChipClasses('time_off')!;

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

/**
 * One-line label for an EffectiveAvailability cell. Slot times are already
 * restaurant-local, so no timezone or date is needed. Joins every available
 * slot (not just `slots[0]`) with ' + ' to match TeamAvailabilityGrid's
 * split-shift convention.
 */
export function availabilityLabel(effective: EffectiveAvailability): string {
  if (effective.type === 'not-set') return 'No availability set';
  const slot = effective.slots[0];
  if (!slot?.isAvailable) return 'Unavailable';
  const ranges = effective.slots
    .filter((s) => s.isAvailable && s.startTime && s.endTime)
    .map((s) => `${formatLocalTimeOfDay(s.startTime!)} – ${formatLocalTimeOfDay(s.endTime!)}`);
  if (ranges.length === 0) return 'Available';
  return `Available ${ranges.join(' + ')}`;
}

const MINUTES_PER_DAY = 1440;

const toMin = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

/** Slots of one local day, placed on the shift axis by `offsetMin` from the shift's first day. */
interface SlotGroup {
  slots: EffectiveSlot[];
  offsetMin: number;
}

type Window = readonly [start: number, end: number];

/**
 * Slots from a previous local day that spill into the next day's early hours:
 * local end <= start and the end is not 00:00 (a 00:00 end is a day-end, not a spill).
 */
function overnightPrevSlots(slots: EffectiveSlot[]): EffectiveSlot[] {
  return slots.filter((s) => {
    if (!s.isAvailable || !s.startTime || !s.endTime) return false;
    const e = toMin(s.endTime);
    return e !== 0 && e <= toMin(s.startTime);
  });
}

/**
 * Spill slots a day gives to the NEXT day. Only recurring rows carry over.
 * The RPC reads carry-over from `employee_availability` only, never from an exception.
 */
function spillSlots(day: EffectiveAvailability | undefined): EffectiveSlot[] {
  return day?.type === 'recurring' ? overnightPrevSlots(day.slots) : [];
}

/** Turn slot groups into [start, end] minute windows on the shift axis. */
function buildWindows(groups: SlotGroup[]): Window[] {
  const windows: Window[] = [];
  for (const { slots, offsetMin } of groups) {
    for (const s of slots) {
      if (!s.isAvailable || !s.startTime || !s.endTime) continue;
      const ws = toMin(s.startTime) + offsetMin;
      let we = toMin(s.endTime) + offsetMin;
      if (we <= ws) we += MINUTES_PER_DAY; // overnight local window (00:00 end gives 1440)
      windows.push([ws, we]);
    }
  }
  return windows;
}

/**
 * True when the part [a, b] is not covered by any window. With no window at all,
 * the part is outside only when the day is marked off (no data means unknown).
 */
function partOutside(a: number, b: number, windows: Window[], dayIsOff: boolean): boolean {
  if (windows.some(([ws, we]) => a >= ws && b <= we)) return false;
  return windows.length > 0 || dayIsOff;
}

function isDayOff(day: EffectiveAvailability | undefined): boolean {
  const slot = day?.slots[0];
  return !!slot && !slot.isAvailable;
}

/**
 * True when [shiftStart, shiftEnd] (instants) falls outside the employee's
 * available window(s). Client-side mirror of the `check_availability_conflict`
 * RPC: slot times are restaurant-local; `timezone` converts only the shift
 * instants. The shift is split by local date and each part is checked alone.
 * A part that ends exactly at 00:00 has no next-day part.
 * `prevDay` and `nextDay` are the neighbour local days' availability.
 * A day with an exception ignores carry-over from the day before, as the RPC does.
 */
export function shiftOutsideAvailability(
  today: EffectiveAvailability,
  prevDay: EffectiveAvailability | undefined,
  shiftStart: Date,
  shiftEnd: Date,
  timezone: string,
  nextDay?: EffectiveAvailability,
): boolean {
  // Convert the shift INSTANTS to restaurant-local wall clock (NOT host TZ — lesson 2026-05-10).
  const zStart = toZonedTime(shiftStart, timezone);
  const zEnd = toZonedTime(shiftEnd, timezone);
  const startMin = zStart.getHours() * 60 + zStart.getMinutes();
  const dayDelta = Math.round(
    (new Date(zEnd.getFullYear(), zEnd.getMonth(), zEnd.getDate()).getTime() -
      new Date(zStart.getFullYear(), zStart.getMonth(), zStart.getDate()).getTime()) /
      86_400_000,
  );
  const endMin = zEnd.getHours() * 60 + zEnd.getMinutes() + dayDelta * MINUTES_PER_DAY;

  const part1 = buildWindows([
    { slots: today.slots, offsetMin: 0 },
    {
      slots: today.type === 'exception' ? [] : spillSlots(prevDay),
      offsetMin: -MINUTES_PER_DAY,
    },
  ]);
  if (partOutside(startMin, Math.min(endMin, MINUTES_PER_DAY), part1, isDayOff(today))) return true;

  if (endMin > MINUTES_PER_DAY) {
    const part2 = buildWindows([
      { slots: nextDay ? nextDay.slots : [], offsetMin: MINUTES_PER_DAY },
      { slots: nextDay?.type === 'exception' ? [] : spillSlots(today), offsetMin: 0 },
    ]);
    if (partOutside(MINUTES_PER_DAY, endMin, part2, isDayOff(nextDay))) return true;
  }
  return false;
}
