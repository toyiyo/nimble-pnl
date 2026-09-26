import type { LaborShift } from './types.ts';

/**
 * Net scheduled hours for a shift (break excluded), clamped to >= 0.
 * Canonical home for this helper; re-exported from `src/lib/scheduleRoster.ts`
 * and `src/utils/scheduleExport.ts` for backward compatibility.
 *
 * `break_duration` is coerced to a non-negative number first. It may be null at
 * runtime (the DB column defaults to 0 but has no NOT NULL constraint) — a null
 * would make `totalMinutes - break_duration` NaN — and a malformed negative
 * value would *add* paid time (subtracting a negative). Both would poison every
 * labor-cost total that sums these hours, so we clamp the break to `>= 0`.
 */
export const calculateShiftHours = (shift: LaborShift): number => {
  const start = new Date(shift.start_time);
  const end = new Date(shift.end_time);
  const totalMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
  const breakMinutes = Math.max(shift.break_duration ?? 0, 0);
  const netMinutes = Math.max(totalMinutes - breakMinutes, 0);
  return netMinutes / 60;
};
