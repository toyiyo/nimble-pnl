/**
 * Invite matrix — which target roles each inviter role may create.
 *
 * SINGLE SOURCE OF TRUTH for team-invite privilege boundaries.
 * The Deno edge function `send-team-invitation` duplicates this matrix
 * and MUST stay in sync (default-deny).
 */
import type { Role } from './types';

const INVITABLE_ROLES: Record<Role, readonly Role[]> = {
  // owner can invite every internal + collaborator role
  owner: [
    'owner', 'manager', 'operations_manager', 'chef', 'staff', 'kiosk',
    'collaborator_accountant', 'collaborator_inventory', 'collaborator_chef',
  ],
  // manager can invite all except owner; collaborators included (separate CollaboratorInvitations UI)
  manager: [
    'manager', 'operations_manager', 'chef', 'staff', 'kiosk',
    'collaborator_accountant', 'collaborator_inventory', 'collaborator_chef',
  ],
  operations_manager: ['staff'],
  chef: [],
  staff: [],
  kiosk: [],
  collaborator_accountant: [],
  collaborator_inventory: [],
  collaborator_chef: [],
};

/** Roles that `inviter` is allowed to invite (empty if none). */
export function getInvitableRoles(inviter: Role): Role[] {
  return [...(INVITABLE_ROLES[inviter] ?? [])];
}

/** Whether `inviter` may invite a member with role `target`. */
export function canInviteRole(inviter: Role, target: Role): boolean {
  return (INVITABLE_ROLES[inviter] ?? []).includes(target);
}
