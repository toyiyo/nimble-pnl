/**
 * What one membership can do — the capability resolution `usePermissions`
 * performs for the *selected* restaurant, extracted so it can be asked about
 * any membership the caller holds.
 *
 * The caller that forced this out of the hook is the role editor's "copy to
 * other restaurants" picker. `copy_role_to_restaurants` authorizes every
 * target before inserting anywhere and aborts the whole call if one fails, so
 * offering a restaurant where the caller lacks `manage:collaborators` does not
 * degrade to a partial copy — it fails the entire operation, including the
 * targets that were fine. The picker therefore has to answer the capability
 * question for restaurants other than the selected one, which the hook cannot
 * do.
 *
 * Extracted rather than reimplemented: a second copy of "roleRecord if present,
 * else the legacy table" is a copy that drifts, and the direction it drifts in
 * is offering a target the RPC will reject.
 */
import { expandAreas, grantMap } from './areas';
import type { AreaKey, AreaLevel, SensitiveFlag } from './areas';
import { ROLE_CAPABILITIES } from './definitions';
import type { Capability, Role } from './types';

/**
 * The shape this needs off a membership's joined `roles` row. Structural on
 * purpose — `RoleRecord` in useRestaurants.tsx satisfies it without this
 * module having to import a hook's types.
 */
export interface MembershipRoleRecord {
  role_areas: ReadonlyArray<{ area_key: AreaKey; level: AreaLevel }>;
  role_flags: ReadonlyArray<{ flag: SensitiveFlag }>;
}

export interface MembershipCapabilityOptions {
  /**
   * usePermissions passes false while the restaurant list is still loading:
   * the sensitive-data flags are withheld until the membership is known to be
   * resolved, so a half-loaded state cannot briefly reveal costs or pay rates.
   * Callers asking a plain structural question ("may they manage
   * collaborators there") leave this at its default.
   */
  includeSensitiveFlags?: boolean;
}

/**
 * Capabilities for a membership, from its area grants when the `roles` row is
 * embedded and from the legacy per-role table when it is not.
 *
 * The legacy branch is not dead code: a membership written before the role_id
 * backfill has no `roles` row joined to it, and a custom role has no
 * ROLE_CAPABILITIES entry at all — which is why the data-driven branch has to
 * come first rather than being a fallback.
 */
export function membershipCapabilities(
  role: Role,
  roleRecord: MembershipRoleRecord | null | undefined,
  { includeSensitiveFlags = true }: MembershipCapabilityOptions = {}
): Capability[] {
  if (roleRecord) {
    const grants = grantMap(roleRecord.role_areas);
    const flags = includeSensitiveFlags ? roleRecord.role_flags.map((f) => f.flag) : [];
    return expandAreas(grants, flags);
  }
  return [...(ROLE_CAPABILITIES[role] ?? [])];
}
