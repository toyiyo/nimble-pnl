/**
 * Convert a local date+time in a given IANA timezone to a UTC ISO string.
 *
 * Uses Intl.DateTimeFormat to compute the UTC offset for the given timezone
 * and date, which correctly handles DST transitions. No external library needed.
 *
 * @param dateStr - Date in YYYY-MM-DD format
 * @param timeHHMM - Time in HH:MM format (24h)
 * @param timezone - IANA timezone string (e.g., 'America/Chicago')
 * @returns UTC ISO string like '2026-01-15T16:00:00.000Z'
 *
 * @note During DST "fall back" when wall-clock times repeat (e.g., 1:30 AM occurs
 *       twice), this function assumes the first occurrence (the earlier UTC instant).
 *       During DST "spring forward" gaps (e.g., 2:30 AM does not exist), the result
 *       is an approximation. These edge cases are acceptable for the shift planner
 *       domain where shifts rarely start at 2-3 AM.
 */
export function localToUTC(dateStr: string, timeHHMM: string, timezone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Invalid dateStr format: "${dateStr}" (expected YYYY-MM-DD)`);
  }
  if (!/^\d{2}:\d{2}$/.test(timeHHMM)) {
    throw new Error(`Invalid timeHHMM format: "${timeHHMM}" (expected HH:MM)`);
  }

  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = timeHHMM.split(':').map(Number);

  // Validate calendar ranges
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new Error(`Invalid date value: "${dateStr}"`);
  }
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Invalid time value: "${timeHHMM}"`);
  }

  // Build a Date in UTC first, then compute the offset for the target timezone
  const guessUTC = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0, 0));

  // Get the offset of the target timezone at this approximate time
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(guessUTC);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);

  const localAtGuess = new Date(
    Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')),
  );

  // Offset = localAtGuess - guessUTC (in ms)
  const offsetMs = localAtGuess.getTime() - guessUTC.getTime();

  // The actual UTC time = local wall-clock time - offset
  const actualUTC = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0, 0) - offsetMs);

  return actualUTC.toISOString();
}
