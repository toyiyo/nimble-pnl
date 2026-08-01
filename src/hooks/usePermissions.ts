/**
 * usePermissions Hook
 *
 * Central hook for permission checking throughout the application.
 *
 * Data-driven roles (roles-and-areas design, Phase 4 task 8): when the
 * current membership's `selectedRestaurant.roleRecord` is populated (a
 * joined `roles` row with its `role_areas`/`role_flags`, embedded by
 * `useRestaurants.tsx`), capabilities are derived from those embedded grants
 * via `expandAreas()` — this is what lets a user-named custom role resolve
 * correctly, since it has no entry in the legacy `ROLE_CAPABILITIES` table.
 * `ROLE_CAPABILITIES[role]` remains the fallback for memberships that
 * haven't been migrated onto `role_id` yet (`roleRecord` is `null`), so the
 * legacy string-role behavior this hook has always had is unchanged for
 * them — see `tests/unit/usePermissions.test.tsx`.
 *
 * Usage:
 * ```typescript
 * const { hasCapability, isCollaborator, landingPath, isResolved } = usePermissions();
 *
 * if (!isResolved) return <Skeleton />;
 * if (hasCapability('view:transactions')) {
 *   // Show transactions UI
 * }
 *
 * if (isCollaborator) {
 *   // Hide team-related UI
 * }
 * ```
 */

import { useMemo } from 'react';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { Role, Capability } from '@/lib/permissions/types';
import {
  ROLE_METADATA,
  isCollaboratorRole,
} from '@/lib/permissions/definitions';
import { grantMap, resolveLandingPath } from '@/lib/permissions/areas';
import { membershipCapabilities } from '@/lib/permissions/membershipCapabilities';
import { customCollaboratorRoutes } from '@/lib/permissions/routeAreas';

export interface PermissionContext {
  /** Current user's role, or null if not loaded */
  role: Role | null;

  /** All capabilities for the current role */
  capabilities: readonly Capability[];

  /** Check if user has a specific capability */
  hasCapability: (capability: Capability) => boolean;

  /** Check if user has ANY of the specified capabilities */
  hasAnyCapability: (capabilities: Capability[]) => boolean;

  /** Check if user has ALL of the specified capabilities */
  hasAllCapabilities: (capabilities: Capability[]) => boolean;

  /** Whether current user is a collaborator (external specialist) */
  isCollaborator: boolean;

  /** Whether current user is internal team (not collaborator, not kiosk) */
  isInternalTeam: boolean;

  /** Whether current user is staff (employee self-service) */
  isStaff: boolean;

  /** Whether current user is kiosk */
  isKiosk: boolean;

  /** Whether user can manage team members */
  canManageTeam: boolean;

  /** Whether user can manage collaborators */
  canManageCollaborators: boolean;

  /** The default landing path for this role */
  landingPath: string;

  /** Human-readable role label */
  roleLabel: string;

  /** Badge color for the role */
  roleColor: 'default' | 'secondary' | 'outline' | 'destructive';

  /**
   * Whether the role has actually finished resolving (sourced from
   * `RestaurantContext`'s `loading`). While `false`, the three sensitive
   * flags (`view:costs`, `view:pay_rates`, `view:employee_pii`) are forced
   * off even if the incoming role would otherwise grant them.
   */
  isResolved: boolean;
}

/**
 * Hook to access permission context for the current user
 */
export function usePermissions(): PermissionContext {
  const { selectedRestaurant, loading } = useRestaurantContext();
  const role = (selectedRestaurant?.role as Role) ?? null;
  const roleRecord = selectedRestaurant?.roleRecord ?? null;
  const isResolved = !loading;

  return useMemo(() => {
    // No role means no permissions
    if (!role) {
      return {
        role: null,
        capabilities: [],
        hasCapability: () => false,
        hasAnyCapability: () => false,
        hasAllCapabilities: () => false,
        isCollaborator: false,
        isInternalTeam: false,
        isStaff: false,
        isKiosk: false,
        canManageTeam: false,
        canManageCollaborators: false,
        landingPath: '/auth',
        roleLabel: 'Unknown',
        roleColor: 'outline' as const,
        isResolved,
      };
    }

    let capabilities: Capability[];
    let isCollaborator: boolean;
    let landingPath: string;
    let roleLabel: string;
    let roleColor: 'default' | 'secondary' | 'outline' | 'destructive';

    if (roleRecord) {
      // Data-driven path: resolve capabilities from the embedded area
      // grants rather than the legacy ROLE_CAPABILITIES lookup, so a
      // user-named custom role (which has no ROLE_CAPABILITIES entry at
      // all) resolves correctly too.
      const grants = grantMap(roleRecord.role_areas);
      // Sensitive flags are gated behind isResolved regardless of what the
      // role would otherwise grant.
      capabilities = membershipCapabilities(role, roleRecord, {
        includeSensitiveFlags: isResolved,
      });

      isCollaborator = roleRecord.flavor === 'collaborator';

      if (roleRecord.builtin) {
        // The six builtins keep their hand-written landing paths. Deriving
        // theirs from areas would move them: collaborator_chef holds
        // inventory:view alongside recipes:manage, and inventory outranks
        // recipes in AREA_PRIORITY, so a pure derivation lands the Recipe
        // Consultant on /inventory.
        landingPath = ROLE_METADATA[role]?.landingPath ?? '/';
      } else if (isCollaborator) {
        // Derived from the *route-eligible* areas, so the landing is never a
        // page StaffRoleChecker would bounce this role straight off — the
        // P&L surfaces being the case that bites (`reports` is the
        // highest-priority area and reaches neither of its pages).
        landingPath = customCollaboratorRoutes(grants).landing;
      } else {
        landingPath = resolveLandingPath(grants) ?? ROLE_METADATA[role]?.landingPath ?? '/';
      }
      roleLabel = roleRecord.name;
      roleColor = ROLE_METADATA[role]?.color ?? 'outline';
    } else {
      // Legacy path: unmigrated membership, no roleRecord yet. Unchanged
      // from before this task.
      capabilities = membershipCapabilities(role, null);
      isCollaborator = isCollaboratorRole(role);
      landingPath = ROLE_METADATA[role]?.landingPath ?? '/';
      roleLabel = ROLE_METADATA[role]?.label ?? role;
      roleColor = ROLE_METADATA[role]?.color ?? 'outline';
    }

    const capabilitySet = new Set(capabilities);

    return {
      role,
      capabilities,

      hasCapability: (cap: Capability) => capabilitySet.has(cap),

      hasAnyCapability: (caps: Capability[]) =>
        caps.some((cap) => capabilitySet.has(cap)),

      hasAllCapabilities: (caps: Capability[]) =>
        caps.every((cap) => capabilitySet.has(cap)),

      isCollaborator,
      isInternalTeam: !isCollaborator && role !== 'kiosk' && role !== 'staff',
      isStaff: role === 'staff',
      isKiosk: role === 'kiosk',

      canManageTeam: capabilitySet.has('manage:team'),
      canManageCollaborators: capabilitySet.has('manage:collaborators'),

      landingPath,
      roleLabel,
      roleColor,
      isResolved,
    };
  }, [role, roleRecord, isResolved]);
}
