/**
 * Invite matrix — which target roles each inviter role may create.
 *
 * SINGLE SOURCE OF TRUTH for team-invite privilege boundaries.
 * The Deno edge function `send-team-invitation` duplicates this matrix
 * and MUST stay in sync (default-deny).
 */
import type { Role } from './types';

const INVITABLE_ROLES: Record<Role, readonly Role[]> = {
  // owner can invite every internal + collaborator role.
  // 'kiosk' is deliberately absent: it is a shared device credential, not a
  // person with an inbox. Kiosk access is provisioned from device setup.
  owner: [
    'owner', 'manager', 'operations_manager', 'chef', 'staff',
    'collaborator_accountant', 'collaborator_inventory', 'collaborator_chef',
    'collaborator_operations_manager',
  ],
  // manager can invite all except owner; collaborators included (separate CollaboratorInvitations UI)
  manager: [
    'manager', 'operations_manager', 'chef', 'staff',
    'collaborator_accountant', 'collaborator_inventory', 'collaborator_chef',
    'collaborator_operations_manager',
  ],
  operations_manager: ['staff'],
  chef: [],
  staff: [],
  kiosk: [],
  collaborator_accountant: [],
  collaborator_inventory: [],
  collaborator_chef: [],
  collaborator_operations_manager: [],
};

/**
 * Inviters who may invite someone to a *custom* role.
 *
 * Custom roles are not members of `Role` and never will be: `Role` is a closed
 * union of role *strings*, and every custom role shares the one string
 * `'collaborator_custom'` while granting something different. Which areas it
 * grants lives in the `roles` row, so a matrix keyed by role string cannot
 * answer "may this be invited" — only "may this inviter invite custom roles at
 * all". Which specific role they may name is authorized server-side, against
 * the role's own `restaurant_id`.
 *
 * owner and manager, matching who holds `manage:collaborators` and who may
 * invite the four builtin collaborator roles above.
 */
const CUSTOM_ROLE_INVITERS: readonly Role[] = ['owner', 'manager'];

/**
 * The single role string every custom-role membership and invitation carries.
 * MIRRORS `CUSTOM_ROLE` in the `send-team-invitation` edge function.
 *
 * Deliberately not a member of `Role` (see above): which areas it grants lives
 * in the `roles` row named by the accompanying `role_id`, so treating it as a
 * role would let `ROLE_CAPABILITIES` answer a question it cannot.
 */
export const CUSTOM_ROLE = 'collaborator_custom' as const;

/**
 * What may appear in an invitation's `role` column: a real role, or the
 * custom-role pointer. Callers that pass `CUSTOM_ROLE` must also pass the
 * `role_id`; the edge function rejects either one without the other.
 */
export type InviteRoleLiteral = Role | typeof CUSTOM_ROLE;

/**
 * The same domain, for the `role` column of an *accepted* membership
 * (`user_restaurants`) rather than a pending invitation. Aliased rather than
 * reused under the invitation name so a reader of a membership row does not
 * have to reason about invitations to know what the column can hold — and so
 * that typing such a column `Role` stays visibly wrong: a custom-role
 * membership carries `'collaborator_custom'`, which is not a `Role`.
 */
export type MembershipRoleLiteral = InviteRoleLiteral;

/** Roles that `inviter` is allowed to invite (empty if none). */
export function getInvitableRoles(inviter: Role): Role[] {
  return [...(INVITABLE_ROLES[inviter] ?? [])];
}

/** Whether `inviter` may invite a member with role `target`. */
export function canInviteRole(inviter: Role, target: Role): boolean {
  return (INVITABLE_ROLES[inviter] ?? []).includes(target);
}

/**
 * Whether `inviter` may invite someone to a custom role.
 * MIRRORS `canInviteCustomRole` in the `send-team-invitation` edge function.
 */
export function canInviteCustomRole(inviter: Role): boolean {
  return CUSTOM_ROLE_INVITERS.includes(inviter);
}
