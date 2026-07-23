import { describe, it, expect } from 'vitest';
import { canInviteRole, getInvitableRoles } from '@/lib/permissions/invitations';

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
