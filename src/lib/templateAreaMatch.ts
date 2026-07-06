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
