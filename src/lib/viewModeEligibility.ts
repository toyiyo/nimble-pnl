import type { Role } from '@/lib/permissions/types';

/**
 * Eligibility rule for the Admin ↔ My Work view-mode switch.
 *
 * canUseWorkView = !!currentEmployee && role ∉ { staff, kiosk, collaborator_* }
 *
 * `staff`/`kiosk` already live in the employee/kiosk experience — no switch
 * needed. `collaborator_*` are external scoped roles that must never see
 * employee self-service. See
 * docs/superpowers/specs/2026-07-24-admin-work-view-mode-design.md
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
  if (role.startsWith('collaborator_')) return false;
  return true;
}
