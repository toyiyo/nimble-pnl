/**
 * The area model (roles-and-areas design)
 *
 * An "area" is a named bundle of existing `view:*`/`edit:*` capability pairs,
 * granted at one of three levels: no access, `'view'`, or `'manage'`. This is
 * the client-side mirror of the SQL seed — every mapping below is transcribed
 * literally (not derived) from:
 *
 *   - supabase/migrations/20260730100000_roles_and_areas_tables.sql
 *     (`area_catalog`: the fourteen `area_key`s, their `ui_group`/`band`
 *     grouping, and `max_level_collaborator`)
 *   - supabase/migrations/20260730140000_user_has_capability_from_areas.sql
 *     (the capability -> (area_key, required_level) map used by
 *     `user_has_capability` for the `role_id IS NOT NULL` path)
 *
 * If either SQL source changes, this file must change with it — that is the
 * whole point of "single source of truth mirroring the SQL seed" from the
 * design doc (docs/superpowers/specs/2026-07-29-roles-and-areas-design.md).
 *
 * Ten rows in the editor, fourteen areas underneath: the design's ten bands
 * (what `AREA_DEFINITIONS` exposes) collapse four pairs of `area_key`s
 * (inventory+purchasing, books+chart_of_accounts, team+collaborators,
 * settings+integrations) onto one editor row each. The split exists because
 * the six builtin roles do not partition cleanly along ten coarse areas —
 * e.g. `collaborator_chef` holds `view:inventory` without
 * `view:purchase_orders`. `expandAreas` operates on the full fourteen
 * `AreaKey`s (matching what `role_areas` actually stores per row), while
 * `AREA_DEFINITIONS` is the ten-row UI grouping built on top of them.
 */

import type { Capability } from './types';

/**
 * The fourteen SQL area_keys — the actual grant granularity stored in
 * `role_areas`. Matches area_catalog.area_key exactly.
 */
export type AreaKey =
  | 'reports'
  | 'sales'
  | 'inventory'
  | 'purchasing'
  | 'recipes'
  | 'scheduling'
  | 'books'
  | 'chart_of_accounts'
  | 'payroll'
  | 'employees'
  | 'team'
  | 'collaborators'
  | 'settings'
  | 'integrations';

/** The grant level for one area_key. No third "none" value — omit the key instead. */
export type AreaLevel = 'view' | 'manage';

/** The three cross-cutting sensitive-data switches, resolved from `role_flags`. */
export type SensitiveFlag = 'view:costs' | 'view:pay_rates' | 'view:employee_pii';

/** The three bands the editor groups areas into. Matches area_catalog.band. */
export type Band = 'Operations' | 'Money' | 'People & admin';

/**
 * One row in the role editor. `areaKeys` lists the underlying `area_key`(s)
 * this row writes when its control is toggled — more than one for the four
 * split rows.
 */
/**
 * The ten `ui_group` keys from area_catalog, as a closed union.
 *
 * Deliberately a union rather than `string`: three maps elsewhere are keyed by
 * it (`AREA_HINT` and `AREA_LOCK_REASON` in `RoleEditor.tsx`, `PHRASE` in
 * `./preview.ts`), and with `string` a renamed or added row here would resolve
 * to `undefined` at runtime instead of failing the build.
 */
export type AreaGroupKey =
  | 'reports'
  | 'sales'
  | 'inventory'
  | 'recipes'
  | 'scheduling'
  | 'books'
  | 'payroll'
  | 'employees'
  | 'team'
  | 'settings';

export interface AreaDefinition {
  /** The ui_group key from area_catalog. */
  key: AreaGroupKey;
  label: string;
  band: Band;
  /** area_catalog.sort_order, shared by every area_key in the group. */
  sortOrder: number;
  /** The area_key(s) this editor row grants. */
  areaKeys: readonly AreaKey[];
  /**
   * The highest level a collaborator-flavored custom role can be granted for
   * this area. `null` means ungrantable at any level — Team & Access, the
   * privilege-escalation guard the design calls out explicitly (a
   * collaborator role that could edit roles could mint itself owner-level
   * access). Enforced in SQL by `role_areas_enforce_collaborator_cap`; this
   * value only drives the editor's disabled state, so the two cannot drift
   * because both read area_catalog.max_level_collaborator.
   */
  maxLevelForCollaborator: AreaLevel | null;
}

/**
 * The ten editor rows, in the design's fixed order (Operations, then Money,
 * then People & admin bands). Matches area_catalog's (ui_group, band,
 * sort_order, max_level_collaborator) columns exactly.
 */
export const AREA_DEFINITIONS: readonly AreaDefinition[] = [
  {
    key: 'reports',
    label: 'Dashboard & Reports',
    band: 'Operations',
    sortOrder: 1,
    areaKeys: ['reports'],
    maxLevelForCollaborator: 'view',
  },
  {
    key: 'sales',
    label: 'Sales',
    band: 'Operations',
    sortOrder: 2,
    areaKeys: ['sales'],
    maxLevelForCollaborator: 'view',
  },
  {
    key: 'inventory',
    label: 'Inventory & Purchasing',
    band: 'Operations',
    sortOrder: 3,
    areaKeys: ['inventory', 'purchasing'],
    maxLevelForCollaborator: 'manage',
  },
  {
    key: 'recipes',
    label: 'Recipes',
    band: 'Operations',
    sortOrder: 4,
    areaKeys: ['recipes'],
    maxLevelForCollaborator: 'manage',
  },
  {
    key: 'scheduling',
    label: 'Scheduling',
    band: 'Operations',
    sortOrder: 5,
    areaKeys: ['scheduling'],
    maxLevelForCollaborator: 'manage',
  },
  {
    key: 'books',
    label: 'Money & Books',
    band: 'Money',
    sortOrder: 6,
    areaKeys: ['books', 'chart_of_accounts'],
    maxLevelForCollaborator: 'manage',
  },
  {
    key: 'payroll',
    label: 'Payroll',
    band: 'Money',
    sortOrder: 7,
    areaKeys: ['payroll'],
    maxLevelForCollaborator: 'view',
  },
  {
    key: 'employees',
    label: 'Employees',
    band: 'People & admin',
    sortOrder: 8,
    areaKeys: ['employees'],
    maxLevelForCollaborator: 'manage',
  },
  {
    key: 'team',
    label: 'Team & Access',
    band: 'People & admin',
    sortOrder: 9,
    areaKeys: ['team', 'collaborators'],
    // Ungrantable at any level to a collaborator role — see the doc comment
    // on AreaDefinition.maxLevelForCollaborator.
    maxLevelForCollaborator: null,
  },
  {
    key: 'settings',
    label: 'Settings & Integrations',
    band: 'People & admin',
    sortOrder: 10,
    areaKeys: ['settings', 'integrations'],
    maxLevelForCollaborator: 'view',
  },
];

interface AreaCapabilities {
  /** Capabilities granted once the area is at 'view' (or 'manage', which is a superset). */
  view: readonly Capability[];
  /** Additional capabilities granted once the area is at 'manage'. */
  manageAdds: readonly Capability[];
}

/**
 * The fourteen area_keys' capability bundles. Transcribed literally from the
 * capability -> (area_key, required_level) VALUES map in
 * user_has_capability (20260730140000_user_has_capability_from_areas.sql):
 * every capability whose required_level is 'view' lands in that area's
 * `view` list here, every 'manage' one lands in `manageAdds`.
 *
 * `view:ai_assistant` and `view:financial_intelligence` are included
 * unconditionally here, exactly as ROLE_CAPABILITIES does today — the SQL
 * ANDs them with `has_subscription_feature(...)`, but that is a runtime,
 * per-restaurant subscription check with no place in a pure (grants, flags)
 * -> Capability[] function, and today's static ROLE_CAPABILITIES table
 * already grants them unconditionally by role. Subscription gating happens
 * downstream of this function, same as it does today downstream of
 * ROLE_CAPABILITIES.
 */
const AREA_CAPABILITIES: Record<AreaKey, AreaCapabilities> = {
  reports: {
    view: ['view:dashboard', 'view:reports'],
    manageAdds: ['view:ai_assistant'],
  },
  sales: {
    view: ['view:pos_sales'],
    manageAdds: [],
  },
  inventory: {
    view: ['view:inventory'],
    manageAdds: [
      'edit:inventory',
      'view:inventory_audit',
      'edit:inventory_audit',
      'view:receipt_import',
      'edit:receipt_import',
      'view:inventory_transactions',
      'edit:inventory_transactions',
    ],
  },
  purchasing: {
    view: ['view:purchase_orders'],
    manageAdds: ['edit:purchase_orders'],
  },
  recipes: {
    view: ['view:recipes', 'view:prep_recipes', 'view:batches'],
    manageAdds: ['edit:recipes', 'edit:prep_recipes', 'edit:batches'],
  },
  scheduling: {
    view: ['view:scheduling'],
    manageAdds: ['edit:scheduling', 'view:tips', 'edit:tips', 'view:time_punches', 'edit:time_punches'],
  },
  books: {
    view: [
      'view:transactions',
      'view:banking',
      'view:expenses',
      'view:financial_statements',
      'view:invoices',
      'view:customers',
      'view:financial_intelligence',
      'view:pending_outflows',
      'view:assets',
    ],
    manageAdds: [
      'edit:transactions',
      'edit:banking',
      'edit:expenses',
      'edit:invoices',
      'edit:customers',
      'edit:pending_outflows',
      'edit:assets',
    ],
  },
  chart_of_accounts: {
    view: ['view:chart_of_accounts'],
    manageAdds: ['edit:chart_of_accounts'],
  },
  payroll: {
    view: ['view:payroll'],
    manageAdds: ['edit:payroll'],
  },
  employees: {
    view: ['view:employees'],
    manageAdds: ['manage:employees'],
  },
  team: {
    view: ['view:team'],
    manageAdds: ['manage:team'],
  },
  collaborators: {
    view: ['view:collaborators'],
    manageAdds: ['manage:collaborators'],
  },
  settings: {
    view: ['view:settings'],
    manageAdds: ['edit:settings'],
  },
  integrations: {
    view: ['view:integrations'],
    manageAdds: ['manage:integrations'],
  },
};

/**
 * Expands a role's area grants and sensitive-data flags into the flat
 * capability set it holds — the client-side mirror of what
 * `user_has_capability` computes per-capability in SQL for a `role_id IS NOT
 * NULL` membership.
 *
 * `grants` is keyed by the fourteen `AreaKey`s (matching `role_areas` rows,
 * not the ten editor rows) so a builtin's split grant — e.g.
 * `operations_manager` holding `settings: 'view'` without `integrations` —
 * is represented exactly, including cases the ten-row editor cannot express
 * for a builtin.
 *
 * `flags` are independent of area grants: a granted flag is included in the
 * output as-is, matching the SQL, which checks `role_flags` directly for
 * `view:costs`/`view:pay_rates`/`view:employee_pii` rather than resolving
 * them through any area.
 */
export function expandAreas(
  grants: Partial<Record<AreaKey, AreaLevel>>,
  flags: readonly SensitiveFlag[] = []
): Capability[] {
  const capabilities = new Set<Capability>();

  for (const areaKey of Object.keys(grants) as AreaKey[]) {
    const level = grants[areaKey];
    if (!level) continue;

    const bundle = AREA_CAPABILITIES[areaKey];
    if (!bundle) continue;

    for (const capability of bundle.view) capabilities.add(capability);
    if (level === 'manage') {
      for (const capability of bundle.manageAdds) capabilities.add(capability);
    }
  }

  for (const flag of flags) capabilities.add(flag);

  return Array.from(capabilities);
}

/**
 * One representative nav path per `area_key` — the page a role holding that
 * area lands on, and (via `AREA_PRIORITY`) the page it lands on by default.
 * Moved here (out of `usePermissions.ts`, where this lived until task 9b)
 * so `preview.ts`'s live preview and `usePermissions.ts`'s `landingPath` both
 * read one copy rather than risking two hand-maintained lists drifting apart.
 * Paths mirror the builtin `landingPath`s already in `ROLE_METADATA`
 * (definitions.ts) — e.g. `collaborator_operations_manager` -> `/scheduling`,
 * `collaborator_inventory` -> `/inventory` — so a custom role built from the
 * same areas lands in the same place a builtin with that area would.
 */
export const AREA_LANDING_PATHS: Record<AreaKey, string> = {
  reports: '/',
  sales: '/pos-sales',
  inventory: '/inventory',
  purchasing: '/purchase-orders',
  recipes: '/recipes',
  scheduling: '/scheduling',
  books: '/transactions',
  chart_of_accounts: '/chart-of-accounts',
  payroll: '/payroll',
  employees: '/employees',
  team: '/team',
  collaborators: '/team',
  settings: '/settings',
  integrations: '/integrations',
};

/**
 * Priority order for picking a landing path (or, in `preview.ts`, the "opens
 * here" nav item) when multiple areas are granted — mirrors
 * `AREA_DEFINITIONS`' band ordering (Operations, then Money, then People &
 * admin).
 */
export const AREA_PRIORITY: readonly AreaKey[] = [
  'reports',
  'sales',
  'inventory',
  'purchasing',
  'recipes',
  'scheduling',
  'books',
  'chart_of_accounts',
  'payroll',
  'employees',
  'team',
  'collaborators',
  'settings',
  'integrations',
];

/**
 * A role's area rows collapsed into the level-per-`area_key` map that
 * `expandAreas`, `rowLevel`, `landingAreaKey` and the chip renderer all take.
 *
 * Lives here, beside the keys it produces, rather than next to the query that
 * fetches the rows: three screens derive chips from a role's grants (the roles
 * list, the editor, the collaborator invite picker), and their tests mock the
 * hook module wholesale — a derivation parked there disappears under the mock.
 */
export function grantMap(
  areas: ReadonlyArray<{ area_key: AreaKey; level: AreaLevel }>
): Partial<Record<AreaKey, AreaLevel>> {
  const map: Partial<Record<AreaKey, AreaLevel>> = {};
  for (const grant of areas) {
    map[grant.area_key] = grant.level;
  }
  return map;
}

/** The first `area_key` in `AREA_PRIORITY` that `grants` holds, or `null` if none are granted. */
export function landingAreaKey(grants: Partial<Record<AreaKey, AreaLevel>>): AreaKey | null {
  for (const areaKey of AREA_PRIORITY) {
    if (grants[areaKey]) return areaKey;
  }
  return null;
}

/** Derives a landing path from a role's granted areas in fixed priority order. */
export function resolveLandingPath(grants: Partial<Record<AreaKey, AreaLevel>>): string | null {
  const key = landingAreaKey(grants);
  return key ? AREA_LANDING_PATHS[key] : null;
}
