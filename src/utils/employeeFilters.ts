/**
 * Employee filtering utility functions
 * Shared utilities for filtering and managing employee activation status
 */

import type { EmployeeStatus } from '@/types/scheduling';

/**
 * Single source of truth for the is_active ↔ status invariant enforced by the
 * DB check constraint `employees_status_active_sync`.
 *   active → is_active = true
 *   inactive | terminated → is_active = false
 */
export function isActiveForStatus(status: EmployeeStatus): boolean {
  return status === 'active';
}

interface EmployeeWithActivation {
  is_active: boolean;
  status: string;
  deactivated_at?: string | null;
}

/**
 * Filter employees to only include active ones
 */
export function filterActiveEmployees<T extends EmployeeWithActivation>(
  employees: T[]
): T[] {
  return employees.filter((e) => e.is_active);
}

/**
 * Filter employees to only include inactive ones
 */
export function filterInactiveEmployees<T extends EmployeeWithActivation>(
  employees: T[]
): T[] {
  return employees.filter((e) => !e.is_active);
}

/**
 * Get formatted last active date from deactivated_at field
 * Returns null if no deactivation date exists
 */
export function getLastActiveDate(
  employee: Pick<EmployeeWithActivation, 'deactivated_at'>
): string | null {
  if (!employee.deactivated_at) return null;
  return new Date(employee.deactivated_at).toLocaleDateString();
}

/**
 * Determine if an employee can be reactivated
 * Only inactive (not terminated) employees can be reactivated
 */
export function canReactivate(
  employee: Pick<EmployeeWithActivation, 'is_active' | 'status'>
): boolean {
  return !employee.is_active && employee.status === 'inactive';
}
