/**
 * "Alex" or "Alex and Sam" — shared by PublishedShiftChangeDialog and
 * usePublishedShiftGuard's notify toast. Lives outside the component file
 * so the file exports only a component (react-refresh/only-export-components).
 */
export function formatNamesLabel(employeeName: string, secondEmployeeName?: string): string {
  return secondEmployeeName ? `${employeeName} and ${secondEmployeeName}` : employeeName;
}
