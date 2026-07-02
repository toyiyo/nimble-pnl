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

  it('non-management roles can invite nobody', () => {
    for (const r of ['chef', 'staff', 'kiosk', 'collaborator_accountant'] as const) {
      expect(getInvitableRoles(r)).toEqual([]);
    }
  });
});
