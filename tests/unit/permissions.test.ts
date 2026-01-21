import { describe, it, expect } from 'vitest';
import {
  ROLE_CAPABILITIES,
  ROLE_METADATA,
  COLLABORATOR_PRESETS,
  isCollaboratorRole,
  getCollaboratorRoles,
  getInternalRoles,
  getLandingPath,
} from '@/lib/permissions';
import type { Role, Capability } from '@/lib/permissions/types';


describe('ROLE_CAPABILITIES', () => {
  it('should define capabilities for all roles', () => {
    const roles = Object.keys(ROLE_METADATA) as Role[];
    for (const role of roles) {
      expect(ROLE_CAPABILITIES).toHaveProperty(role);
      expect(Array.isArray(ROLE_CAPABILITIES[role])).toBe(true);
    }
  });

  it('owner should have all capabilities', () => {
    const ownerCaps = ROLE_CAPABILITIES['owner'];
    expect(ownerCaps).toContain('view:dashboard');
    expect(ownerCaps).toContain('edit:transactions');
    expect(ownerCaps).toContain('manage:collaborators');
  });

  it('collaborator roles should have only scoped capabilities', () => {
    const accountantCaps = ROLE_CAPABILITIES['collaborator_accountant'];
    expect(accountantCaps).toContain('view:transactions');
    expect(accountantCaps).not.toContain('edit:inventory');
    const inventoryCaps = ROLE_CAPABILITIES['collaborator_inventory'];
    expect(inventoryCaps).toContain('edit:inventory');
    expect(inventoryCaps).not.toContain('edit:transactions');
    const chefCaps = ROLE_CAPABILITIES['collaborator_chef'];
    expect(chefCaps).toContain('edit:recipes');
    expect(chefCaps).not.toContain('edit:transactions');
  });
});

describe('isCollaboratorRole', () => {
  it('returns true for collaborator roles', () => {
    expect(isCollaboratorRole('collaborator_accountant')).toBe(true);
    expect(isCollaboratorRole('collaborator_inventory')).toBe(true);
    expect(isCollaboratorRole('collaborator_chef')).toBe(true);
  });
  it('returns false for internal roles', () => {
    expect(isCollaboratorRole('owner')).toBe(false);
    expect(isCollaboratorRole('manager')).toBe(false);
    expect(isCollaboratorRole('chef')).toBe(false);
    expect(isCollaboratorRole('staff')).toBe(false);
    expect(isCollaboratorRole('kiosk')).toBe(false);
  });
});

describe('getCollaboratorRoles', () => {
  it('returns only collaborator roles', () => {
    const roles = getCollaboratorRoles();
    expect(roles).toEqual(
      expect.arrayContaining([
        'collaborator_accountant',
        'collaborator_inventory',
        'collaborator_chef',
      ])
    );
    expect(roles).not.toContain('owner');
    expect(roles).not.toContain('manager');
  });
});

describe('getInternalRoles', () => {
  it('returns only internal roles', () => {
    const roles = getInternalRoles();
    expect(roles).toEqual(
      expect.arrayContaining(['owner', 'manager', 'chef', 'staff', 'kiosk'])
    );
    expect(roles).not.toContain('collaborator_accountant');
  });
});

describe('getLandingPath', () => {
  it('returns correct landing path for each role', () => {
    expect(getLandingPath('owner')).toBe('/');
    expect(getLandingPath('collaborator_accountant')).toBe('/transactions');
    expect(getLandingPath('collaborator_inventory')).toBe('/inventory');
    expect(getLandingPath('collaborator_chef')).toBe('/recipes');
    expect(getLandingPath('staff')).toBe('/employee/clock');
    expect(getLandingPath('kiosk')).toBe('/kiosk');
  });
});

describe('COLLABORATOR_PRESETS', () => {
  it('should define all collaborator presets', () => {
    const roles = COLLABORATOR_PRESETS.map((p) => p.role);
    expect(roles).toEqual(
      expect.arrayContaining([
        'collaborator_accountant',
        'collaborator_inventory',
        'collaborator_chef',
      ])
    );
  });
});
