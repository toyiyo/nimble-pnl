/**
 * Shared area-matching rules for bucketing an unlinked shift (no
 * shift_template_id) into a template row. Used by both the on-screen planner
 * grid (useShiftPlanner.ts) and the PDF/CSV export (plannerExport.ts) so the
 * two never diverge — a cross-area shift must land in the same place in both.
 */

/**
 * A template with an area only matches an employee from the same area; a null
 * area on either side is permissive (legacy data without areas keeps matching).
 */
export function isAreaCompatible(
  templateArea: string | null | undefined,
  employeeArea: string | null | undefined,
): boolean {
  return !templateArea || !employeeArea || templateArea === employeeArea;
}

/**
 * From candidates already filtered to area-compatible templates, prefer an
 * exact same-area match over an area-agnostic (null-area) one; otherwise return
 * the first candidate. When the employee has no area there is nothing to
 * prefer, so input order is preserved.
 */
export function pickAreaPreferredMatch<T extends { area?: string | null }>(
  candidates: T[],
  employeeArea: string | null | undefined,
): T | undefined {
  if (!employeeArea) return candidates[0];
  return candidates.find((t) => t.area === employeeArea) ?? candidates[0];
}

/** The fields that identify which template an unlinked shift buckets under. */
export interface ShiftMatchKey {
  /** Local HH:MM:SS start, matched exactly against template.start_time. */
  shiftStart: string;
  /** Local HH:MM:SS end, matched exactly against template.end_time. */
  shiftEnd: string;
  position: string;
  /** 0 (Sun) – 6 (Sat), matched against template.days. */
  dayOfWeek: number;
  employeeArea: string | null;
}

/** A template shape the area-aware matcher can select over. */
export interface MatchableTemplate {
  start_time: string;
  end_time: string;
  position: string;
  days: number[];
  area?: string | null;
}

/**
 * Select the template an unlinked shift buckets under: filter templates by exact
 * start/end/position/active-day plus area compatibility, then prefer an exact
 * same-area match over an area-agnostic one. This is the single source of truth
 * shared by the planner grid (useShiftPlanner) and the export (plannerExport) so
 * the two matchers can never drift.
 */
export function findAreaAwareTemplate<T extends MatchableTemplate>(
  templates: T[],
  key: ShiftMatchKey,
): T | undefined {
  const candidates = templates.filter(
    (t) =>
      t.start_time === key.shiftStart &&
      t.end_time === key.shiftEnd &&
      t.position === key.position &&
      t.days.includes(key.dayOfWeek) &&
      isAreaCompatible(t.area, key.employeeArea),
  );
  return pickAreaPreferredMatch(candidates, key.employeeArea);
}
