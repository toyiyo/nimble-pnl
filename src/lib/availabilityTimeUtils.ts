import { toZonedTime, fromZonedTime } from 'date-fns-tz';

export type AvailabilityWindowLocal = {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_available: boolean;
};

/**
 * Convert a UTC time string (HH:MM or HH:MM:SS) to local time in the given timezone.
 *
 * Uses `referenceDate` to determine the correct DST offset. Defaults to today.
 * This avoids the 1970-01-01 bug where winter DST offset was always applied.
 *
 * @returns Local time as "HH:MM" string
 */
export function utcTimeToLocalTime(
  utcTime: string,
  timezone: string,
  referenceDate: Date = new Date(),
): string {
  const timeParts = utcTime.split(':');
  const normalizedTime = timeParts.length === 2 ? `${utcTime}:00` : utcTime;

  const refYear = referenceDate.getFullYear();
  const refMonth = String(referenceDate.getMonth() + 1).padStart(2, '0');
  const refDay = String(referenceDate.getDate()).padStart(2, '0');

  const utcDate = new Date(`${refYear}-${refMonth}-${refDay}T${normalizedTime}Z`);
  const zoned = toZonedTime(utcDate, timezone);

  const h = String(zoned.getHours()).padStart(2, '0');
  const m = String(zoned.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Convert a local time string (HH:MM) in the given timezone to UTC.
 *
 * Uses `referenceDate` to determine the correct DST offset. Defaults to today.
 *
 * @returns UTC time as "HH:MM:SS" string
 */
export function localTimeToUtcTime(
  localTime: string,
  timezone: string,
  referenceDate: Date = new Date(),
): string {
  const timeParts = localTime.split(':');
  const normalizedTime = timeParts.length === 2 ? `${localTime}:00` : localTime;

  const refYear = referenceDate.getFullYear();
  const refMonth = String(referenceDate.getMonth() + 1).padStart(2, '0');
  const refDay = String(referenceDate.getDate()).padStart(2, '0');

  const dateStr = `${refYear}-${refMonth}-${refDay}T${normalizedTime}`;
  const utcDate = fromZonedTime(dateStr, timezone);

  const h = String(utcDate.getUTCHours()).padStart(2, '0');
  const m = String(utcDate.getUTCMinutes()).padStart(2, '0');
  const s = String(utcDate.getUTCSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/**
 * Convert a list of availability windows from restaurant-local time to UTC.
 *
 * employee_availability.start_time/end_time follow a UTC contract enforced by
 * every reader (AvailabilityDialog, TeamAvailabilityGrid, EmployeePortal,
 * generate-schedule edge function). Bulk-set callers receive local-time
 * defaults derived from shift templates and business hours, so they must
 * convert before writing.
 *
 * `is_available: false` rows are passed through unchanged — closed-day rows
 * keep whatever placeholder times the caller provided.
 *
 * DST note: a single `referenceDate` (today by default) anchors the offset
 * for every weekday row. Per-weekday anchoring would correctly handle the
 * 1-hour gap when the next occurrence of a row's day_of_week falls on the
 * other side of a DST boundary, BUT it would also desynchronize this writer
 * from AvailabilityDialog, which reads/writes individual rows using
 * today's offset. The TIME-column schema can't represent "10:00 local on
 * whatever day this falls" — it's lossy by design. Until the schema moves
 * to TIMESTAMPTZ or rows store an explicit anchor, every writer/reader pair
 * must agree on the same anchor (today) for round-trips to be consistent.
 */
export function convertAvailabilityWindowsToUtc(
  windows: AvailabilityWindowLocal[],
  timezone: string,
  referenceDate: Date = new Date(),
): AvailabilityWindowLocal[] {
  return windows.map((w) => {
    if (!w.is_available) return w;
    return {
      ...w,
      start_time: localTimeToUtcTime(w.start_time, timezone, referenceDate),
      end_time: localTimeToUtcTime(w.end_time, timezone, referenceDate),
    };
  });
}
