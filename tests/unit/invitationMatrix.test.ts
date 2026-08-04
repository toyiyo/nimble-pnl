import { describe, it, expect } from 'vitest';
import {
  canAssignAnyRole,
  canAssignTargetRole,
  canInviteRole,
  canInviteCustomRole,
  getInvitableRoles,
} from '@/lib/permissions/invitations';
import type { Role } from '@/lib/permissions/types';

describe('invite matrix', () => {
  it('operations_manager can invite only staff', () => {
    expect(getInvitableRoles('operations_manager')).toEqual(['staff']);
    expect(canInviteRole('operations_manager', 'staff')).toBe(true);
    for (const t of ['manager', 'owner', 'chef', 'operations_manager'] as const) {
      expect(canInviteRole('operations_manager', t)).toBe(false);
    }
  });

  it('owner and manager can invite operations_manager', () => {
    expect(canInviteRole('owner', 'operations_manager')).toBe(true);
    expect(canInviteRole('manager', 'operations_manager')).toBe(true);
  });

  it('owner can invite owner; manager cannot invite owner', () => {
    expect(canInviteRole('owner', 'owner')).toBe(true);
    expect(canInviteRole('manager', 'owner')).toBe(false);
  });

  it('owner and manager can invite collaborator roles, but never kiosk', () => {
    for (const target of ['collaborator_accountant', 'collaborator_inventory', 'collaborator_chef'] as const) {
      expect(canInviteRole('owner', target)).toBe(true);
      expect(canInviteRole('manager', target)).toBe(true);
    }
    expect(canInviteRole('owner', 'kiosk')).toBe(false);
    expect(canInviteRole('manager', 'kiosk')).toBe(false);
  });

  it('operations_manager cannot invite kiosk or collaborator roles', () => {
    for (const target of ['kiosk', 'collaborator_accountant', 'collaborator_inventory', 'collaborator_chef'] as const) {
      expect(canInviteRole('operations_manager', target)).toBe(false);
    }
  });

  it('non-management roles can invite nobody', () => {
    for (const r of ['chef', 'staff', 'kiosk', 'collaborator_accountant'] as const) {
      expect(getInvitableRoles(r)).toEqual([]);
    }
  });

  it('getInvitableRoles returns empty array for unknown role (fallback branch)', () => {
    // Force an unknown role via type assertion to exercise the ?? [] fallback branch
    expect(getInvitableRoles('unknown_role' as unknown as import('@/lib/permissions/types').Role)).toEqual([]);
  });

  it('canInviteRole returns false for unknown inviter (fallback branch)', () => {
    // Force an unknown role via type assertion to exercise the ?? [] fallback branch
    expect(canInviteRole('unknown_role' as unknown as import('@/lib/permissions/types').Role, 'staff')).toBe(false);
  });

  it('owner and manager can invite the operations manager collaborator', () => {
    expect(canInviteRole('owner', 'collaborator_operations_manager')).toBe(true);
    expect(canInviteRole('manager', 'collaborator_operations_manager')).toBe(true);
  });

  it('operations manager collaborator can invite nobody', () => {
    expect(getInvitableRoles('collaborator_operations_manager')).toEqual([]);
  });
});

const ASSIGNERS: readonly Role[] = ['owner', 'manager', 'operations_manager'];
const NON_ASSIGNERS: readonly Role[] = [
  'chef',
  'staff',
  'kiosk',
  'collaborator_accountant',
  'collaborator_inventory',
  'collaborator_chef',
  'collaborator_operations_manager',
];

/** Every builtin role a `roles.legacy_role` column can hold. */
const BUILTIN_TARGETS: readonly Role[] = [...ASSIGNERS, ...NON_ASSIGNERS];

describe('canAssignAnyRole', () => {
  it('is true for exactly the roles with somewhere to assign', () => {
    for (const r of ASSIGNERS) expect(canAssignAnyRole(r)).toBe(true);
    for (const r of NON_ASSIGNERS) expect(canAssignAnyRole(r)).toBe(false);
  });

  it('agrees with the matrix it is derived from, role by role', () => {
    // The point of deriving rather than re-listing: no role may be shown a
    // live role picker that assign_membership_role would then refuse. A chef
    // reaches /team (App.tsx gates only staff, kiosk and collaborators), so
    // this is a reachable state, not a hypothetical one.
    for (const r of [...ASSIGNERS, ...NON_ASSIGNERS]) {
      const hasSomeTarget = getInvitableRoles(r).length > 0 || canInviteCustomRole(r);
      expect(canAssignAnyRole(r)).toBe(hasSomeTarget);
    }
  });

  it('is false for an unrecognised role', () => {
    expect(canAssignAnyRole('unknown_role' as unknown as Role)).toBe(false);
  });
});

describe('canAssignTargetRole', () => {
  // The argument is `roles.legacy_role`: the builtin role string for a builtin
  // row, null for a custom one — the same discriminator RolePicker sends on.

  it('sends a custom role through the custom-role gate', () => {
    expect(canAssignTargetRole('owner', null)).toBe(true);
    expect(canAssignTargetRole('manager', null)).toBe(true);
    // The finding this function exists to fix: an operations_manager may assign
    // staff, so canAssignAnyRole says yes — but a custom role is not staff.
    expect(canAssignAnyRole('operations_manager')).toBe(true);
    expect(canAssignTargetRole('operations_manager', null)).toBe(false);
  });

  it('sends a builtin role through the per-role invite gate', () => {
    expect(canAssignTargetRole('owner', 'owner')).toBe(true);
    // The other half of the same finding: a manager may assign plenty, just
    // never an owner.
    expect(canAssignTargetRole('manager', 'owner')).toBe(false);
    expect(canAssignTargetRole('operations_manager', 'staff')).toBe(true);
    expect(canAssignTargetRole('operations_manager', 'manager')).toBe(false);
  });

  it('is false for kiosk from every caller', () => {
    // Kiosk is in no inviter's row. A kiosk is provisioned from device setup,
    // not handed to a person — so nobody can assign someone into it.
    for (const r of [...ASSIGNERS, ...NON_ASSIGNERS]) {
      expect(canAssignTargetRole(r, 'kiosk')).toBe(false);
    }
  });

  it('is false for every target when the caller cannot assign at all', () => {
    for (const r of NON_ASSIGNERS) {
      expect(canAssignTargetRole(r, null)).toBe(false);
      expect(canAssignTargetRole(r, 'staff')).toBe(false);
    }
  });

  it('agrees with the two gates it delegates to, caller by caller', () => {
    for (const r of [...ASSIGNERS, ...NON_ASSIGNERS]) {
      expect(canAssignTargetRole(r, null)).toBe(canInviteCustomRole(r));
      for (const target of BUILTIN_TARGETS) {
        expect(canAssignTargetRole(r, target)).toBe(canInviteRole(r, target));
      }
    }
  });
});
