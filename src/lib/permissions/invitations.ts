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

/**
 * Whether `inviter` may change anyone's role at all — the gate for showing a
 * role picker rather than a plain label.
 *
 * Derived from the two structures above rather than re-listing the roles that
 * can assign, so it cannot drift from them: a role with nowhere to assign is a
 * role that `assign_membership_role` would refuse for every target it was
 * offered (rule 6, 20260802110000_assign_membership_role.sql:188). Showing that
 * caller a live picker buys them a 42501 for every choice.
 *
 * This is a reachable state, not a hypothetical one: `App.tsx`'s
 * `StaffRoleChecker` keeps staff, kiosk and collaborators off /team, but a chef
 * walks straight in.
 */
export function canAssignAnyRole(inviter: Role): boolean {
  return getInvitableRoles(inviter).length > 0 || canInviteCustomRole(inviter);
}

/**
 * Whether `inviter` may put someone into ONE specific role — the gate for an
 * "Assign people to this role" action, which names its target up front.
 *
 * `canAssignAnyRole` cannot answer this: it asks whether the caller has any
 * target at all, so it says yes to an operations_manager (who may assign only
 * `staff`) standing in front of a custom role, and to a manager standing in
 * front of Owner. Both would get a 42501 on every person they picked.
 *
 * `targetLegacyRole` is the `roles.legacy_role` column: the builtin role string
 * for a builtin row, NULL for a custom one — the same discriminator
 * `RolePicker` uses to decide what to send. The two branches mirror
 * `assign_membership_role`'s rule 6 exactly
 * (20260802110000_assign_membership_role.sql:158-190): custom roles are gated
 * by `can_invite_custom_role`, builtins by membership in `invitable_roles`.
 *
 * A consequence worth stating: nobody can assign `kiosk`, because it is in no
 * inviter's row. That is the server's answer too — a kiosk is provisioned from
 * device setup, not handed to a person.
 */
export function canAssignTargetRole(inviter: Role, targetLegacyRole: string | null): boolean {
  return targetLegacyRole === null
    ? canInviteCustomRole(inviter)
    : canInviteRole(inviter, targetLegacyRole as Role);
}
