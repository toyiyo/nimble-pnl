import { renderHook } from '@testing-library/react';
import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { usePermissions } from '@/hooks/usePermissions';
import type { Role, Capability } from '@/lib/permissions/types';

// Mock the RestaurantContext
const mockUseRestaurantContext = vi.fn();

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => mockUseRestaurantContext(),
}));

describe('usePermissions Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper to set up mock context with a specific role
  const setupMockRole = (role: Role | null) => {
    mockUseRestaurantContext.mockReturnValue({
      selectedRestaurant: role ? { role } : null,
    });
  };

  // ============================================================
  // NULL ROLE TESTS
  // ============================================================

  describe('Null Role (No permissions)', () => {
    beforeEach(() => {
      setupMockRole(null);
    });

    it('should return null role when no restaurant selected', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.role).toBeNull();
    });

    it('should return empty capabilities array', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.capabilities).toEqual([]);
    });

    it('should return landingPath /auth', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.landingPath).toBe('/auth');
    });

    it('should return false for hasCapability', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.hasCapability('view:dashboard')).toBe(false);
      expect(result.current.hasCapability('view:transactions')).toBe(false);
      expect(result.current.hasCapability('manage:team')).toBe(false);
    });

    it('should return false for hasAnyCapability', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.hasAnyCapability(['view:dashboard', 'view:transactions'])).toBe(false);
    });

    it('should return false for hasAllCapabilities', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.hasAllCapabilities(['view:dashboard'])).toBe(false);
    });

    it('should return false for all role flags', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.isCollaborator).toBe(false);
      expect(result.current.isInternalTeam).toBe(false);
      expect(result.current.isStaff).toBe(false);
      expect(result.current.isKiosk).toBe(false);
    });

    it('should return false for management flags', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.canManageTeam).toBe(false);
      expect(result.current.canManageCollaborators).toBe(false);
    });

    it('should return Unknown for roleLabel', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.roleLabel).toBe('Unknown');
    });
  });

  // ============================================================
  // OWNER ROLE TESTS
  // ============================================================

  describe('Owner Role', () => {
    beforeEach(() => {
      setupMockRole('owner');
    });

    it('should return owner role', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.role).toBe('owner');
    });

    it('should return correct role flags', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.isCollaborator).toBe(false);
      expect(result.current.isInternalTeam).toBe(true);
      expect(result.current.isStaff).toBe(false);
      expect(result.current.isKiosk).toBe(false);
    });

    it('should have all management capabilities', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.canManageTeam).toBe(true);
      expect(result.current.canManageCollaborators).toBe(true);
    });

    it('should have dashboard access', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.hasCapability('view:dashboard')).toBe(true);
    });

    it('should have full financial access', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.hasAllCapabilities([
        'view:transactions',
        'edit:transactions',
        'view:banking',
        'edit:banking',
        'view:financial_statements',
      ])).toBe(true);
    });

    it('should have settings edit access', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.hasCapability('edit:settings')).toBe(true);
    });

    it('should return / as landingPath', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.landingPath).toBe('/');
    });

    it('should return Owner as roleLabel', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.roleLabel).toBe('Owner');
    });
  });

  // ============================================================
  // MANAGER ROLE TESTS
  // ============================================================

  describe('Manager Role', () => {
    beforeEach(() => {
      setupMockRole('manager');
    });

    it('should return correct role flags', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.isCollaborator).toBe(false);
      expect(result.current.isInternalTeam).toBe(true);
      expect(result.current.isStaff).toBe(false);
      expect(result.current.isKiosk).toBe(false);
    });

    it('should have management capabilities', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.canManageTeam).toBe(true);
      expect(result.current.canManageCollaborators).toBe(true);
    });

    it('should NOT have settings edit access', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.hasCapability('edit:settings')).toBe(false);
    });

    it('should have dashboard access', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.hasCapability('view:dashboard')).toBe(true);
      expect(result.current.hasCapability('view:ai_assistant')).toBe(true);
    });
  });

  // ============================================================
  // CHEF ROLE TESTS
  // ============================================================

  describe('Chef Role (Internal)', () => {
    beforeEach(() => {
      setupMockRole('chef');
    });

    it('should return correct role flags', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.isCollaborator).toBe(false);
      expect(result.current.isInternalTeam).toBe(true);
      expect(result.current.isStaff).toBe(false);
      expect(result.current.isKiosk).toBe(false);
    });

    it('should NOT have management capabilities', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.canManageTeam).toBe(false);
      expect(result.current.canManageCollaborators).toBe(false);
    });

    it('should have recipe access', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.hasCapability('view:recipes')).toBe(true);
      expect(result.current.hasCapability('edit:recipes')).toBe(true);
    });

    it('should NOT have financial access', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.hasCapability('view:transactions')).toBe(false);
      expect(result.current.hasCapability('view:banking')).toBe(false);
    });
  });

  // ============================================================
  // STAFF ROLE TESTS
  // ============================================================

  describe('Staff Role', () => {
    beforeEach(() => {
      setupMockRole('staff');
    });

    it('should return correct role flags', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.isCollaborator).toBe(false);
      expect(result.current.isInternalTeam).toBe(false);
      expect(result.current.isStaff).toBe(true);
      expect(result.current.isKiosk).toBe(false);
    });

    it('should NOT have management capabilities', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.canManageTeam).toBe(false);
      expect(result.current.canManageCollaborators).toBe(false);
    });

    it('should NOT have dashboard access', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.hasCapability('view:dashboard')).toBe(false);
    });

    it('should return /employee/clock as landingPath', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.landingPath).toBe('/employee/clock');
    });
  });

  // ============================================================
  // KIOSK ROLE TESTS
  // ============================================================

  describe('Kiosk Role', () => {
    beforeEach(() => {
      setupMockRole('kiosk');
    });

    it('should return correct role flags', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.isCollaborator).toBe(false);
      expect(result.current.isInternalTeam).toBe(false);
      expect(result.current.isStaff).toBe(false);
      expect(result.current.isKiosk).toBe(true);
    });

    it('should NOT have any management capabilities', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.canManageTeam).toBe(false);
      expect(result.current.canManageCollaborators).toBe(false);
    });

    it('should have no capabilities', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.capabilities.length).toBe(0);
    });

    it('should return /kiosk as landingPath', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.landingPath).toBe('/kiosk');
    });
  });

  // ============================================================
  // COLLABORATOR_ACCOUNTANT TESTS
  // ============================================================

  describe('Collaborator Accountant Role', () => {
    beforeEach(() => {
      setupMockRole('collaborator_accountant');
    });

    it('should return correct role flags', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.isCollaborator).toBe(true);
      expect(result.current.isInternalTeam).toBe(false);
      expect(result.current.isStaff).toBe(false);
      expect(result.current.isKiosk).toBe(false);
    });

    it('should NOT have management capabilities', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.canManageTeam).toBe(false);
      expect(result.current.canManageCollaborators).toBe(false);
    });

    it('should have financial capabilities', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.hasCapability('view:transactions')).toBe(true);
      expect(result.current.hasCapability('edit:transactions')).toBe(true);
      expect(result.current.hasCapability('view:banking')).toBe(true);
      expect(result.current.hasCapability('view:financial_statements')).toBe(true);
    });

    it('should NOT have team access', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.hasCapability('view:team')).toBe(false);
      expect(result.current.hasCapability('manage:team')).toBe(false);
    });

    it('should NOT have dashboard access', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.hasCapability('view:dashboard')).toBe(false);
    });

    it('should return /transactions as landingPath', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.landingPath).toBe('/transactions');
    });

    it('should return Accountant as roleLabel', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.roleLabel).toBe('Accountant');
    });
  });

  // ============================================================
  // COLLABORATOR_INVENTORY TESTS
  // ============================================================

  describe('Collaborator Inventory Role', () => {
    beforeEach(() => {
      setupMockRole('collaborator_inventory');
    });

    it('should return correct role flags', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.isCollaborator).toBe(true);
      expect(result.current.isInternalTeam).toBe(false);
    });

    it('should have inventory capabilities', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.hasCapability('view:inventory')).toBe(true);
      expect(result.current.hasCapability('edit:inventory')).toBe(true);
      expect(result.current.hasCapability('view:purchase_orders')).toBe(true);
    });

    it('should NOT have financial capabilities', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.hasCapability('view:transactions')).toBe(false);
      expect(result.current.hasCapability('view:banking')).toBe(false);
    });

    it('should return /inventory as landingPath', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.landingPath).toBe('/inventory');
    });
  });

  // ============================================================
  // COLLABORATOR_CHEF TESTS
  // ============================================================

  describe('Collaborator Chef Role', () => {
    beforeEach(() => {
      setupMockRole('collaborator_chef');
    });

    it('should return correct role flags', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.isCollaborator).toBe(true);
      expect(result.current.isInternalTeam).toBe(false);
    });

    it('should have recipe capabilities', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.hasCapability('view:recipes')).toBe(true);
      expect(result.current.hasCapability('edit:recipes')).toBe(true);
      expect(result.current.hasCapability('view:prep_recipes')).toBe(true);
      expect(result.current.hasCapability('edit:prep_recipes')).toBe(true);
    });

    it('should have view-only inventory access', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.hasCapability('view:inventory')).toBe(true);
      expect(result.current.hasCapability('edit:inventory')).toBe(false);
    });

    it('should return /recipes as landingPath', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.landingPath).toBe('/recipes');
    });
  });

  // ============================================================
  // CAPABILITY METHODS TESTS
  // ============================================================

  describe('Capability Methods', () => {
    beforeEach(() => {
      setupMockRole('owner');
    });

    describe('hasCapability', () => {
      it('should return true for capabilities the role has', () => {
        const { result } = renderHook(() => usePermissions());
        expect(result.current.hasCapability('view:dashboard')).toBe(true);
      });

      it('should return false for capabilities the role does not have', () => {
        setupMockRole('kiosk');
        const { result } = renderHook(() => usePermissions());
        expect(result.current.hasCapability('view:dashboard')).toBe(false);
      });
    });

    describe('hasAnyCapability', () => {
      it('should return true if the role has at least one of the capabilities', () => {
        setupMockRole('chef');
        const { result } = renderHook(() => usePermissions());
        expect(result.current.hasAnyCapability(['view:recipes', 'manage:team'])).toBe(true);
      });

      it('should return false if the role has none of the capabilities', () => {
        setupMockRole('staff');
        const { result } = renderHook(() => usePermissions());
        expect(result.current.hasAnyCapability(['view:recipes', 'view:dashboard'])).toBe(false);
      });

      it('should return false for empty array', () => {
        const { result } = renderHook(() => usePermissions());
        expect(result.current.hasAnyCapability([])).toBe(false);
      });
    });

    describe('hasAllCapabilities', () => {
      it('should return true if the role has all of the capabilities', () => {
        const { result } = renderHook(() => usePermissions());
        expect(result.current.hasAllCapabilities(['view:dashboard', 'view:transactions'])).toBe(true);
      });

      it('should return false if the role is missing any capability', () => {
        setupMockRole('chef');
        const { result } = renderHook(() => usePermissions());
        expect(result.current.hasAllCapabilities(['view:recipes', 'view:banking'])).toBe(false);
      });

      it('should return true for empty array', () => {
        const { result } = renderHook(() => usePermissions());
        expect(result.current.hasAllCapabilities([])).toBe(true);
      });
    });
  });

  // ============================================================
  // MANAGEMENT FLAGS TESTS
  // ============================================================

  describe('Management Flags', () => {
    it('owner should have canManageTeam and canManageCollaborators', () => {
      setupMockRole('owner');
      const { result } = renderHook(() => usePermissions());
      expect(result.current.canManageTeam).toBe(true);
      expect(result.current.canManageCollaborators).toBe(true);
    });

    it('manager should have canManageTeam and canManageCollaborators', () => {
      setupMockRole('manager');
      const { result } = renderHook(() => usePermissions());
      expect(result.current.canManageTeam).toBe(true);
      expect(result.current.canManageCollaborators).toBe(true);
    });

    it('chef should NOT have canManageTeam or canManageCollaborators', () => {
      setupMockRole('chef');
      const { result } = renderHook(() => usePermissions());
      expect(result.current.canManageTeam).toBe(false);
      expect(result.current.canManageCollaborators).toBe(false);
    });

    it('collaborator roles should NOT have management capabilities', () => {
      const collaboratorRoles: Role[] = ['collaborator_accountant', 'collaborator_inventory', 'collaborator_chef'];

      for (const role of collaboratorRoles) {
        setupMockRole(role);
        const { result } = renderHook(() => usePermissions());
        expect(result.current.canManageTeam).toBe(false);
        expect(result.current.canManageCollaborators).toBe(false);
      }
    });
  });
});
