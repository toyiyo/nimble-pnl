import { formatInstant, toBusinessDay } from '@/lib/restaurantClock';

/**
 * Format a HH:MM[:SS] time string into a compact 12-hour label.
 * Examples: "14:00" → "2p", "09:30" → "9:30a"
 */
export function formatCompactTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'p' : 'a';
  const hour12 = h % 12 || 12;
  if (m === 0) return `${hour12}${suffix}`;
  return `${hour12}:${String(m).padStart(2, '0')}${suffix}`;
}

function toMinutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export interface ConflictCandidateShift {
  start_time: string;
  end_time: string;
  status: string;
}

/**
 * True when an open shift (a restaurant-local calendar day + HH:MM[:SS] wall-clock
 * start/end, both case (a)/wall-clock values already local to the restaurant) overlaps
 * any of an employee's existing shifts.
 *
 * `employeeShifts[].start_time`/`end_time` are instants (case (b) — e.g. Toast/DB
 * timestamps) and must be bucketed to a calendar day and a wall-clock time-of-day via
 * the restaurant's timezone (`toBusinessDay` / `formatInstant`), never the viewer's —
 * `new Date(iso).getHours()` reads the browser's local timezone and silently drops or
 * adds a conflict for any operator whose device isn't in the restaurant's zone.
 */
export function hasScheduleConflict(
  openShiftDate: string,
  openStartTime: string, // HH:MM[:SS], restaurant-local
  openEndTime: string, // HH:MM[:SS], restaurant-local
  employeeShifts: ConflictCandidateShift[],
  tz: string,
): boolean {
  const osStart = toMinutesOfDay(openStartTime);
  const osEnd = toMinutesOfDay(openEndTime);

  return employeeShifts.some((s) => {
    if (s.status === 'cancelled') return false;
    const sDate = toBusinessDay(s.start_time, tz);
    if (sDate !== openShiftDate) return false;
    const sStartMin = toMinutesOfDay(formatInstant(s.start_time, tz, 'HH:mm'));
    const sEndMin = toMinutesOfDay(formatInstant(s.end_time, tz, 'HH:mm'));
    return sStartMin < osEnd && sEndMin > osStart;
  });
}
