import { describe, it, expect } from 'vitest';
import { buildRolePreview } from '@/lib/permissions/preview';
import { expandAreas, type AreaKey, type AreaLevel } from '@/lib/permissions/areas';

/**
 * Direct unit test for the pure preview derivation
 * (Phase 4 task 9b, roles-and-areas plan, 2026-07-29): `(grants, flags) ->
 * { summary, navPreview, grantCount }`. No React, no queries — this is
 * exactly what the design doc's "The live preview" section asks for
 * ("straightforward to unit test").
 *
 * The prose-summary wording (PHRASE map, the "can/can't" split, the exact
 * four-item blocked-list check, joinList's comma/semicolon switch) is
 * transcribed verbatim from the approved interactive prototype,
 * docs/design-reference/roles-and-areas.html (summarize/PHRASE/joinList),
 * not invented — the design doc itself quotes the Weekend Supervisor
 * sentence this test pins down as its own worked example under "The live
 * preview".
 */

describe('buildRolePreview — grantCount', () => {
  it('is zero when nothing is granted', () => {
    expect(buildRolePreview({}, []).grantCount).toBe(0);
  });

  it('matches expandAreas(grants, flags).length exactly — no separate counting logic to drift', () => {
    const grants: Partial<Record<AreaKey, AreaLevel>> = { inventory: 'manage', scheduling: 'view' };
    const flags: Array<'view:costs'> = ['view:costs'];
    expect(buildRolePreview(grants, flags).grantCount).toBe(expandAreas(grants, flags).length);
  });

  it('increases when a grant is added and again when its level is upgraded', () => {
    const zero = buildRolePreview({}, []).grantCount;
    const viewOnly = buildRolePreview({ inventory: 'view' }, []).grantCount;
    const manage = buildRolePreview({ inventory: 'manage' }, []).grantCount;
    expect(viewOnly).toBeGreaterThan(zero);
    expect(manage).toBeGreaterThan(viewOnly);
  });
});

describe('buildRolePreview — summary', () => {
  it('says nothing is granted when the grant set is empty', () => {
    const { summary } = buildRolePreview({}, []);
    expect(summary).toMatch(/no areas yet/i);
    expect(summary).toMatch(/sign in and see nothing/i);
  });

  it('reproduces the design doc\'s own Weekend Supervisor worked example verbatim', () => {
    // design doc, "The live preview": reports:view, sales:view,
    // scheduling:manage, employees:view, sensitive flags all off.
    const grants: Partial<Record<AreaKey, AreaLevel>> = {
      reports: 'view',
      sales: 'view',
      scheduling: 'manage',
      employees: 'view',
    };
    const { summary } = buildRolePreview(grants, [], 'Weekend Supervisor');
    expect(summary).toBe(
      "Weekend Supervisor can read the dashboard and reports; see POS sales; " +
        "build schedules, fix punches, and run tips; and see the roster. " +
        "Can't touch the books, payroll, team settings, or costs and margins."
    );
  });

  it('drops a "can\'t" clause once its area is granted', () => {
    const withoutBooks = buildRolePreview({ payroll: 'view' }, [], 'X');
    const withBooks = buildRolePreview({ payroll: 'view', books: 'view' }, [], 'X');
    expect(withoutBooks.summary).toMatch(/touch the books/);
    expect(withBooks.summary).not.toMatch(/touch the books/);
  });

  it('drops the costs clause once the view:costs flag is set', () => {
    const withoutFlag = buildRolePreview({ payroll: 'view' }, [], 'X');
    const withFlag = buildRolePreview({ payroll: 'view' }, ['view:costs'], 'X');
    expect(withoutFlag.summary).toMatch(/costs and margins/);
    expect(withFlag.summary).not.toMatch(/costs and margins/);
  });

  it('omits the "can\'t" sentence entirely once nothing is blocked', () => {
    const grants: Partial<Record<AreaKey, AreaLevel>> = {
      books: 'manage',
      payroll: 'manage',
      team: 'manage',
    };
    const { summary } = buildRolePreview(grants, ['view:costs'], 'Owner-ish');
    expect(summary).not.toMatch(/can't/i);
  });

  it('defaults the role name to "This role" when none is given', () => {
    const { summary } = buildRolePreview({ payroll: 'view' }, []);
    expect(summary).toMatch(/^This role can/);
  });
});

describe('buildRolePreview — navPreview', () => {
  it('groups nav items into the three bands, matching AREA_DEFINITIONS', () => {
    const { navPreview } = buildRolePreview({}, []);
    const labels = navPreview.map((g) => g.label);
    expect(labels).toEqual(['Operations', 'Money', 'People & admin']);
  });

  it('marks an item unreachable when its area is not granted', () => {
    const { navPreview } = buildRolePreview({}, []);
    const dashboard = navPreview.flatMap((g) => g.items).find((i) => i.path === '/');
    expect(dashboard).toBeDefined();
    expect(dashboard?.reachable).toBe(false);
    expect(dashboard?.readOnly).toBe(false);
    expect(dashboard?.isLanding).toBe(false);
  });

  it('marks an item reachable and read-only at view level, reachable and not read-only at manage level', () => {
    const viewOnly = buildRolePreview({ inventory: 'view' }, []);
    const inventoryItem = viewOnly.navPreview.flatMap((g) => g.items).find((i) => i.path === '/inventory');
    expect(inventoryItem?.reachable).toBe(true);
    expect(inventoryItem?.readOnly).toBe(true);

    const manage = buildRolePreview({ inventory: 'manage' }, []);
    const inventoryItemManage = manage.navPreview.flatMap((g) => g.items).find((i) => i.path === '/inventory');
    expect(inventoryItemManage?.reachable).toBe(true);
    expect(inventoryItemManage?.readOnly).toBe(false);
  });

  it('tags exactly the highest-priority granted area\'s item as the landing item ("opens here")', () => {
    // AREA_PRIORITY (areas.ts): reports, sales, inventory, purchasing, ... —
    // inventory outranks scheduling.
    const grants: Partial<Record<AreaKey, AreaLevel>> = { scheduling: 'view', inventory: 'manage' };
    const { navPreview } = buildRolePreview(grants, []);
    const items = navPreview.flatMap((g) => g.items);
    const landingItems = items.filter((i) => i.isLanding);
    expect(landingItems).toHaveLength(1);
    expect(landingItems[0].path).toBe('/inventory');
  });

  it('renders one row per nav item when two areas share a path, at the higher level', () => {
    // `team` and `collaborators` both land on /team (AREA_LANDING_PATHS), and
    // the sidebar shows that item once — so the preview must not list "Team"
    // twice, and the row reflects whichever area grants more.
    const { navPreview } = buildRolePreview({ team: 'view', collaborators: 'manage' }, []);
    const teamItems = navPreview.flatMap((g) => g.items).filter((i) => i.path === '/team');
    expect(teamItems).toHaveLength(1);
    expect(teamItems[0].reachable).toBe(true);
    expect(teamItems[0].readOnly).toBe(false);

    const viewOnly = buildRolePreview({ team: 'view' }, []);
    const viewTeam = viewOnly.navPreview.flatMap((g) => g.items).filter((i) => i.path === '/team');
    expect(viewTeam).toHaveLength(1);
    expect(viewTeam[0].readOnly).toBe(true);
  });

  it('real labels are read from the actual sidebar nav data, not re-typed here', () => {
    const { navPreview } = buildRolePreview({}, []);
    const items = navPreview.flatMap((g) => g.items);
    const dashboard = items.find((i) => i.path === '/');
    const inventory = items.find((i) => i.path === '/inventory');
    const settings = items.find((i) => i.path === '/settings');
    expect(dashboard?.label).toBe('Dashboard');
    expect(inventory?.label).toBe('Inventory');
    expect(settings?.label).toBe('Settings');
  });
});
