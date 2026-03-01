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
 */
export function localToUTC(dateStr: string, timeHHMM: string, timezone: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = timeHHMM.split(':').map(Number);

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
  });

  const parts = formatter.formatToParts(guessUTC);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);

  const localAtGuess = new Date(
    Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour') === 24 ? 0 : get('hour'),
      get('minute'),
      get('second'),
    ),
  );

  // Offset = localAtGuess - guessUTC (in ms)
  const offsetMs = localAtGuess.getTime() - guessUTC.getTime();

  // The actual UTC time = local wall-clock time - offset
  const actualUTC = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0, 0) - offsetMs);

  return actualUTC.toISOString().replace(/\.\d{3}Z$/, '.000Z');
}
