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
