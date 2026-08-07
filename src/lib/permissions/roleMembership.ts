import type { RestaurantMember } from '@/hooks/useRestaurantMembers';
import type { RoleWithGrants } from '@/hooks/useRoles';
import type { Role } from '@/lib/permissions/types';

/**
 * Which role a membership belongs to, resolved the way the database resolves
 * it.
 *
 * `role_member_counts` (20260730200000_role_member_counts.sql:36-46) buckets a
 * membership by `COALESCE(ur.role_id, builtin_role_id_for(ur.role))` and drops
 * the row when that is NULL. A role card prints the count that RPC returns and
 * opens a roster built here, so any disagreement between the two shows up as a
 * card that says "3 people" above a list of two.
 *
 * That migration also warns (lines 18-21) that resolving the legacy string in
 * TypeScript "would be the copy that drifts". This is not that copy.
 * `roles.legacy_role` (20260802100000_roles_legacy_role.sql) is the mapping
 * itself, exposed as a column: it was backfilled *through* `builtin_role_id_for`
 * (line 44), so it cannot hold a pair the function disagrees with, and a unique
 * partial index (line 51) plus a builtin-only CHECK (lines 54-55) keep it that
 * way. `RolePicker.tsx:113` already reads it the same way. What follows is a
 * lookup in that data, not a second listing of the pairs.
 */

/**
 * Builtin role string -> roles row id.
 *
 * Only builtin rows appear: `legacy_role` is NULL for every custom role, which
 * has no legacy string to be found by — every custom role shares the bare
 * 'collaborator_custom' literal and is told apart by id alone.
 *
 * Built once per render and passed down, rather than rebuilt per card.
 */
export function legacyRoleIndex(roles: readonly RoleWithGrants[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const role of roles) {
    if (role.legacy_role !== null) index.set(role.legacy_role, role.id);
  }
  return index;
}

/**
 * The roles row this membership counts towards, or null when it counts towards
 * none — the client-side twin of the COALESCE above.
 *
 * Null is the ordinary answer for a `collaborator_custom` membership whose
 * `role_id` was never written: no roles row carries that legacy string, just as
 * `builtin_role_id_for` returns NULL for it. Such a row has no card to sit on.
 */
export function resolveMembershipRoleId(
  member: Pick<RestaurantMember, 'role' | 'roleId'>,
  byLegacy: ReadonlyMap<string, string>
): string | null {
  return member.roleId ?? byLegacy.get(member.role) ?? null;
}

/** Everyone in `members` whose membership resolves to `roleId`. */
export function membersInRole(
  members: readonly RestaurantMember[],
  roleId: string,
  byLegacy: ReadonlyMap<string, string>
): RestaurantMember[] {
  return members.filter((m) => resolveMembershipRoleId(m, byLegacy) === roleId);
}

/**
 * Every member bucketed by resolved role, in one pass.
 *
 * The roles grid needs a roster per card; calling `membersInRole` once per card
 * would walk the membership list once per role for no reason.
 */
export function groupMembersByRole(
  members: readonly RestaurantMember[],
  byLegacy: ReadonlyMap<string, string>
): Map<string, RestaurantMember[]> {
  const grouped = new Map<string, RestaurantMember[]>();
  for (const member of members) {
    const roleId = resolveMembershipRoleId(member, byLegacy);
    if (roleId === null) continue;
    const list = grouped.get(roleId);
    if (list) list.push(member);
    else grouped.set(roleId, [member]);
  }
  return grouped;
}

/**
 * The roles that `user_is_internal_team` accepts
 * (20260702170000_add_operations_manager_role.sql:27-43).
 *
 * A second copy of a database rule, which the header above warns against —
 * but this one is unavoidable: RLS decides what `useRestaurantMembers`
 * returns, and the UI has to distinguish "this employee has no account" from
 * "you cannot see whether they do". Getting that backwards tells a
 * collaborator_accountant that a fully-provisioned employee cannot sign in.
 * `tests/unit/internalTeamMirror.test.ts` pins the two together.
 */
export const INTERNAL_TEAM_ROLES = [
  'owner',
  'manager',
  'operations_manager',
  'chef',
  'staff',
] as const satisfies readonly Role[];

/** Whether this caller sees every `user_restaurants` row for the restaurant. */
export function isInternalTeamRole(role: Role | null | undefined): boolean {
  return !!role && (INTERNAL_TEAM_ROLES as readonly string[]).includes(role);
}
