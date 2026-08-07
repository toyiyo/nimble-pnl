import type { Role } from '@/lib/permissions/types';

/**
 * Eligibility rule for the Admin ↔ My Work view-mode switch.
 *
 * canUseWorkView = !!currentEmployee && role ∉ { staff, kiosk }
 *
 * `staff`/`kiosk` already live in the employee/kiosk experience — no switch
 * needed. Collaborators (`collaborator_*`) are scoped admin roles, not
 * external users — a collaborator who is also linked to an employee record
 * is eligible for work view like any other admin role. See
 * docs/superpowers/specs/2026-08-02-collaborator-work-view-design.md
 */

const INELIGIBLE_ROLES: ReadonlySet<Role> = new Set<Role>(['staff', 'kiosk']);

export interface ComputeCanUseWorkViewParams {
  /** Employee record linked to the current user, or null/undefined if none. */
  currentEmployee: unknown | null | undefined;
  role: Role | undefined;
}

export function computeCanUseWorkView({
  currentEmployee,
  role,
}: ComputeCanUseWorkViewParams): boolean {
  if (!currentEmployee || !role) return false;
  if (INELIGIBLE_ROLES.has(role)) return false;
  return true;
}
