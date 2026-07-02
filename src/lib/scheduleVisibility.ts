import type { Employee, Shift } from '@/types/scheduling';

/** Build set of employee IDs who have at least one non-cancelled shift.
 *  Cancelled shifts should not keep inactive employees visible in the grid. */
export function buildActiveShiftEmployeeIds(
  shifts: { employee_id: string; status: string }[],
): Set<string> {
  return new Set(
    shifts.filter(s => s.status !== 'cancelled').map(s => s.employee_id)
  );
}

/** Filter employees for the weekly schedule grid:
 *  - Active employees always shown (so managers can schedule them)
 *  - Inactive employees shown only if they have shifts this week */
export function filterEmployeesForScheduleView(
  allEmployees: Employee[],
  shiftEmployeeIds: Set<string>,
  positionFilter: string | null,
  areaFilter: string | null,
): Employee[] {
  return allEmployees
    .filter(emp => emp.is_active || shiftEmployeeIds.has(emp.id))
    .filter(emp => !areaFilter || areaFilter === 'all' || emp.area === areaFilter)
    .filter(emp => !positionFilter || positionFilter === 'all' || emp.position === positionFilter);
}

/**
 * Restrict export/print inputs to what the on-screen schedule grid shows.
 *
 * - Strips cancelled shifts (a cancelled shift is not a real scheduled shift
 *   and must not appear on a printed roster).
 * - Keeps an employee iff they are active OR they still have a non-cancelled
 *   shift — the same predicate the grid applies via
 *   `filterEmployeesForScheduleView`, minus position/area filtering (the export
 *   dialog applies position/area on top of this).
 *
 * Pass the RAW (un-position/area-filtered) shifts + employees: the live-shift
 * id set must be computed from the full shift list, mirroring how the grid
 * derives it before applying position/area to the employee list.
 */
export function selectVisibleRosterInputs(
  shifts: Shift[],
  employees: Employee[],
): { shifts: Shift[]; employees: Employee[] } {
  const liveShifts = shifts.filter(s => s.status !== 'cancelled');
  const liveShiftEmployeeIds = new Set(liveShifts.map(s => s.employee_id));
  return {
    shifts: liveShifts,
    employees: filterEmployeesForScheduleView(employees, liveShiftEmployeeIds, null, null),
  };
}
