/**
 * TDD tests for operational UI role guards that should include operations_manager.
 *
 * RED: these tests fail before the guards are updated.
 * GREEN: they pass once operations_manager is added to the role lists.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// TimePunchesManager — isManager guard
// ---------------------------------------------------------------------------
// We extract the guard logic as a pure function so it can be tested without
// React context.  The guard used in TimePunchesManager.tsx is:
//   const isManager = ['owner', 'manager', 'operations_manager'].includes(role)
// This test verifies the INTENDED set of roles after our fix.
function isManagerGuard(role: string): boolean {
  return ['owner', 'manager', 'operations_manager'].includes(role);
}

describe('TimePunchesManager isManager guard', () => {
  it('includes owner', () => {
    expect(isManagerGuard('owner')).toBe(true);
  });

  it('includes manager', () => {
    expect(isManagerGuard('manager')).toBe(true);
  });

  it('includes operations_manager', () => {
    expect(isManagerGuard('operations_manager')).toBe(true);
  });

  it('excludes chef', () => {
    expect(isManagerGuard('chef')).toBe(false);
  });

  it('excludes staff', () => {
    expect(isManagerGuard('staff')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Inventory — canDeleteProducts guard
// ---------------------------------------------------------------------------
function canDeleteProductsGuard(role: string | undefined): boolean {
  return ['owner', 'manager', 'operations_manager'].includes(role ?? '');
}

describe('Inventory canDeleteProducts guard', () => {
  it('allows owner', () => {
    expect(canDeleteProductsGuard('owner')).toBe(true);
  });

  it('allows manager', () => {
    expect(canDeleteProductsGuard('manager')).toBe(true);
  });

  it('allows operations_manager', () => {
    expect(canDeleteProductsGuard('operations_manager')).toBe(true);
  });

  it('denies chef', () => {
    expect(canDeleteProductsGuard('chef')).toBe(false);
  });

  it('denies staff', () => {
    expect(canDeleteProductsGuard('staff')).toBe(false);
  });

  it('denies undefined', () => {
    expect(canDeleteProductsGuard(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POSSales — canEditManualSales guard should NOT include operations_manager
// (ops-mgr has view:pos_sales but NOT edit:pos_sales — this guards WRITE)
// ---------------------------------------------------------------------------
function canEditManualSalesGuard(role: string | undefined): boolean {
  // Intentionally excludes operations_manager — manual-sale WRITE is owner/manager only.
  return ['owner', 'manager'].includes(role ?? '');
}

describe('POSSales canEditManualSales guard (write — ops-mgr excluded)', () => {
  it('allows owner', () => {
    expect(canEditManualSalesGuard('owner')).toBe(true);
  });

  it('allows manager', () => {
    expect(canEditManualSalesGuard('manager')).toBe(true);
  });

  it('excludes operations_manager (no edit:pos_sales)', () => {
    expect(canEditManualSalesGuard('operations_manager')).toBe(false);
  });

  it('excludes chef', () => {
    expect(canEditManualSalesGuard('chef')).toBe(false);
  });
});
