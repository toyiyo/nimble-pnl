/**
 * employeeRanking — pure sort helper for the Timeline shift editor's employee
 * picker. Prioritizes employees whose `area`/`position` matches the shift's
 * lane context, so the most relevant candidates surface at the top of the
 * `Select` list without filtering anyone out.
 */
import type { Employee } from '@/types/scheduling';

export interface ShiftRankingContext {
  /** The shift/lane's position (e.g. from a position-grouped lane or the form's position field). */
  position?: string | null;
  /** The shift/lane's area (e.g. from an area-grouped lane). */
  area?: string | null;
}

function matchesCaseInsensitive(value: string | null | undefined, target: string): boolean {
  return !!value && value.trim().toLowerCase() === target.trim().toLowerCase();
}

/**
 * Score when BOTH area and position context are supplied: area match ranks
 * above a position-only match. Extracted so `rankScore` stays within Sonar's
 * cognitive-complexity budget.
 */
function scoreBothContext(areaMatch: boolean, positionMatch: boolean): number {
  if (areaMatch && positionMatch) return 0;
  if (areaMatch) return 1;
  if (positionMatch) return 2;
  return 3;
}

/**
 * Rank a score for sort ordering: lower sorts first.
 * 0 = matches both area and position (when both context values are given)
 * 1 = matches area only (area context takes priority over position)
 * 2 = matches position only
 * 3 = matches neither
 */
function rankScore(employee: Employee, context: ShiftRankingContext): number {
  const areaMatch = context.area ? matchesCaseInsensitive(employee.area, context.area) : false;
  const positionMatch = context.position
    ? matchesCaseInsensitive(employee.position, context.position)
    : false;

  if (context.area && context.position) return scoreBothContext(areaMatch, positionMatch);
  if (context.area) return areaMatch ? 0 : 1;
  if (context.position) return positionMatch ? 0 : 1;
  return 0;
}

/**
 * Sort employees so the ones matching the shift's lane context (position
 * and/or area) come first. Stable — employees within the same rank keep
 * their original relative order. Never mutates the input array.
 */
export function rankEmployeesForShift(
  employees: Employee[],
  context: ShiftRankingContext,
): Employee[] {
  return employees
    .map((employee, index) => ({ employee, index, score: rankScore(employee, context) }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.employee);
}
