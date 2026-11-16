import type { TimePunch } from '@/types/timeTracking';
import { calculateWorkedHoursForClockInDay } from '@/utils/payrollCalculations';

/**
 * Tip hours state reconciliation.
 *
 * The Tips daily-entry screen derives per-employee hours from time punches, but
 * a manager can also type hours manually. A background query refetch must not
 * clobber those manual edits. An entry is "manual" when its autoCalculated flag
 * is explicitly `false` — set by the hours input's onChange in Tips.tsx.
 */

/**
 * Merge punch-derived hours into the current hours map, preserving any entry the
 * user has manually edited (autoCalculated[id] === false). Entries that are
 * auto-calculated (true) or untracked (undefined) take the punch-derived value.
 *
 * Pure: does not mutate its arguments.
 */
export function mergeManualHours(
  punchDerived: Record<string, string>,
  prev: Record<string, string>,
  autoCalculated: Record<string, boolean>,
): Record<string, string> {
  const merged: Record<string, string> = { ...punchDerived };
  for (const empId of Object.keys(prev)) {
    if (autoCalculated[empId] === false) {
      merged[empId] = prev[empId]; // user-typed — never overwrite
    }
  }
  return merged;
}

/**
 * Hours worked per employee for one service day, as the string the hours input
 * holds (rounded to one decimal place).
 *
 * This is the ONE punch-to-hours rule for the Tips daily entry. The bootstrap
 * effect, the refresh effect, and the "Recalculate from punches" button all use
 * it, so they cannot write different values to the same field. Hours go to the
 * clock-in day, so a shift that crosses midnight counts once, on the night it
 * began. The order of `punches` does not matter.
 *
 * An employee with no punches in `punches` is omitted from the result.
 */
export function hoursFromPunches(
  employeeIds: readonly string[],
  punches: readonly TimePunch[],
  dayStart: Date,
  dayEnd: Date,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const id of employeeIds) {
    const employeePunches = punches.filter(p => p.employee_id === id);
    if (employeePunches.length === 0) continue;
    const hours = calculateWorkedHoursForClockInDay(employeePunches, dayStart, dayEnd);
    result[id] = (Math.round(hours * 10) / 10).toString();
  }
  return result;
}
