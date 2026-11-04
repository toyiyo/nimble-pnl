import { describe, it, expect } from 'vitest';
import { inviterMayInvite } from '../../supabase/functions/_shared/invitePermissions';

describe('inviterMayInvite (accept-invitation inviter check)', () => {
  it('refuses an owner invitation sent by a manager', () => {
    expect(inviterMayInvite('manager', 'owner')).toBe(false);
  });

  it('allows the roles a manager may invite', () => {
    expect(inviterMayInvite('manager', 'manager')).toBe(true);
    expect(inviterMayInvite('manager', 'staff')).toBe(true);
    expect(inviterMayInvite('manager', 'collaborator_accountant')).toBe(true);
  });

  it('allows an owner to invite an owner and a manager', () => {
    expect(inviterMayInvite('owner', 'owner')).toBe(true);
    expect(inviterMayInvite('owner', 'manager')).toBe(true);
  });

  it('limits an operations_manager to staff', () => {
    expect(inviterMayInvite('operations_manager', 'staff')).toBe(true);
    expect(inviterMayInvite('operations_manager', 'chef')).toBe(false);
    expect(inviterMayInvite('operations_manager', 'manager')).toBe(false);
  });

  it('refuses every invitation from a role with no row', () => {
    expect(inviterMayInvite('staff', 'staff')).toBe(false);
    expect(inviterMayInvite('chef', 'staff')).toBe(false);
    expect(inviterMayInvite('collaborator_accountant', 'staff')).toBe(false);
  });

  it('refuses an inviter with no membership', () => {
    expect(inviterMayInvite(null, 'staff')).toBe(false);
    expect(inviterMayInvite(undefined, 'staff')).toBe(false);
  });

  it('refuses kiosk for every inviter', () => {
    expect(inviterMayInvite('owner', 'kiosk')).toBe(false);
    expect(inviterMayInvite('manager', 'kiosk')).toBe(false);
  });

  it('allows collaborator_custom only for owner and manager', () => {
    expect(inviterMayInvite('owner', 'collaborator_custom')).toBe(true);
    expect(inviterMayInvite('manager', 'collaborator_custom')).toBe(true);
    expect(inviterMayInvite('operations_manager', 'collaborator_custom')).toBe(false);
  });

  it('refuses an unknown target role', () => {
    expect(inviterMayInvite('owner', 'superuser')).toBe(false);
  });
});
