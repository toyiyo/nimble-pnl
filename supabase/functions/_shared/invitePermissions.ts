/**
 * Invite matrix for edge functions that accept an invitation.
 *
 * MIRRORS `INVITABLE_ROLES` and `CUSTOM_ROLE_INVITERS` in
 * src/lib/permissions/invitations.ts, and `public.invitable_roles` /
 * `public.can_invite_custom_role` in SQL. tests/unit/inviteMatrixMirror.test.ts
 * keeps the copies equal. Default-deny: a role with no row may invite nothing.
 */
const INVITABLE_ROLES: Record<string, readonly string[]> = {
  owner: [
    'owner', 'manager', 'operations_manager', 'chef', 'staff',
    'collaborator_accountant', 'collaborator_inventory', 'collaborator_chef',
    'collaborator_operations_manager',
  ],
  manager: [
    'manager', 'operations_manager', 'chef', 'staff',
    'collaborator_accountant', 'collaborator_inventory', 'collaborator_chef',
    'collaborator_operations_manager',
  ],
  operations_manager: ['staff'],
};

const CUSTOM_ROLE_INVITERS = ['owner', 'manager'];

const CUSTOM_ROLE = 'collaborator_custom';

/**
 * Whether a member with role `inviterRole` may invite someone as `targetRole`.
 * `inviterRole` is null when the inviter has no membership in the restaurant.
 */
export function inviterMayInvite(
  inviterRole: string | null | undefined,
  targetRole: string,
): boolean {
  if (!inviterRole) return false;
  if (targetRole === CUSTOM_ROLE) return CUSTOM_ROLE_INVITERS.includes(inviterRole);
  return (INVITABLE_ROLES[inviterRole] ?? []).includes(targetRole);
}
