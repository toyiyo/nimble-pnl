import { describe, it, expect } from 'vitest';
import {
  AREA_DEFINITIONS,
  expandAreas,
  type AreaKey,
  type AreaLevel,
} from '@/lib/permissions/areas';
import { ROLE_CAPABILITIES } from '@/lib/permissions/definitions';
import type { Capability } from '@/lib/permissions/types';

// ============================================================
// These tests mirror supabase/migrations/20260730100000_roles_and_areas_tables.sql
// (area_catalog seed) and 20260730110000_seed_builtin_roles.sql (role_areas
// seed) literally, transcribed independently rather than derived from the
// SQL, per the [2026-07-09] lesson about non-self-referential round trips.
// ============================================================

const ALL_AREA_KEYS: AreaKey[] = [
  'reports',
  'sales',
  'inventory',
  'purchasing',
  'recipes',
  'scheduling',
  'reviews',
  'books',
  'chart_of_accounts',
  'payroll',
  'employees',
  'team',
  'collaborators',
  'settings',
  'integrations',
];

function grantsAt(level: AreaLevel, keys: AreaKey[] = ALL_AREA_KEYS): Partial<Record<AreaKey, AreaLevel>> {
  const grants: Partial<Record<AreaKey, AreaLevel>> = {};
  for (const key of keys) grants[key] = level;
  return grants;
}

describe('AREA_DEFINITIONS', () => {
  it('defines exactly eleven areas', () => {
    expect(AREA_DEFINITIONS.length).toBe(11);
  });

  it('groups areas into exactly three bands, matching area_catalog', () => {
    const byBand = new Map<string, string[]>();
    for (const area of AREA_DEFINITIONS) {
      byBand.set(area.band, [...(byBand.get(area.band) ?? []), area.key]);
    }
    expect(byBand.get('Operations')).toEqual(['reports', 'sales', 'inventory', 'recipes', 'scheduling', 'reviews']);
    expect(byBand.get('Money')).toEqual(['books', 'payroll']);
    expect(byBand.get('People & admin')).toEqual(['employees', 'team', 'settings']);
  });

  it('caps Team & Access at no grantable level (privilege-escalation guard)', () => {
    const team = AREA_DEFINITIONS.find((a) => a.key === 'team');
    expect(team?.maxLevelForCollaborator).toBeNull();
  });

  it('caps Dashboard & Reports, Sales, Payroll, Settings & Integrations at view for collaborators', () => {
    const capped = ['reports', 'sales', 'payroll', 'settings'];
    for (const key of capped) {
      const area = AREA_DEFINITIONS.find((a) => a.key === key);
      expect(area?.maxLevelForCollaborator, `${key} cap`).toBe('view');
    }
  });

  it('every area definition expands to a non-empty capability set at its own manage level', () => {
    for (const area of AREA_DEFINITIONS) {
      const grants = grantsAt('manage', [...area.areaKeys]);
      const caps = expandAreas(grants, []);
      expect(caps.length, `${area.key} should grant at least one capability`).toBeGreaterThan(0);
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
    expect(expandAreas({ books: 'view' }, [])).toContain('view:assets');
    expect(expandAreas({ books: 'view' }, [])).not.toContain('edit:assets');
    expect(expandAreas({ books: 'manage' }, [])).toContain('view:assets');
    expect(expandAreas({ books: 'manage' }, [])).toContain('edit:assets');
  });

  it('grants view:ai_assistant only when reports is at manage (matches the legacy CASE, minus the subscription gate)', () => {
    expect(expandAreas({ reports: 'view' }, [])).not.toContain('view:ai_assistant');
    expect(expandAreas({ reports: 'manage' }, [])).toContain('view:ai_assistant');
  });

  it('grants view:financial_intelligence at either books tier (matches the legacy CASE, minus the subscription gate)', () => {
    expect(expandAreas({ books: 'view' }, [])).toContain('view:financial_intelligence');
    expect(expandAreas({ books: 'manage' }, [])).toContain('view:financial_intelligence');
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
// supabase/migrations/20260730110000_seed_builtin_roles.sql's role_areas
// INSERT — not derived from ROLE_CAPABILITIES — so a mismatch here is a real
// regression in either the seed or this file, not a tautology.
// ============================================================

describe('expandAreas reconstructs each builtin from its seeded area grants', () => {
  it('Owner', () => {
    const grants: Partial<Record<AreaKey, AreaLevel>> = {
      reports: 'manage', sales: 'view', inventory: 'manage', purchasing: 'manage',
      recipes: 'manage', scheduling: 'manage', reviews: 'manage', books: 'manage', chart_of_accounts: 'manage',
      payroll: 'manage', employees: 'manage', team: 'manage', collaborators: 'manage',
      settings: 'manage', integrations: 'manage',
    };
    const result = new Set(expandAreas(grants));
    const expected = new Set([...ROLE_CAPABILITIES.owner, 'view:assets', 'edit:assets']);
    expect(result).toEqual(expected);
  });

  it('Manager', () => {
    const grants: Partial<Record<AreaKey, AreaLevel>> = {
      reports: 'manage', sales: 'view', inventory: 'manage', purchasing: 'manage',
      recipes: 'manage', scheduling: 'manage', reviews: 'manage', books: 'manage', chart_of_accounts: 'view',
      payroll: 'manage', employees: 'manage', team: 'manage', collaborators: 'manage',
      settings: 'view', integrations: 'view',
    };
    const result = new Set(expandAreas(grants));
    const expected = new Set([...ROLE_CAPABILITIES.manager, 'view:assets', 'edit:assets']);
    expect(result).toEqual(expected);
  });

  it('Operations Manager', () => {
    const grants: Partial<Record<AreaKey, AreaLevel>> = {
      reports: 'manage', sales: 'view', inventory: 'manage', purchasing: 'manage',
      recipes: 'manage', scheduling: 'manage', reviews: 'manage', payroll: 'manage', employees: 'manage',
      team: 'manage', settings: 'view',
    };
    const result = new Set(expandAreas(grants));
    const expected = new Set(ROLE_CAPABILITIES.operations_manager);
    expect(result).toEqual(expected);
  });

  it('Chef', () => {
    const grants: Partial<Record<AreaKey, AreaLevel>> = {
      reports: 'view', sales: 'view', inventory: 'manage', purchasing: 'view',
      recipes: 'manage', scheduling: 'view', reviews: 'view', settings: 'view',
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
      books: 'manage', chart_of_accounts: 'manage', payroll: 'view', employees: 'view',
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
      inventory: 'manage', purchasing: 'manage', settings: 'view',
    };
    const result = new Set(expandAreas(grants));
    const expected = new Set(ROLE_CAPABILITIES.collaborator_inventory);
    expect(result).toEqual(expected);
  });

  it('Recipe Consultant', () => {
    const grants: Partial<Record<AreaKey, AreaLevel>> = {
      inventory: 'view', recipes: 'manage', settings: 'view',
    };
    const result = new Set(expandAreas(grants));
    const expected = new Set(ROLE_CAPABILITIES.collaborator_chef);
    expect(result).toEqual(expected);
  });

  it('Operations Manager (Collaborator)', () => {
    const grants: Partial<Record<AreaKey, AreaLevel>> = {
      reports: 'manage', sales: 'view', inventory: 'manage', purchasing: 'manage',
      recipes: 'manage', scheduling: 'manage', payroll: 'view', employees: 'view',
      settings: 'view',
    };
    const result = new Set(expandAreas(grants));
    const expected = new Set(ROLE_CAPABILITIES.collaborator_operations_manager);
    expect(result).toEqual(expected);
  });
});
