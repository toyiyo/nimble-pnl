import { toZonedTime, fromZonedTime } from 'date-fns-tz';

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

  const refYear = referenceDate.getUTCFullYear();
  const refMonth = String(referenceDate.getUTCMonth() + 1).padStart(2, '0');
  const refDay = String(referenceDate.getUTCDate()).padStart(2, '0');

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

  const refYear = referenceDate.getUTCFullYear();
  const refMonth = String(referenceDate.getUTCMonth() + 1).padStart(2, '0');
  const refDay = String(referenceDate.getUTCDate()).padStart(2, '0');

  const dateStr = `${refYear}-${refMonth}-${refDay}T${normalizedTime}`;
  const utcDate = fromZonedTime(dateStr, timezone);

  const h = String(utcDate.getUTCHours()).padStart(2, '0');
  const m = String(utcDate.getUTCMinutes()).padStart(2, '0');
  const s = String(utcDate.getUTCSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}
