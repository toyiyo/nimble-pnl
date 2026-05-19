/**
 * availability-tz.ts
 *
 * Pure utility: convert employee availability rows whose times are stored as
 * UTC clock values (TIME columns with no timezone metadata, written by
 * AvailabilityDialog via localTimeToUtcTime) back into restaurant-local clock
 * values for the AI prompt + validator.
 *
 * Rows whose conversion crosses local midnight are split into two LocalAvail
 * rows on adjacent local days.
 */
import { toZonedTime } from "date-fns-tz";

export interface RawRecurringAvail {
  employee_id: string;
  /** 0=Sun..6=Sat in the user's restaurant-local calendar */
  day_of_week: number;
  is_available: boolean;
  /** UTC clock time HH:MM:SS, or null when "all day" / unavailable */
  start_time: string | null;
  end_time: string | null;
}

export interface RawExceptionAvail {
  employee_id: string;
  /** YYYY-MM-DD restaurant-local calendar date */
  date: string;
  is_available: boolean;
  start_time: string | null;
  end_time: string | null;
}

export interface LocalAvail {
  employee_id: string;
  day_of_week: number; // 0=Sun..6=Sat in restaurant local
  is_available: boolean;
  start_time: string | null; // HH:MM:SS in restaurant local
  end_time: string | null;   // HH:MM:SS in restaurant local
  isOvernight: boolean;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/**
 * Compute the YYYY-MM-DD for the given `dayOfWeek` (0=Sun..6=Sat) within the
 * calendar week that contains `weekStart`. `weekStart` may be any day of that
 * week; this function finds the Sunday of the week first, then adds `dayOfWeek`.
 */
function dateForDayOfWeek(weekStart: string, dayOfWeek: number): string {
  const [y, m, d] = weekStart.split("-").map(Number);
  const base = new Date(y, m - 1, d);
  // Step back to Sunday of the same week, then forward to the target day.
  const sundayOffset = base.getDay();
  base.setDate(base.getDate() - sundayOffset + dayOfWeek);
  return `${base.getFullYear()}-${pad2(base.getMonth() + 1)}-${pad2(base.getDate())}`;
}

interface LocalPoint {
  dayOfWeek: number;
  time: string; // HH:MM:SS
}

function utcClockToLocal(refDate: string, utcClock: string, tz: string): LocalPoint {
  const utcInstant = new Date(`${refDate}T${utcClock}Z`);
  const zoned = toZonedTime(utcInstant, tz);
  return { dayOfWeek: zoned.getDay(), time: formatTime(zoned) };
}

function convertOne(
  employeeId: string,
  refDateForStart: string,
  originalDayOfWeek: number,
  isAvailable: boolean,
  startUtc: string | null,
  endUtc: string | null,
  tz: string,
): LocalAvail[] {
  if (!isAvailable || startUtc === null || endUtc === null) {
    return [
      {
        employee_id: employeeId,
        day_of_week: originalDayOfWeek,
        is_available: isAvailable,
        start_time: startUtc,
        end_time: endUtc,
        isOvernight: false,
      },
    ];
  }

  if (tz === "UTC") {
    return [
      {
        employee_id: employeeId,
        day_of_week: originalDayOfWeek,
        is_available: true,
        start_time: startUtc,
        end_time: endUtc,
        isOvernight: false,
      },
    ];
  }

  const startMinutes = timeToMinutes(startUtc);
  const endMinutes = timeToMinutes(endUtc);
  const refDateForEnd =
    endMinutes <= startMinutes ? addDays(refDateForStart, 1) : refDateForStart;

  const localStart = utcClockToLocal(refDateForStart, startUtc, tz);
  const localEnd = utcClockToLocal(refDateForEnd, endUtc, tz);

  if (localStart.dayOfWeek === localEnd.dayOfWeek) {
    return [
      {
        employee_id: employeeId,
        day_of_week: localStart.dayOfWeek,
        is_available: true,
        start_time: localStart.time,
        end_time: localEnd.time,
        isOvernight: localEnd.time <= localStart.time,
      },
    ];
  }

  return [
    {
      employee_id: employeeId,
      day_of_week: localStart.dayOfWeek,
      is_available: true,
      start_time: localStart.time,
      end_time: "24:00:00",
      isOvernight: false,
    },
    {
      employee_id: employeeId,
      day_of_week: localEnd.dayOfWeek,
      is_available: true,
      start_time: "00:00:00",
      end_time: localEnd.time,
      isOvernight: false,
    },
  ];
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + days);
  return `${base.getUTCFullYear()}-${pad2(base.getUTCMonth() + 1)}-${pad2(base.getUTCDate())}`;
}

export function convertRecurringToLocal(
  rows: RawRecurringAvail[],
  restaurantTimezone: string,
  weekStart: string,
): LocalAvail[] {
  const out: LocalAvail[] = [];
  for (const row of rows) {
    const refDate = dateForDayOfWeek(weekStart, row.day_of_week);
    out.push(
      ...convertOne(
        row.employee_id,
        refDate,
        row.day_of_week,
        row.is_available,
        row.start_time,
        row.end_time,
        restaurantTimezone,
      ),
    );
  }
  return out;
}

export function convertExceptionsToLocal(
  rows: RawExceptionAvail[],
  restaurantTimezone: string,
): LocalAvail[] {
  const out: LocalAvail[] = [];
  for (const row of rows) {
    const [y, m, d] = row.date.split("-").map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    out.push(
      ...convertOne(
        row.employee_id,
        row.date,
        dow,
        row.is_available,
        row.start_time,
        row.end_time,
        restaurantTimezone,
      ),
    );
  }
  return out;
}
