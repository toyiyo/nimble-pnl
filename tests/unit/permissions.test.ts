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

// ============================================================
// CRITICAL: These tests ensure permissions don't regress
// Any changes to permissions should be deliberate and reviewed
// ============================================================

describe('Permission System Integrity', () => {
  describe('All roles defined', () => {
    const ALL_EXPECTED_ROLES: Role[] = [
      'owner',
      'manager',
      'chef',
      'staff',
      'kiosk',
      'collaborator_accountant',
      'collaborator_inventory',
      'collaborator_chef',
    ];

    it('should have metadata for all expected roles', () => {
      for (const role of ALL_EXPECTED_ROLES) {
        expect(ROLE_METADATA).toHaveProperty(role);
        expect(ROLE_METADATA[role]).toBeDefined();
        expect(ROLE_METADATA[role].label).toBeDefined();
        expect(ROLE_METADATA[role].landingPath).toBeDefined();
      }
    });

    it('should have capabilities defined for all expected roles', () => {
      for (const role of ALL_EXPECTED_ROLES) {
        expect(ROLE_CAPABILITIES).toHaveProperty(role);
        expect(Array.isArray(ROLE_CAPABILITIES[role])).toBe(true);
      }
    });

    it('should not have any undefined roles in ROLE_CAPABILITIES', () => {
      const definedRoles = Object.keys(ROLE_CAPABILITIES) as Role[];
      for (const role of definedRoles) {
        expect(ALL_EXPECTED_ROLES).toContain(role);
      }
    });
  });
});

// ============================================================
// EXISTING ROLE PERMISSIONS (MUST NOT REGRESS)
// ============================================================

describe('ROLE_CAPABILITIES - Existing Roles (Regression Prevention)', () => {
  describe('Owner Role', () => {
    const ownerCaps = ROLE_CAPABILITIES['owner'];

    it('should have full dashboard access', () => {
      expect(ownerCaps).toContain('view:dashboard');
      expect(ownerCaps).toContain('view:ai_assistant');
    });

    it('should have full financial access', () => {
      expect(ownerCaps).toContain('view:transactions');
      expect(ownerCaps).toContain('edit:transactions');
      expect(ownerCaps).toContain('view:banking');
      expect(ownerCaps).toContain('edit:banking');
      expect(ownerCaps).toContain('view:expenses');
      expect(ownerCaps).toContain('edit:expenses');
      expect(ownerCaps).toContain('view:financial_statements');
      expect(ownerCaps).toContain('view:chart_of_accounts');
      expect(ownerCaps).toContain('edit:chart_of_accounts');
      expect(ownerCaps).toContain('view:financial_intelligence');
    });

    it('should have full inventory access', () => {
      expect(ownerCaps).toContain('view:inventory');
      expect(ownerCaps).toContain('edit:inventory');
      expect(ownerCaps).toContain('view:inventory_audit');
      expect(ownerCaps).toContain('edit:inventory_audit');
      expect(ownerCaps).toContain('view:purchase_orders');
      expect(ownerCaps).toContain('edit:purchase_orders');
      expect(ownerCaps).toContain('view:receipt_import');
      expect(ownerCaps).toContain('edit:receipt_import');
    });

    it('should have full recipe access', () => {
      expect(ownerCaps).toContain('view:recipes');
      expect(ownerCaps).toContain('edit:recipes');
      expect(ownerCaps).toContain('view:prep_recipes');
      expect(ownerCaps).toContain('edit:prep_recipes');
      expect(ownerCaps).toContain('view:batches');
      expect(ownerCaps).toContain('edit:batches');
    });

    it('should have full team management access', () => {
      expect(ownerCaps).toContain('view:team');
      expect(ownerCaps).toContain('manage:team');
      expect(ownerCaps).toContain('view:employees');
      expect(ownerCaps).toContain('manage:employees');
      expect(ownerCaps).toContain('view:collaborators');
      expect(ownerCaps).toContain('manage:collaborators');
    });

    it('should have full payroll and scheduling access', () => {
      expect(ownerCaps).toContain('view:payroll');
      expect(ownerCaps).toContain('edit:payroll');
      expect(ownerCaps).toContain('view:scheduling');
      expect(ownerCaps).toContain('edit:scheduling');
      expect(ownerCaps).toContain('view:time_punches');
      expect(ownerCaps).toContain('edit:time_punches');
      expect(ownerCaps).toContain('view:tips');
      expect(ownerCaps).toContain('edit:tips');
    });

    it('should have full settings and integrations access', () => {
      expect(ownerCaps).toContain('view:settings');
      expect(ownerCaps).toContain('edit:settings');
      expect(ownerCaps).toContain('view:integrations');
      expect(ownerCaps).toContain('manage:integrations');
    });
  });

  describe('Manager Role', () => {
    const managerCaps = ROLE_CAPABILITIES['manager'];

    it('should have dashboard access', () => {
      expect(managerCaps).toContain('view:dashboard');
      expect(managerCaps).toContain('view:ai_assistant');
    });

    it('should have most financial access', () => {
      expect(managerCaps).toContain('view:transactions');
      expect(managerCaps).toContain('edit:transactions');
      expect(managerCaps).toContain('view:banking');
      expect(managerCaps).toContain('edit:banking');
      expect(managerCaps).toContain('view:expenses');
      expect(managerCaps).toContain('edit:expenses');
      expect(managerCaps).toContain('view:financial_statements');
      expect(managerCaps).toContain('view:financial_intelligence');
    });

    it('should have team management access', () => {
      expect(managerCaps).toContain('view:team');
      expect(managerCaps).toContain('manage:team');
      expect(managerCaps).toContain('view:employees');
      expect(managerCaps).toContain('manage:employees');
    });

    it('should have collaborator management access', () => {
      expect(managerCaps).toContain('view:collaborators');
      expect(managerCaps).toContain('manage:collaborators');
    });

    it('should have operational access', () => {
      expect(managerCaps).toContain('view:scheduling');
      expect(managerCaps).toContain('edit:scheduling');
      expect(managerCaps).toContain('view:payroll');
      expect(managerCaps).toContain('edit:payroll');
    });

    it('should NOT have settings edit access', () => {
      expect(managerCaps).not.toContain('edit:settings');
    });
  });

  describe('Chef Role (Internal)', () => {
    const chefCaps = ROLE_CAPABILITIES['chef'];

    it('should have dashboard access', () => {
      expect(chefCaps).toContain('view:dashboard');
    });

    it('should have full recipe access', () => {
      expect(chefCaps).toContain('view:recipes');
      expect(chefCaps).toContain('edit:recipes');
      expect(chefCaps).toContain('view:prep_recipes');
      expect(chefCaps).toContain('edit:prep_recipes');
      expect(chefCaps).toContain('view:batches');
      expect(chefCaps).toContain('edit:batches');
    });

    it('should have inventory access', () => {
      expect(chefCaps).toContain('view:inventory');
      expect(chefCaps).toContain('edit:inventory');
      expect(chefCaps).toContain('view:inventory_audit');
    });

    it('should NOT have financial access', () => {
      expect(chefCaps).not.toContain('view:transactions');
      expect(chefCaps).not.toContain('edit:transactions');
      expect(chefCaps).not.toContain('view:banking');
      expect(chefCaps).not.toContain('view:payroll');
    });

    it('should NOT have team management access', () => {
      expect(chefCaps).not.toContain('manage:team');
      expect(chefCaps).not.toContain('manage:employees');
      expect(chefCaps).not.toContain('view:collaborators');
    });
  });

  describe('Staff Role', () => {
    const staffCaps = ROLE_CAPABILITIES['staff'];

    it('should have minimal capabilities', () => {
      expect(staffCaps).toContain('view:settings');
    });

    it('should NOT have dashboard access', () => {
      expect(staffCaps).not.toContain('view:dashboard');
    });

    it('should NOT have financial access', () => {
      expect(staffCaps).not.toContain('view:transactions');
      expect(staffCaps).not.toContain('view:banking');
      expect(staffCaps).not.toContain('view:payroll');
    });

    it('should NOT have team access', () => {
      expect(staffCaps).not.toContain('view:team');
      expect(staffCaps).not.toContain('manage:team');
    });
  });

  describe('Kiosk Role', () => {
    const kioskCaps = ROLE_CAPABILITIES['kiosk'];

    it('should have no capabilities (handled via routes)', () => {
      expect(kioskCaps.length).toBe(0);
    });
  });
});

// ============================================================
// COLLABORATOR ROLE PERMISSIONS (NEW ROLES)
// ============================================================

describe('ROLE_CAPABILITIES - Collaborator Roles', () => {
  describe('Collaborator Accountant', () => {
    const caps = ROLE_CAPABILITIES['collaborator_accountant'];

    it('should have financial access', () => {
      expect(caps).toContain('view:transactions');
      expect(caps).toContain('edit:transactions');
      expect(caps).toContain('view:banking');
      expect(caps).toContain('edit:banking');
      expect(caps).toContain('view:expenses');
      expect(caps).toContain('edit:expenses');
      expect(caps).toContain('view:financial_statements');
      expect(caps).toContain('view:chart_of_accounts');
      expect(caps).toContain('edit:chart_of_accounts');
      expect(caps).toContain('view:invoices');
      expect(caps).toContain('edit:invoices');
      expect(caps).toContain('view:customers');
      expect(caps).toContain('edit:customers');
      expect(caps).toContain('view:financial_intelligence');
    });

    it('should have read-only payroll access for bookkeeping', () => {
      expect(caps).toContain('view:payroll');
      expect(caps).not.toContain('edit:payroll');
    });

    it('should have employee view for payroll context', () => {
      expect(caps).toContain('view:employees');
      expect(caps).not.toContain('manage:employees');
    });

    it('should NOT have dashboard access', () => {
      expect(caps).not.toContain('view:dashboard');
    });

    it('should NOT have inventory access', () => {
      expect(caps).not.toContain('view:inventory');
      expect(caps).not.toContain('edit:inventory');
    });

    it('should NOT have recipe access', () => {
      expect(caps).not.toContain('view:recipes');
      expect(caps).not.toContain('edit:recipes');
    });

    it('should NOT have team access', () => {
      expect(caps).not.toContain('view:team');
      expect(caps).not.toContain('manage:team');
      expect(caps).not.toContain('view:collaborators');
      expect(caps).not.toContain('manage:collaborators');
    });

    it('should NOT have scheduling access', () => {
      expect(caps).not.toContain('view:scheduling');
      expect(caps).not.toContain('edit:scheduling');
    });
  });

  describe('Collaborator Inventory', () => {
    const caps = ROLE_CAPABILITIES['collaborator_inventory'];

    it('should have inventory access', () => {
      expect(caps).toContain('view:inventory');
      expect(caps).toContain('edit:inventory');
      expect(caps).toContain('view:inventory_audit');
      expect(caps).toContain('edit:inventory_audit');
      expect(caps).toContain('view:purchase_orders');
      expect(caps).toContain('edit:purchase_orders');
      expect(caps).toContain('view:receipt_import');
      expect(caps).toContain('edit:receipt_import');
    });

    it('should have settings access', () => {
      expect(caps).toContain('view:settings');
    });

    it('should NOT have dashboard access', () => {
      expect(caps).not.toContain('view:dashboard');
    });

    it('should NOT have financial access', () => {
      expect(caps).not.toContain('view:transactions');
      expect(caps).not.toContain('view:banking');
      expect(caps).not.toContain('view:payroll');
      expect(caps).not.toContain('view:expenses');
    });

    it('should NOT have team access', () => {
      expect(caps).not.toContain('view:team');
      expect(caps).not.toContain('manage:team');
      expect(caps).not.toContain('view:employees');
    });

    it('should NOT have recipe access', () => {
      expect(caps).not.toContain('view:recipes');
      expect(caps).not.toContain('edit:recipes');
    });
  });

  describe('Collaborator Chef', () => {
    const caps = ROLE_CAPABILITIES['collaborator_chef'];

    it('should have recipe access', () => {
      expect(caps).toContain('view:recipes');
      expect(caps).toContain('edit:recipes');
      expect(caps).toContain('view:prep_recipes');
      expect(caps).toContain('edit:prep_recipes');
      expect(caps).toContain('view:batches');
      expect(caps).toContain('edit:batches');
    });

    it('should have view-only inventory access for ingredient context', () => {
      expect(caps).toContain('view:inventory');
      expect(caps).not.toContain('edit:inventory');
    });

    it('should have settings access', () => {
      expect(caps).toContain('view:settings');
    });

    it('should NOT have dashboard access', () => {
      expect(caps).not.toContain('view:dashboard');
    });

    it('should NOT have financial access', () => {
      expect(caps).not.toContain('view:transactions');
      expect(caps).not.toContain('view:banking');
      expect(caps).not.toContain('view:payroll');
      expect(caps).not.toContain('view:expenses');
    });

    it('should NOT have team access', () => {
      expect(caps).not.toContain('view:team');
      expect(caps).not.toContain('manage:team');
      expect(caps).not.toContain('view:employees');
    });

    it('should NOT have purchase orders access', () => {
      expect(caps).not.toContain('view:purchase_orders');
      expect(caps).not.toContain('edit:purchase_orders');
    });
  });
});

// ============================================================
// COLLABORATOR ISOLATION TESTS
// ============================================================

describe('Collaborator Isolation', () => {
  it('collaborators should NEVER see team or collaborators', () => {
    const collaboratorRoles = getCollaboratorRoles();

    for (const role of collaboratorRoles) {
      const caps = ROLE_CAPABILITIES[role];
      expect(caps).not.toContain('view:team');
      expect(caps).not.toContain('manage:team');
      expect(caps).not.toContain('view:collaborators');
      expect(caps).not.toContain('manage:collaborators');
    }
  });

  it('collaborators should NEVER have integrations access', () => {
    const collaboratorRoles = getCollaboratorRoles();

    for (const role of collaboratorRoles) {
      const caps = ROLE_CAPABILITIES[role];
      expect(caps).not.toContain('view:integrations');
      expect(caps).not.toContain('manage:integrations');
    }
  });

  it('collaborators should NEVER have AI assistant access', () => {
    const collaboratorRoles = getCollaboratorRoles();

    for (const role of collaboratorRoles) {
      const caps = ROLE_CAPABILITIES[role];
      expect(caps).not.toContain('view:ai_assistant');
    }
  });
});

// ============================================================
// HELPER FUNCTION TESTS
// ============================================================

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
    expect(roles).not.toContain('chef');
    expect(roles).not.toContain('staff');
    expect(roles).not.toContain('kiosk');
  });

  it('returns exactly 3 collaborator roles', () => {
    const roles = getCollaboratorRoles();
    expect(roles.length).toBe(3);
  });
});

describe('getInternalRoles', () => {
  it('returns only internal roles', () => {
    const roles = getInternalRoles();
    expect(roles).toEqual(
      expect.arrayContaining(['owner', 'manager', 'chef', 'staff', 'kiosk'])
    );
    expect(roles).not.toContain('collaborator_accountant');
    expect(roles).not.toContain('collaborator_inventory');
    expect(roles).not.toContain('collaborator_chef');
  });

  it('returns exactly 5 internal roles', () => {
    const roles = getInternalRoles();
    expect(roles.length).toBe(5);
  });
});

describe('getLandingPath', () => {
  it('returns correct landing path for internal roles', () => {
    expect(getLandingPath('owner')).toBe('/');
    expect(getLandingPath('manager')).toBe('/');
    expect(getLandingPath('chef')).toBe('/');
    expect(getLandingPath('staff')).toBe('/employee/clock');
    expect(getLandingPath('kiosk')).toBe('/kiosk');
  });

  it('returns correct landing path for collaborator roles', () => {
    expect(getLandingPath('collaborator_accountant')).toBe('/transactions');
    expect(getLandingPath('collaborator_inventory')).toBe('/inventory');
    expect(getLandingPath('collaborator_chef')).toBe('/recipes');
  });
});

// ============================================================
// COLLABORATOR PRESETS TESTS
// ============================================================

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

  it('should have titles and descriptions for all presets', () => {
    for (const preset of COLLABORATOR_PRESETS) {
      expect(preset.title).toBeDefined();
      expect(preset.title.length).toBeGreaterThan(0);
      expect(preset.description).toBeDefined();
      expect(preset.description.length).toBeGreaterThan(0);
    }
  });

  it('should have features list for all presets', () => {
    for (const preset of COLLABORATOR_PRESETS) {
      expect(Array.isArray(preset.features)).toBe(true);
      expect(preset.features.length).toBeGreaterThan(0);
    }
  });

  it('preset roles should match actual collaborator roles', () => {
    const presetRoles = COLLABORATOR_PRESETS.map((p) => p.role);
    const actualRoles = getCollaboratorRoles();
    expect(presetRoles.sort()).toEqual(actualRoles.sort());
  });
});

// ============================================================
// ROLE METADATA TESTS
// ============================================================

describe('ROLE_METADATA', () => {
  it('should have correct category for each role', () => {
    expect(ROLE_METADATA['owner'].category).toBe('internal');
    expect(ROLE_METADATA['manager'].category).toBe('internal');
    expect(ROLE_METADATA['chef'].category).toBe('internal');
    expect(ROLE_METADATA['staff'].category).toBe('internal');
    expect(ROLE_METADATA['kiosk'].category).toBe('internal');
    expect(ROLE_METADATA['collaborator_accountant'].category).toBe('collaborator');
    expect(ROLE_METADATA['collaborator_inventory'].category).toBe('collaborator');
    expect(ROLE_METADATA['collaborator_chef'].category).toBe('collaborator');
  });

  it('should have human-readable labels for all roles', () => {
    expect(ROLE_METADATA['owner'].label).toBe('Owner');
    expect(ROLE_METADATA['manager'].label).toBe('Manager');
    expect(ROLE_METADATA['chef'].label).toBe('Chef');
    expect(ROLE_METADATA['staff'].label).toBe('Staff');
    expect(ROLE_METADATA['kiosk'].label).toBe('Kiosk');
    expect(ROLE_METADATA['collaborator_accountant'].label).toBe('Accountant');
    expect(ROLE_METADATA['collaborator_inventory'].label).toBe('Inventory Helper');
    expect(ROLE_METADATA['collaborator_chef'].label).toBe('Recipe Consultant');
  });
});

// ============================================================
// CAPABILITY COVERAGE TESTS
// ============================================================

describe('Capability Coverage', () => {
  it('all capabilities should be used by at least one role', () => {
    // Get all unique capabilities used across all roles
    const usedCapabilities = new Set<Capability>();
    for (const role of Object.keys(ROLE_CAPABILITIES) as Role[]) {
      for (const cap of ROLE_CAPABILITIES[role]) {
        usedCapabilities.add(cap);
      }
    }

    // These are all the capabilities we expect to be defined
    const expectedCapabilities: Capability[] = [
      'view:dashboard',
      'view:ai_assistant',
      'view:transactions',
      'edit:transactions',
      'view:banking',
      'edit:banking',
      'view:expenses',
      'edit:expenses',
      'view:financial_statements',
      'view:chart_of_accounts',
      'edit:chart_of_accounts',
      'view:invoices',
      'edit:invoices',
      'view:customers',
      'edit:customers',
      'view:financial_intelligence',
      'view:inventory',
      'edit:inventory',
      'view:inventory_audit',
      'edit:inventory_audit',
      'view:purchase_orders',
      'edit:purchase_orders',
      'view:receipt_import',
      'edit:receipt_import',
      'view:reports',
      'view:recipes',
      'edit:recipes',
      'view:prep_recipes',
      'edit:prep_recipes',
      'view:batches',
      'edit:batches',
      'view:pos_sales',
      'view:scheduling',
      'edit:scheduling',
      'view:payroll',
      'edit:payroll',
      'view:tips',
      'edit:tips',
      'view:time_punches',
      'edit:time_punches',
      'view:team',
      'manage:team',
      'view:employees',
      'manage:employees',
      'view:settings',
      'edit:settings',
      'view:integrations',
      'manage:integrations',
      'view:collaborators',
      'manage:collaborators',
    ];

    for (const cap of expectedCapabilities) {
      expect(usedCapabilities.has(cap)).toBe(true);
    }
  });
});

// ============================================================
// REGRESSION SNAPSHOT TESTS
// ============================================================

describe('Permission Regression Snapshots', () => {
  it('owner capability count should not decrease', () => {
    // Owner should have comprehensive access
    const ownerCaps = ROLE_CAPABILITIES['owner'];
    // As of initial implementation, owner has 50 capabilities
    expect(ownerCaps.length).toBeGreaterThanOrEqual(50);
  });

  it('manager capability count should not decrease', () => {
    const managerCaps = ROLE_CAPABILITIES['manager'];
    // Manager should have most capabilities except some admin
    expect(managerCaps.length).toBeGreaterThanOrEqual(45);
  });

  it('collaborator roles should have focused capabilities', () => {
    // Collaborators should have limited, scoped access
    expect(ROLE_CAPABILITIES['collaborator_accountant'].length).toBeLessThan(20);
    expect(ROLE_CAPABILITIES['collaborator_inventory'].length).toBeLessThan(12);
    expect(ROLE_CAPABILITIES['collaborator_chef'].length).toBeLessThan(12);
  });
});
