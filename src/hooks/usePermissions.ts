/**
 * usePermissions Hook
 *
 * Central hook for permission checking throughout the application.
 * Uses the ROLE_CAPABILITIES definitions as the source of truth.
 *
 * Usage:
 * ```typescript
 * const { hasCapability, isCollaborator, landingPath } = usePermissions();
 *
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
  ROLE_CAPABILITIES,
  ROLE_METADATA,
  isCollaboratorRole,
} from '@/lib/permissions/definitions';

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
}

/**
 * Hook to access permission context for the current user
 */
export function usePermissions(): PermissionContext {
  const { selectedRestaurant } = useRestaurantContext();
  const role = (selectedRestaurant?.role as Role) ?? null;

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
        roleColor: 'outline',
      };
    }

    const capabilities = ROLE_CAPABILITIES[role] ?? [];
    const metadata = ROLE_METADATA[role];
    const capabilitySet = new Set(capabilities);

    return {
      role,
      capabilities,

      hasCapability: (cap: Capability) => capabilitySet.has(cap),

      hasAnyCapability: (caps: Capability[]) =>
        caps.some((cap) => capabilitySet.has(cap)),

      hasAllCapabilities: (caps: Capability[]) =>
        caps.every((cap) => capabilitySet.has(cap)),

      isCollaborator: isCollaboratorRole(role),
      isInternalTeam: !isCollaboratorRole(role) && role !== 'kiosk' && role !== 'staff',
      isStaff: role === 'staff',
      isKiosk: role === 'kiosk',

      canManageTeam: capabilitySet.has('manage:team'),
      canManageCollaborators: capabilitySet.has('manage:collaborators'),

      landingPath: metadata?.landingPath ?? '/',
      roleLabel: metadata?.label ?? role,
      roleColor: metadata?.color ?? 'outline',
    };
  }, [role]);
}
