import { addDaysToDateStr, parseWallClock } from '@/lib/restaurantClock';

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
 * Compares INSTANT intervals, not minutes-of-day — a minutes-of-day comparison
 * collapses an overnight interval (e.g. 22:00→06:00) to `start > end`, making the
 * overlap test nonsense, and a same-day pre-filter on `openShiftDate` silently drops
 * a shift that starts the previous day and runs into it. The open shift's instants are
 * built from its restaurant-local wall clock via `parseWallClock`; `employeeShifts[].
 * start_time`/`end_time` are already instants (case (b) — e.g. Toast/DB timestamps)
 * and are used directly, with no viewer-local reads (`new Date(iso).getHours()` would
 * silently drop or add a conflict for any operator whose device isn't in the
 * restaurant's zone).
 */
export function hasScheduleConflict(
  openShiftDate: string,
  openStartTime: string, // HH:MM[:SS], restaurant-local
  openEndTime: string, // HH:MM[:SS], restaurant-local
  employeeShifts: ConflictCandidateShift[],
  tz: string,
): boolean {
  const openStartHHMM = openStartTime.slice(0, 5);
  const openEndHHMM = openEndTime.slice(0, 5);
  // An open shift whose end doesn't come after its start (HH:MM string compare
  // is safe here — both are zero-padded) runs past midnight into the next day.
  const openEndDate =
    openEndHHMM > openStartHHMM ? openShiftDate : addDaysToDateStr(openShiftDate, 1);

  const oStart = new Date(parseWallClock(`${openShiftDate}T${openStartHHMM}`, tz)).getTime();
  const oEnd = new Date(parseWallClock(`${openEndDate}T${openEndHHMM}`, tz)).getTime();

  return employeeShifts.some((s) => {
    if (s.status === 'cancelled') return false;
    const sStart = new Date(s.start_time).getTime();
    const sEnd = new Date(s.end_time).getTime();
    return sStart < oEnd && sEnd > oStart;
  });
}
