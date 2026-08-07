import { describe, it, expect } from 'vitest';
import {
  AREA_DEFINITIONS,
  PAGE_AREAS,
  expandAreas,
  type AreaKey,
  type AreaLevel,
} from '@/lib/permissions/areas';
import { navigationGroups } from '@/components/AppSidebar.nav.data';
import { ROLE_CAPABILITIES } from '@/lib/permissions/definitions';
import type { Capability } from '@/lib/permissions/types';

describe('areas.ts derives from the sidebar', () => {
  it('has exactly one area per gateable sidebar page — the drift alarm', () => {
    const navPaths = navigationGroups
      .flatMap((g) => g.items.map((i) => i.path))
      .filter((p) => p !== '/help');
    const areaPaths = PAGE_AREAS.map((a) => a.path);

    // `/team` carries two areas (team + collaborators), so compare as sets.
    // A page added to AppSidebar.nav.data.ts with no PAGE_AREAS entry fails
    // here rather than becoming silently ungrantable — which is how /budget,
    // /labor, /stripe-account, /ops-inbox and /weekly-brief went unreachable.
    expect(new Set(areaPaths)).toEqual(new Set(navPaths));
  });

  it('groups and orders areas exactly as the sidebar does', () => {
    const navGroupLabels = navigationGroups.map((g) => g.label);
    const defGroupLabels = [...new Set(AREA_DEFINITIONS.map((d) => d.uiGroup))];
    expect(defGroupLabels).toEqual(navGroupLabels);
  });

  it('locks manage on pages with no edit capability', () => {
    const readOnly = ['dashboard', 'sales', 'ops_inbox', 'weekly_brief', 'labor',
                      'budget', 'stripe_account', 'financial_statements',
                      'financial_intelligence'];
    for (const key of readOnly) {
      expect(PAGE_AREAS.find((a) => a.key === key)?.hasManageTier).toBe(false);
    }
  });

  it('keeps team and collaborators ungrantable to collaborator roles', () => {
    for (const key of ['team', 'collaborators'] as const) {
      expect(PAGE_AREAS.find((a) => a.key === key)?.maxLevelForCollaborator).toBeNull();
    }
  });
});

// ============================================================
// These tests mirror supabase/migrations/20260805120000_page_areas.sql
// (area_catalog re-cut and role_areas fan-out) literally, transcribed
// independently rather than derived from the SQL, per the [2026-07-09]
// lesson about non-self-referential round trips.
// ============================================================

const ALL_AREA_KEYS: AreaKey[] = [
  'dashboard',
  'integrations',
  'sales',
  'ops_inbox',
  'reviews',
  'weekly_brief',
  'scheduling',
  'time_punches',
  'tips',
  'payroll',
  'labor',
  'recipes',
  'prep_recipes',
  'inventory',
  'inventory_audit',
  'purchasing',
  'reports',
  'budget',
  'customers',
  'invoices',
  'stripe_account',
  'banking',
  'expenses',
  'print_checks',
  'assets',
  'financial_intelligence',
  'transactions',
  'chart_of_accounts',
  'financial_statements',
  'employees',
  'team',
  'collaborators',
  'settings',
];

/** Areas with no capability at all (spec §3.4) — gated purely by routing. */
const CAPABILITYLESS_AREAS: AreaKey[] = ['ops_inbox', 'weekly_brief', 'budget', 'labor', 'stripe_account'];

function grantsAt(level: AreaLevel, keys: AreaKey[] = ALL_AREA_KEYS): Partial<Record<AreaKey, AreaLevel>> {
  const grants: Partial<Record<AreaKey, AreaLevel>> = {};
  for (const key of keys) grants[key] = level;
  return grants;
}

describe('AREA_DEFINITIONS', () => {
  it('defines exactly 33 areas', () => {
    expect(AREA_DEFINITIONS).toHaveLength(33);
  });

  it('caps Team & Access at no grantable level (privilege-escalation guard)', () => {
    for (const key of ['team', 'collaborators']) {
      const area = AREA_DEFINITIONS.find((a) => a.key === key);
      expect(area?.maxLevelForCollaborator, `${key} cap`).toBeNull();
    }
  });

  it('caps Dashboard, Reports, Sales, Payroll, Settings at view for collaborators', () => {
    const capped = ['dashboard', 'reports', 'sales', 'payroll', 'settings'];
    for (const key of capped) {
      const area = AREA_DEFINITIONS.find((a) => a.key === key);
      expect(area?.maxLevelForCollaborator, `${key} cap`).toBe('view');
    }
  });

  it('every area definition with a capability expands to a non-empty set at its own manage level', () => {
    for (const area of AREA_DEFINITIONS) {
      if (CAPABILITYLESS_AREAS.includes(area.key)) continue;
      const grants = grantsAt('manage', [area.key]);
      const caps = expandAreas(grants, []);
      expect(caps.length, `${area.key} should grant at least one capability`).toBeGreaterThan(0);
    }
  });

  it('the five capability-less areas expand to nothing even at manage (spec §3.4)', () => {
    for (const key of CAPABILITYLESS_AREAS) {
      const caps = expandAreas(grantsAt('manage', [key as AreaKey]), []);
      expect(caps, key).toEqual([]);
    }
  });

  it('caps Reviews at view for collaborators', () => {
    const reviews = AREA_DEFINITIONS.find((a) => a.key === 'reviews');
    expect(reviews?.maxLevelForCollaborator).toBe('view');
  });
});

describe('expandAreas', () => {
  it('returns nothing for an empty grant set and no flags (kiosk shape)', () => {
    expect(expandAreas({}, [])).toEqual([]);
  });

  it('view:assets/edit:assets are present in the union, closing the SQL/TypeScript drift', () => {
    expect(expandAreas({ assets: 'view' }, [])).toContain('view:assets');
    expect(expandAreas({ assets: 'view' }, [])).not.toContain('edit:assets');
    expect(expandAreas({ assets: 'manage' }, [])).toContain('view:assets');
    expect(expandAreas({ assets: 'manage' }, [])).toContain('edit:assets');
  });

  it('grants view:ai_assistant only when reports is at manage (matches the legacy CASE, minus the subscription gate)', () => {
    expect(expandAreas({ reports: 'view' }, [])).not.toContain('view:ai_assistant');
    expect(expandAreas({ reports: 'manage' }, [])).toContain('view:ai_assistant');
  });

  it('grants view:financial_intelligence at either financial_intelligence tier (matches the legacy CASE, minus the subscription gate)', () => {
    expect(expandAreas({ financial_intelligence: 'view' }, [])).toContain('view:financial_intelligence');
    expect(expandAreas({ financial_intelligence: 'manage' }, [])).toContain('view:financial_intelligence');
  });

  // Expenses.tsx reads pending_outflows unconditionally via
  // usePendingOutflows(), so an Expenses grant with no Print Checks area at
  // all must still carry the pending_outflows capabilities that table's RLS
  // checks — the client-side mirror of the SQL OR-across-two-areas fix for
  // the P1 finding on 20260805120000_page_areas.sql.
  it('should grant pending_outflows capabilities when expenses is granted without print_checks', () => {
    expect(expandAreas({ expenses: 'view' }, [])).toContain('view:pending_outflows');
    expect(expandAreas({ expenses: 'view' }, [])).not.toContain('edit:pending_outflows');
    expect(expandAreas({ expenses: 'manage' }, [])).toContain('view:pending_outflows');
    expect(expandAreas({ expenses: 'manage' }, [])).toContain('edit:pending_outflows');
  });

  it('manage is a superset of view (no capability is lost going from view to manage)', () => {
    const viewCaps = new Set(expandAreas(grantsAt('view')));
    const manageCaps = new Set(expandAreas(grantsAt('manage')));
    for (const cap of viewCaps) {
      expect(manageCaps.has(cap), `manage should retain ${cap}`).toBe(true);
    }
  });

  it('sensitive flags are independent of area grants', () => {
    const caps = expandAreas({}, ['view:costs', 'view:pay_rates', 'view:employee_pii']);
    expect(caps).toEqual(
      expect.arrayContaining(['view:costs', 'view:pay_rates', 'view:employee_pii'])
    );
  });

  it('expanding all areas at manage plus all three flags yields exactly the owner capability set', () => {
    const result = new Set<Capability>(
      expandAreas(grantsAt('manage'), ['view:costs', 'view:pay_rates', 'view:employee_pii'])
    );

    // ROLE_CAPABILITIES.owner plus the two capabilities that exist in the SQL
    // CASE but were missing from the TypeScript union (design's defect 1),
    // plus the three brand-new sensitive-data flags this design introduces.
    const expected = new Set<Capability>([
      ...ROLE_CAPABILITIES.owner,
      'view:assets',
      'edit:assets',
      'view:costs',
      'view:pay_rates',
      'view:employee_pii',
    ]);

    expect(result).toEqual(expected);
  });
});

// ============================================================
// Per-role reconstruction, transcribed literally from
// supabase/migrations/20260805120000_page_areas.sql's role_areas fan-out
// (Step 3: books -> its nine successor pages, reports -> +dashboard:view,
// scheduling:manage -> +time_punches/tips:manage, inventory:manage ->
// +inventory_audit:manage, recipes -> +prep_recipes at the same level) —
// not derived from ROLE_CAPABILITIES — so a mismatch here is a real
// regression in either the seed or this file, not a tautology.
// ============================================================

describe('expandAreas reconstructs each builtin from its seeded area grants', () => {
  it('Owner', () => {
    const grants: Partial<Record<AreaKey, AreaLevel>> = {
      dashboard: 'view', reports: 'manage', sales: 'view',
      inventory: 'manage', inventory_audit: 'manage', purchasing: 'manage',
      recipes: 'manage', prep_recipes: 'manage',
      scheduling: 'manage', time_punches: 'manage', tips: 'manage',
      reviews: 'manage',
      transactions: 'manage', banking: 'manage', expenses: 'manage', invoices: 'manage',
      // financial_statements/financial_intelligence stay at 'view' — the
      // migration's area_catalog rows for both carry no 'manage' tier
      // (20260805120000_page_areas.sql clamps them to 'view'), so books:'manage'
      // fans out onto these two at 'view', not 'manage'.
      customers: 'manage', financial_statements: 'view', financial_intelligence: 'view',
      assets: 'manage', print_checks: 'manage',
      chart_of_accounts: 'manage',
      payroll: 'manage', employees: 'manage', team: 'manage', collaborators: 'manage',
      settings: 'manage', integrations: 'manage',
    };
    const result = new Set(expandAreas(grants));
    const expected = new Set([...ROLE_CAPABILITIES.owner, 'view:assets', 'edit:assets']);
    expect(result).toEqual(expected);
  });

  it('Manager', () => {
    const grants: Partial<Record<AreaKey, AreaLevel>> = {
      dashboard: 'view', reports: 'manage', sales: 'view',
      inventory: 'manage', inventory_audit: 'manage', purchasing: 'manage',
      recipes: 'manage', prep_recipes: 'manage',
      scheduling: 'manage', time_punches: 'manage', tips: 'manage',
      reviews: 'manage',
      transactions: 'manage', banking: 'manage', expenses: 'manage', invoices: 'manage',
      customers: 'manage', financial_statements: 'view', financial_intelligence: 'view',
      assets: 'manage', print_checks: 'manage',
      chart_of_accounts: 'view',
      payroll: 'manage', employees: 'manage', team: 'manage', collaborators: 'manage',
      settings: 'view', integrations: 'view',
    };
    const result = new Set(expandAreas(grants));
    const expected = new Set([...ROLE_CAPABILITIES.manager, 'view:assets', 'edit:assets']);
    expect(result).toEqual(expected);
  });

  it('Operations Manager', () => {
    const grants: Partial<Record<AreaKey, AreaLevel>> = {
      dashboard: 'view', reports: 'manage', sales: 'view',
      inventory: 'manage', inventory_audit: 'manage', purchasing: 'manage',
      recipes: 'manage', prep_recipes: 'manage',
      scheduling: 'manage', time_punches: 'manage', tips: 'manage',
      reviews: 'manage', payroll: 'manage', employees: 'manage',
      team: 'manage', settings: 'view',
    };
    const result = new Set(expandAreas(grants));
    const expected = new Set(ROLE_CAPABILITIES.operations_manager);
    expect(result).toEqual(expected);
  });

  it('Chef', () => {
    const grants: Partial<Record<AreaKey, AreaLevel>> = {
      dashboard: 'view', reports: 'view', sales: 'view',
      inventory: 'manage', inventory_audit: 'manage', purchasing: 'view',
      recipes: 'manage', prep_recipes: 'manage',
      scheduling: 'view', reviews: 'view', settings: 'view',
    };
    const result = new Set(expandAreas(grants));
    const expected = new Set(ROLE_CAPABILITIES.chef);
    expect(result).toEqual(expected);
  });

  it('Employee (self-service) — settings only, matches ROLE_CAPABILITIES.staff', () => {
    const grants: Partial<Record<AreaKey, AreaLevel>> = { settings: 'view' };
    const result = new Set(expandAreas(grants));
    const expected = new Set(ROLE_CAPABILITIES.staff);
    expect(result).toEqual(expected);
  });

  it('Kiosk — zero role_areas rows, matches ROLE_CAPABILITIES.kiosk', () => {
    const result = new Set(expandAreas({}));
    const expected = new Set(ROLE_CAPABILITIES.kiosk);
    expect(result).toEqual(expected);
  });

  it('Accountant', () => {
    const grants: Partial<Record<AreaKey, AreaLevel>> = {
      transactions: 'manage', banking: 'manage', expenses: 'manage', invoices: 'manage',
      customers: 'manage', financial_statements: 'view', financial_intelligence: 'view',
      assets: 'manage', print_checks: 'manage',
      chart_of_accounts: 'manage', payroll: 'view', employees: 'view',
      settings: 'view',
    };
    const result = new Set(expandAreas(grants));
    // books@manage newly includes view:assets/edit:assets (defect 1, closed):
    // the legacy SQL CASE already granted both to collaborator_accountant
    // (`WHEN 'view:assets' THEN v_role IN ('owner', 'manager',
    // 'collaborator_accountant')`); ROLE_CAPABILITIES never had them.
    const expected = new Set([...ROLE_CAPABILITIES.collaborator_accountant, 'view:assets', 'edit:assets']);
    expect(result).toEqual(expected);
  });

  it('Inventory Helper', () => {
    const grants: Partial<Record<AreaKey, AreaLevel>> = {
      inventory: 'manage', inventory_audit: 'manage', purchasing: 'manage', settings: 'view',
    };
    const result = new Set(expandAreas(grants));
    const expected = new Set(ROLE_CAPABILITIES.collaborator_inventory);
    expect(result).toEqual(expected);
  });

  it('Recipe Consultant', () => {
    const grants: Partial<Record<AreaKey, AreaLevel>> = {
      inventory: 'view', recipes: 'manage', prep_recipes: 'manage', settings: 'view',
    };
    const result = new Set(expandAreas(grants));
    const expected = new Set(ROLE_CAPABILITIES.collaborator_chef);
    expect(result).toEqual(expected);
  });

  it('Operations Manager (Collaborator)', () => {
    const grants: Partial<Record<AreaKey, AreaLevel>> = {
      dashboard: 'view', reports: 'manage', sales: 'view',
      inventory: 'manage', inventory_audit: 'manage', purchasing: 'manage',
      recipes: 'manage', prep_recipes: 'manage',
      scheduling: 'manage', time_punches: 'manage', tips: 'manage',
      payroll: 'view', employees: 'view', settings: 'view',
    };
    const result = new Set(expandAreas(grants));
    const expected = new Set(ROLE_CAPABILITIES.collaborator_operations_manager);
    expect(result).toEqual(expected);
  });
});
