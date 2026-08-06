/**
 * Tests for AppSidebar navigation filtering logic for operations_manager.
 *
 * The operations_manager role must see all navigation groups EXCEPT:
 * - The "Accounting" group (entirely removed)
 * - The "/integrations" item (filtered out from whichever group it appears in)
 */
import { describe, it, expect } from 'vitest';
import {
  collaboratorAccountantNav,
  collaboratorChefNav,
  collaboratorInventoryNav,
  collaboratorOperationsManagerNav,
  getNavigationForAreas,
  getNavigationForRole,
  navigationGroups,
  operationsManagerNav,
  staffNav,
} from '@/components/AppSidebar.nav';
import { allowedPathsForAreas } from '@/lib/permissions/routeAreas';
import type { AreaKey, AreaLevel } from '@/lib/permissions/areas';

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

describe('AppSidebar.nav – custom roles derive their nav from granted areas', () => {
  type Grants = Partial<Record<AreaKey, AreaLevel>>;
  const INVENTORY_ROLE: Grants = { inventory: 'manage', purchasing: 'manage', settings: 'view' };

  it('keeps every builtin role\'s nav byte-identical, even when grants are passed', () => {
    // The whole point of the branch: builtin arrays are retained, not
    // regenerated. Passing a role's grants must not re-derive its sidebar.
    const grants: Grants = { books: 'manage' };
    expect(getNavigationForRole('owner', undefined, grants)).toEqual(navigationGroups);
    expect(getNavigationForRole('manager', undefined, grants)).toEqual(navigationGroups);
    expect(getNavigationForRole('chef', undefined, grants)).toEqual(navigationGroups);
    expect(getNavigationForRole('operations_manager', undefined, grants)).toEqual(operationsManagerNav);
    expect(getNavigationForRole('staff', undefined, grants)).toEqual(staffNav);
    expect(getNavigationForRole('kiosk', undefined, grants)).toEqual([]);
    expect(getNavigationForRole('collaborator_accountant', undefined, grants)).toEqual(collaboratorAccountantNav);
    expect(getNavigationForRole('collaborator_inventory', undefined, grants)).toEqual(collaboratorInventoryNav);
    expect(getNavigationForRole('collaborator_chef', undefined, grants)).toEqual(collaboratorChefNav);
    expect(getNavigationForRole('collaborator_operations_manager', undefined, grants)).toEqual(
      collaboratorOperationsManagerNav
    );
  });

  it('renders an empty sidebar for a custom role whose grants have not arrived', () => {
    // Fails closed. `roleRecord` is null for a membership mid-hydration, and
    // an unknown collaborator role must not fall through to the full nav.
    expect(getNavigationForRole('collaborator_custom')).toEqual([]);
    expect(getNavigationForRole('collaborator_custom', 'admin', undefined)).toEqual([]);
  });

  it('still collapses to staffNav in work mode', () => {
    expect(getNavigationForRole('collaborator_custom', 'work', INVENTORY_ROLE)).toEqual(staffNav);
  });

  it('surfaces only the granted areas\' pages', () => {
    const nav = getNavigationForRole('collaborator_custom', undefined, INVENTORY_ROLE);
    const paths = nav.flatMap((group) => group.items.map((item) => item.path));
    expect(paths).toContain('/inventory');
    expect(paths).toContain('/inventory-audit');
    expect(paths).toContain('/purchase-orders');
    expect(paths).toContain('/settings');
    expect(paths).toContain('/help');
    expect(paths).not.toContain('/recipes');
    expect(paths).not.toContain('/payroll');
    expect(paths).not.toContain('/transactions');
  });

  it('drops groups left with no items', () => {
    const nav = getNavigationForAreas(INVENTORY_ROLE);
    expect(nav.every((group) => group.items.length > 0)).toBe(true);
    expect(nav.map((group) => group.label)).not.toContain('Accounting');
    expect(nav.map((group) => group.label)).not.toContain('Operations');
  });

  it('relabels the Admin group "Settings", as every collaborator nav does', () => {
    const nav = getNavigationForAreas(INVENTORY_ROLE);
    expect(nav.map((group) => group.label)).toContain('Settings');
    expect(nav.map((group) => group.label)).not.toContain('Admin');
  });

  it('hides /employees from the sidebar while leaving it route-reachable', () => {
    // The split AppSidebar.nav.ts documents at :223-225 — /employees is
    // scheduling context, reachable by URL but never a sidebar entry for an
    // external role. An areas->nav filter alone cannot express this.
    const grants: Grants = { employees: 'manage', scheduling: 'manage' };
    const paths = getNavigationForAreas(grants).flatMap((g) => g.items.map((i) => i.path));
    expect(paths).not.toContain('/employees');
    expect(allowedPathsForAreas(grants)).toContain('/employees');
  });

  it('hides the P&L surfaces even when the reports area is granted at manage', () => {
    const paths = getNavigationForAreas({ reports: 'manage' }).flatMap((g) =>
      g.items.map((i) => i.path)
    );
    expect(paths).not.toContain('/');
    expect(paths).not.toContain('/reports');
  });

  it('never surfaces a path the route derivation would bounce', () => {
    const grants: Grants = {
      reports: 'manage',
      sales: 'view',
      inventory: 'manage',
      scheduling: 'manage',
      books: 'manage',
      employees: 'manage',
      settings: 'view',
    };
    const allowed = new Set(allowedPathsForAreas(grants));
    for (const group of getNavigationForAreas(grants)) {
      for (const item of group.items) {
        expect(allowed.has(item.path)).toBe(true);
      }
    }
  });

  it('surfaces Receipt Import for an inventory role, as collaboratorInventoryNav does', () => {
    // /receipt-import is route-allowed for the inventory builtin but has no
    // entry in navigationGroups (owners reach it from inside Inventory), so
    // the derived nav has to supplement it or a custom inventory role would
    // be routed to a page its own sidebar never offers.
    const paths = getNavigationForAreas(INVENTORY_ROLE).flatMap((g) => g.items.map((i) => i.path));
    expect(paths).toContain('/receipt-import');
  });

  it('shows nothing but Help for a role granted no areas', () => {
    const nav = getNavigationForAreas({});
    expect(nav.flatMap((group) => group.items.map((item) => item.path))).toEqual(['/help']);
  });
});

describe('AppSidebar.nav.data — the leaf module', () => {
  it('re-exports the same navigationGroups reference AppSidebar.nav uses', async () => {
    // Guards against a copy that silently forks from the moved original:
    // AppSidebar.nav.ts must re-export this exact array, not a duplicate.
    const dataModule = await import('@/components/AppSidebar.nav.data');
    expect(dataModule.navigationGroups).toBe(navigationGroups);
  });

  it('re-exports the same SUPPLEMENTAL_NAV_ITEMS reference AppSidebar.nav uses', async () => {
    // Same guard as navigationGroups above, for the other data export the
    // plan calls out by name (Task 1 Step 2).
    const navModule = await import('@/components/AppSidebar.nav');
    const dataModule = await import('@/components/AppSidebar.nav.data');
    expect(navModule.SUPPLEMENTAL_NAV_ITEMS).toBe(dataModule.SUPPLEMENTAL_NAV_ITEMS);
  });

  it('imports nothing from @/lib/permissions, keeping it a leaf', async () => {
    // areas.ts derives AREA_DEFINITIONS from navigationGroups while
    // AppSidebar.nav.ts imports from routeAreas.ts (which imports areas.ts).
    // If this data file ever imported from @/lib/permissions, that would be
    // an import cycle with module-level const initialization on both ends —
    // a temporal-dead-zone crash at import time, not a lint warning.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/components/AppSidebar.nav.data.ts'),
      'utf-8'
    );
    expect(source).not.toMatch(/from ['"]@\/lib\/permissions/);
  });
});
