import type { Employee } from '@/types/scheduling';

export type GroupByMode = 'none' | 'area' | 'position';

export interface EmployeeGroup {
  label: string;
  employees: Employee[];
}

// Internal key for employees without an area/position value.
// Empty string can't collide with user-created values (area field is trimmed on save).
const UNASSIGNED_KEY = '';
export const UNASSIGNED_LABEL = 'Unassigned';

/**
 * Groups employees by the specified mode.
 * Returns an array of groups, each with a label and list of employees.
 * When mode is 'none', returns a single group with all employees.
 * Groups are sorted alphabetically, with unassigned employees last.
 * Employees within each group are sorted by name.
 */
export function groupEmployees(
  employees: Employee[],
  mode: GroupByMode
): EmployeeGroup[] {
  if (mode === 'none') {
    return [{
      label: '',
      employees: [...employees].sort((a, b) => a.name.localeCompare(b.name)),
    }];
  }

  const groupMap = new Map<string, Employee[]>();

  for (const emp of employees) {
    const raw = (mode === 'area' ? emp.area : emp.position) || '';
    const key = raw.trim() || UNASSIGNED_KEY;
    const group = groupMap.get(key);
    if (group) {
      group.push(emp);
    } else {
      groupMap.set(key, [emp]);
    }
  }

  // Sort groups: alphabetical, unassigned last
  const sortedKeys = Array.from(groupMap.keys()).sort((a, b) => {
    if (a === UNASSIGNED_KEY) return 1;
    if (b === UNASSIGNED_KEY) return -1;
    return a.localeCompare(b);
  });

  return sortedKeys.map((key) => ({
    label: key || UNASSIGNED_LABEL,
    employees: groupMap.get(key)!.sort((a, b) => a.name.localeCompare(b.name)),
  }));
}
