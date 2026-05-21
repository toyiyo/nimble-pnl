import { useMemo } from 'react';
import type { EmployeeAvailability, Employee } from '@/types/scheduling';

type EmployeeLite = Pick<Employee, 'id' | 'name' | 'status'>;

export function useEmployeesMissingAvailability<T extends EmployeeLite>(
  employees: T[],
  availability: EmployeeAvailability[],
): T[] {
  return useMemo(() => {
    const haveAvailability = new Set<string>();
    for (const row of availability) {
      haveAvailability.add(row.employee_id);
    }
    return employees.filter(
      (e) => e.status === 'active' && !haveAvailability.has(e.id),
    );
  }, [employees, availability]);
}
