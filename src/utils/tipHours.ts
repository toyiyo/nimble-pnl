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
