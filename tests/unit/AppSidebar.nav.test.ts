/**
 * Tests for AppSidebar navigation filtering logic for operations_manager.
 *
 * The operations_manager role must see all navigation groups EXCEPT:
 * - The "Accounting" group (entirely removed)
 * - The "/integrations" item (filtered out from whichever group it appears in)
 */
import { describe, it, expect } from 'vitest';
import {
  getNavigationForRole,
  navigationGroups,
  staffNav,
} from '@/components/AppSidebar.nav';

describe('AppSidebar.nav – operations_manager', () => {
  const nav = getNavigationForRole('operations_manager');

  it('returns a non-empty nav for operations_manager', () => {
    expect(nav.length).toBeGreaterThan(0);
  });

  it('excludes the Accounting group entirely', () => {
    const labels = nav.map((g) => g.label);
    expect(labels).not.toContain('Accounting');
  });

  it('excludes the /integrations item from every group', () => {
    const allPaths = nav.flatMap((g) => g.items.map((i) => i.path));
    expect(allPaths).not.toContain('/integrations');
  });

  it('includes all non-Accounting groups that are in the full nav', () => {
    const fullGroupLabels = navigationGroups
      .filter((g) => g.label !== 'Accounting')
      .map((g) => g.label);
    const opsGroupLabels = nav.map((g) => g.label);
    expect(opsGroupLabels).toEqual(fullGroupLabels);
  });

  it('preserves all non-integrations items within each retained group', () => {
    for (const opsGroup of nav) {
      const fullGroup = navigationGroups.find((g) => g.label === opsGroup.label);
      if (!fullGroup) continue; // only check groups carried over from full nav
      const expectedItems = fullGroup.items.filter((i) => i.path !== '/integrations');
      expect(opsGroup.items).toEqual(expectedItems);
    }
  });

  it('returns full nav for owner role', () => {
    const ownerNav = getNavigationForRole('owner');
    expect(ownerNav).toEqual(navigationGroups);
  });

  it('returns full nav for manager role', () => {
    const managerNav = getNavigationForRole('manager');
    expect(managerNav).toEqual(navigationGroups);
  });

  it('returns empty array for kiosk role', () => {
    const kioskNav = getNavigationForRole('kiosk');
    expect(kioskNav).toEqual([]);
  });
});

describe('AppSidebar.nav – Labor entry', () => {
  it('adds a "Labor" item pointing at /labor in the Operations group, right after Payroll', () => {
    const operations = navigationGroups.find((g) => g.label === 'Operations');
    expect(operations).toBeDefined();
    const paths = operations!.items.map((i) => i.path);
    const payrollIndex = paths.indexOf('/payroll');
    expect(payrollIndex).toBeGreaterThanOrEqual(0);
    expect(paths[payrollIndex + 1]).toBe('/labor');

    const laborItem = operations!.items.find((i) => i.path === '/labor');
    expect(laborItem?.label).toBe('Labor');
    expect(laborItem?.icon).toBeDefined();
  });

  it('surfaces the Labor item for operations_manager (Operations group is retained)', () => {
    const nav = getNavigationForRole('operations_manager');
    const operations = nav.find((g) => g.label === 'Operations');
    const paths = operations?.items.map((i) => i.path) ?? [];
    expect(paths).toContain('/labor');
  });

  it('surfaces the Labor item for owner and manager (full nav)', () => {
    for (const role of ['owner', 'manager']) {
      const nav = getNavigationForRole(role);
      const operations = nav.find((g) => g.label === 'Operations');
      const paths = operations?.items.map((i) => i.path) ?? [];
      expect(paths).toContain('/labor');
    }
  });
});

describe('AppSidebar.nav – viewMode param', () => {
  it('returns staffNav when viewMode is "work", regardless of role', () => {
    for (const role of ['owner', 'manager', 'chef', 'operations_manager']) {
      expect(getNavigationForRole(role, 'work')).toEqual(staffNav);
    }
  });

  it('returns unchanged behavior when viewMode is omitted', () => {
    expect(getNavigationForRole('owner')).toEqual(navigationGroups);
    expect(getNavigationForRole('manager')).toEqual(navigationGroups);
    expect(getNavigationForRole('operations_manager')).toEqual(
      getNavigationForRole('operations_manager', undefined)
    );
  });

  it('returns unchanged behavior when viewMode is "admin"', () => {
    expect(getNavigationForRole('owner', 'admin')).toEqual(navigationGroups);
    expect(getNavigationForRole('manager', 'admin')).toEqual(navigationGroups);
    expect(getNavigationForRole('operations_manager', 'admin')).toEqual(
      getNavigationForRole('operations_manager')
    );
  });

  it('still returns staffNav for the staff role itself when viewMode is "work"', () => {
    expect(getNavigationForRole('staff', 'work')).toEqual(staffNav);
  });

  it('returns staffNav when viewMode is "work" even while role is undefined (remount-timing window)', () => {
    // During the remount right after enterWorkMode()'s navigate(),
    // selectedRestaurant/role can be briefly undefined before re-hydrating.
    // Work mode must still win so the sidebar doesn't flash empty.
    expect(getNavigationForRole(undefined, 'work')).toEqual(staffNav);
  });
});
