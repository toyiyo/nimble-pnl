/**
 * Permissions Module
 *
 * Centralized permission system for role-based access control.
 *
 * Usage:
 * ```typescript
 * import { usePermissions } from '@/hooks/usePermissions';
 * import { COLLABORATOR_PRESETS, isCollaboratorRole } from '@/lib/permissions';
 *
 * // In components:
 * const { hasCapability, isCollaborator } = usePermissions();
 * if (hasCapability('view:transactions')) {
 *   // Show transactions UI
 * }
 * ```
 */

// Types
export type { Role, Capability, RoleCategory, RoleMetadata, CollaboratorPreset } from './types';

// Definitions
export {
  ROLE_CAPABILITIES,
  ROLE_METADATA,
  COLLABORATOR_PRESETS,
  isCollaboratorRole,
  getCollaboratorRoles,
  getInternalRoles,
  getLandingPath,
} from './definitions';
