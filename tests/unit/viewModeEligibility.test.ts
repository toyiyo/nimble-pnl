/**
 * Tests for computeCanUseWorkView — pure eligibility rule for the
 * Admin ↔ My Work view-mode switch.
 *
 * canUseWorkView = !!currentEmployee && role ∉ { staff, kiosk, collaborator_* }
 *
 * See docs/superpowers/specs/2026-07-24-admin-work-view-mode-design.md
 */
import { describe, it, expect } from 'vitest';
import { computeCanUseWorkView } from '@/lib/viewModeEligibility';
import type { Role } from '@/lib/permissions/types';

const employee = { id: 'emp-1' } as const;

describe('computeCanUseWorkView', () => {
  it.each<Role>(['owner', 'manager', 'chef', 'operations_manager'])(
    'is true for role=%s with a linked employee record',
    (role) => {
      expect(
        computeCanUseWorkView({ currentEmployee: employee, role })
      ).toBe(true);
    }
  );

  it.each<Role>([
    'staff',
    'kiosk',
    'collaborator_accountant',
    'collaborator_inventory',
    'collaborator_chef',
    'collaborator_operations_manager',
  ])('is false for role=%s even with a linked employee record', (role) => {
    expect(
      computeCanUseWorkView({ currentEmployee: employee, role })
    ).toBe(false);
  });

  it('is false when currentEmployee is null, regardless of role', () => {
    expect(
      computeCanUseWorkView({ currentEmployee: null, role: 'owner' })
    ).toBe(false);
  });

  it('is false when role is undefined', () => {
    expect(
      computeCanUseWorkView({ currentEmployee: employee, role: undefined })
    ).toBe(false);
  });

  it('is false when both currentEmployee and role are absent', () => {
    expect(
      computeCanUseWorkView({ currentEmployee: null, role: undefined })
    ).toBe(false);
  });
});
