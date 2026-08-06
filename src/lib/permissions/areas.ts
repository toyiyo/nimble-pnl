/**
 * The area model (menu-mirror design)
 *
 * An "area" is one gateable sidebar page, granted at one of three levels: no
 * access, `'view'`, or `'manage'`. This is the client-side mirror of the SQL
 * seed — every mapping below is transcribed literally (not derived) from:
 *
 *   - supabase/migrations/20260805120000_page_areas.sql
 *     (`area_catalog`: the 33 `area_key`s — one per gateable `navigationGroups`
 *     item, plus `collaborators` sharing `/team` with `team` — their
 *     `ui_group`/`sort_order`/`max_level_collaborator`)
 *   - the same migration's rewrite of `user_has_capability` (the capability ->
 *     (area_key, required_level) map used for the `role_id IS NOT NULL` path)
 *
 * If either SQL source changes, this file must change with it — that is the
 * whole point of "single source of truth mirroring the SQL seed" from the
 * design doc (docs/superpowers/specs/2026-08-05-permissions-menu-mirror-design.md).
 *
 * One area per sidebar page, one row in the editor per area: `PAGE_AREAS`
 * declares each page's permission metadata (level caps, hint copy); it is
 * joined against `navigationGroups` (`AppSidebar.nav.data.ts`) to produce
 * `AREA_DEFINITIONS` — the page's real sidebar label, icon, group and
 * position, so the editor never re-invents wording or ordering the sidebar
 * already has. A page added to `navigationGroups` with no matching
 * `PAGE_AREAS` entry fails `tests/unit/areas.test.ts`'s drift alarm instead of
 * silently becoming ungrantable.
 */

import type { LucideIcon } from 'lucide-react';
import { navigationGroups } from '@/components/AppSidebar.nav.data';
import type { Capability } from './types';

/**
 * The 33 SQL area_keys — one per gateable `navigationGroups` item, plus
 * `collaborators`, which shares `/team` with `team` (spec §3.2). Matches
 * area_catalog.area_key exactly.
 */
export type AreaKey =
  | 'dashboard'
  | 'integrations'
  | 'sales'
  | 'ops_inbox'
  | 'reviews'
  | 'weekly_brief'
  | 'scheduling'
  | 'time_punches'
  | 'tips'
  | 'payroll'
  | 'labor'
  | 'recipes'
  | 'prep_recipes'
  | 'inventory'
  | 'inventory_audit'
  | 'purchasing'
  | 'reports'
  | 'budget'
  | 'customers'
  | 'invoices'
  | 'stripe_account'
  | 'banking'
  | 'expenses'
  | 'print_checks'
  | 'assets'
  | 'financial_intelligence'
  | 'transactions'
  | 'chart_of_accounts'
  | 'financial_statements'
  | 'employees'
  | 'team'
  | 'collaborators'
  | 'settings';

/** The grant level for one area_key. No third "none" value — omit the key instead. */
export type AreaLevel = 'view' | 'manage';

/** The three cross-cutting sensitive-data switches, resolved from `role_flags`. */
export type SensitiveFlag = 'view:costs' | 'view:pay_rates' | 'view:employee_pii';

/**
 * The three sensitive-data flags with their human labels.
 *
 * Lived in RoleEditor.tsx until the role picker's delta needed the same
 * labels. Two copies of "Employee pay rates" is how a screen ends up naming
 * a permission differently from the screen that grants it.
 */
export const SENSITIVE_FLAGS: ReadonlyArray<{
  flag: SensitiveFlag;
  name: string;
  hint: string;
  requires: readonly AreaKey[];
}> = [
  {
    flag: 'view:costs',
    name: 'Item costs & margins',
    hint: 'Unit costs, recipe cost, plate margin',
    requires: ['inventory', 'recipes', 'reports'],
  },
  {
    flag: 'view:pay_rates',
    name: 'Employee pay rates',
    hint: 'Hourly and salary amounts on the roster and schedule',
    requires: ['employees', 'scheduling'],
  },
  {
    flag: 'view:employee_pii',
    name: 'Contact details & tax IDs',
    hint: 'Phone, address, last 4 of SSN',
    requires: ['employees'],
  },
];

/**
 * One page's permission metadata — everything the editor needs that isn't
 * already on the sidebar's own `navigationGroups` entry (label/icon/order).
 */
export interface PageArea {
  /** The area_key from area_catalog. */
  key: AreaKey;
  /** The `navigationGroups` path this area gates. `team` and `collaborators` share `/team`. */
  path: string;
  /**
   * Whether the page has a Manage tier at all. `false` means the page has no
   * edit capability — the editor locks the Manage segment. Matches
   * area_catalog's implicit "no edit:X exists" for this key.
   */
  hasManageTier: boolean;
  /**
   * The highest level a collaborator-flavored custom role can be granted for
   * this area. `null` means ungrantable at any level — currently only `team`
   * and `collaborators`, the privilege-escalation guard the design calls out
   * explicitly (a collaborator role that could edit roles could mint itself
   * owner-level access). Enforced in SQL by
   * `role_areas_enforce_collaborator_cap`; this value only drives the
   * editor's disabled state, so the two cannot drift because both read
   * area_catalog.max_level_collaborator.
   */
  maxLevelForCollaborator: AreaLevel | null;
  /** View-tier row copy, authored per page in the mockup. */
  hint: string;
  /** Manage-tier row copy, only present where `hasManageTier` is true. */
  manageHint?: string;
  /**
   * Overrides the sidebar's `label` for this row. Only `team` and
   * `collaborators` need it — both gate `/team`, so the sidebar's single
   * "Team" label can't distinguish them.
   */
  navLabel?: string;
}

/**
 * The 33 pages' permission metadata, in sidebar order. Source of truth for
 * `AREA_DEFINITIONS` (joined against `navigationGroups` for label/icon/
 * group/order), `AREA_LANDING_PATHS` and `AREA_PRIORITY` below — none of
 * those three is hand-maintained separately.
 */
export const PAGE_AREAS: readonly PageArea[] = [
  // Main
  { key: 'dashboard', path: '/', hasManageTier: false, maxLevelForCollaborator: 'view',
    hint: 'Daily numbers, prime cost, P&L snapshot' },
  { key: 'integrations', path: '/integrations', hasManageTier: true, maxLevelForCollaborator: 'view',
    hint: 'POS, bank and payroll connections', manageHint: 'connect and disconnect systems' },
  { key: 'sales', path: '/pos-sales', hasManageTier: false, maxLevelForCollaborator: 'view',
    hint: 'Ticket-level sales from your POS' },
  { key: 'ops_inbox', path: '/ops-inbox', hasManageTier: false, maxLevelForCollaborator: 'view',
    hint: 'Exceptions and things needing a decision' },
  { key: 'reviews', path: '/reviews', hasManageTier: true, maxLevelForCollaborator: 'view',
    hint: 'Review pages, QR codes, guest feedback', manageHint: 'edit QR pages and reply' },
  { key: 'weekly_brief', path: '/weekly-brief', hasManageTier: false, maxLevelForCollaborator: 'view',
    hint: 'The weekly summary and its archive' },

  // Operations
  { key: 'scheduling', path: '/scheduling', hasManageTier: true, maxLevelForCollaborator: 'manage',
    hint: 'Shifts, templates, open-shift broadcasts', manageHint: 'publish and edit schedules' },
  { key: 'time_punches', path: '/time-punches', hasManageTier: true, maxLevelForCollaborator: 'manage',
    hint: 'Punches, edits, missed-punch fixes', manageHint: 'edit punches' },
  { key: 'tips', path: '/tips', hasManageTier: true, maxLevelForCollaborator: 'manage',
    hint: 'Pools, rules and distribution', manageHint: 'run and adjust distributions' },
  { key: 'payroll', path: '/payroll', hasManageTier: true, maxLevelForCollaborator: 'view',
    hint: 'Pay runs and payroll history', manageHint: 'run payroll' },
  { key: 'labor', path: '/labor', hasManageTier: false, maxLevelForCollaborator: 'view',
    hint: 'Labor cost against sales' },

  // Inventory
  { key: 'recipes', path: '/recipes', hasManageTier: true, maxLevelForCollaborator: 'manage',
    hint: 'Recipe cards and plate cost', manageHint: 'create and edit recipes' },
  { key: 'prep_recipes', path: '/prep-recipes', hasManageTier: true, maxLevelForCollaborator: 'manage',
    hint: 'Prep items and production batches', manageHint: 'edit prep items and batches' },
  { key: 'inventory', path: '/inventory', hasManageTier: true, maxLevelForCollaborator: 'manage',
    hint: 'Counts, stock levels, unit costs', manageHint: 'adjust counts and costs' },
  { key: 'inventory_audit', path: '/inventory-audit', hasManageTier: true, maxLevelForCollaborator: 'manage',
    hint: 'Count sessions and variance', manageHint: 'run and close audits' },
  { key: 'purchasing', path: '/purchase-orders', hasManageTier: true, maxLevelForCollaborator: 'manage',
    hint: 'POs, receiving, supplier invoices', manageHint: 'raise and receive POs' },
  { key: 'reports', path: '/reports', hasManageTier: true, maxLevelForCollaborator: 'view',
    hint: 'Saved reports and P&L trends', manageHint: 'and the AI assistant' },

  // Accounting
  { key: 'budget', path: '/budget', hasManageTier: false, maxLevelForCollaborator: 'view',
    hint: 'Targets and burn against plan' },
  { key: 'customers', path: '/customers', hasManageTier: true, maxLevelForCollaborator: 'manage',
    hint: 'Customer records and balances', manageHint: 'add and edit customers' },
  { key: 'invoices', path: '/invoices', hasManageTier: true, maxLevelForCollaborator: 'manage',
    hint: 'Draft, send and track invoices', manageHint: 'create, send and void invoices' },
  { key: 'stripe_account', path: '/stripe-account', hasManageTier: false, maxLevelForCollaborator: 'view',
    hint: 'Balance, payouts and transfers' },
  { key: 'banking', path: '/banking', hasManageTier: true, maxLevelForCollaborator: 'manage',
    hint: 'Connected accounts and feeds', manageHint: 'connect and reconcile' },
  { key: 'expenses', path: '/expenses', hasManageTier: true, maxLevelForCollaborator: 'manage',
    hint: 'Bills, receipts and categories', manageHint: 'record and categorise' },
  { key: 'print_checks', path: '/print-checks', hasManageTier: true, maxLevelForCollaborator: 'manage',
    hint: 'Issue and print checks', manageHint: 'issue checks — this moves money' },
  { key: 'assets', path: '/assets', hasManageTier: true, maxLevelForCollaborator: 'manage',
    hint: 'Fixed assets and depreciation', manageHint: 'add and depreciate assets' },
  { key: 'financial_intelligence', path: '/financial-intelligence', hasManageTier: false, maxLevelForCollaborator: 'view',
    hint: 'AI analysis over your books' },
  { key: 'transactions', path: '/transactions', hasManageTier: true, maxLevelForCollaborator: 'manage',
    hint: 'The ledger and categorisation', manageHint: 'edit and recategorise' },
  { key: 'chart_of_accounts', path: '/chart-of-accounts', hasManageTier: true, maxLevelForCollaborator: 'manage',
    hint: 'Account tree and mappings', manageHint: 'add and rename accounts' },
  { key: 'financial_statements', path: '/financial-statements', hasManageTier: false, maxLevelForCollaborator: 'view',
    hint: 'P&L, balance sheet, cash flow' },

  // Admin
  { key: 'employees', path: '/employees', hasManageTier: true, maxLevelForCollaborator: 'manage',
    hint: 'Roster, jobs, wage assignments', manageHint: 'hire, edit and terminate' },
  { key: 'team', path: '/team', navLabel: 'Team members', hasManageTier: true, maxLevelForCollaborator: null,
    hint: 'Invite people, assign roles, edit these roles' },
  { key: 'collaborators', path: '/team', navLabel: 'Collaborators', hasManageTier: true, maxLevelForCollaborator: null,
    hint: 'Add external collaborators and set what they can do' },
  { key: 'settings', path: '/settings', hasManageTier: true, maxLevelForCollaborator: 'view',
    hint: 'Restaurant profile, hours, timezone', manageHint: 'change settings' },
];

interface AreaCapabilities {
  /** Capabilities granted once the area is at 'view' (or 'manage', which is a superset). */
  view: readonly Capability[];
  /** Additional capabilities granted once the area is at 'manage'. */
  manageAdds: readonly Capability[];
}

/**
 * The 33 area_keys' capability bundles. Transcribed literally from the
 * capability -> (area_key, required_level) VALUES map in
 * `user_has_capability` (20260805120000_page_areas.sql): every capability
 * whose required_level is 'view' lands in that area's `view` list here,
 * every 'manage' one lands in `manageAdds`.
 *
 * Seven entries are not a pure one-to-one re-point of a same-named
 * capability (spec §3.2): `recipes`/`inventory` absorb capabilities with no
 * page of their own (`view:batches`, `view:inventory_transactions`, etc.),
 * `print_checks` renames off `view:pending_outflows`, and `reports`'s manage
 * tier means "and the AI assistant" via the hardcoded
 * `area_key = 'reports' AND level = 'manage'` check rather than a
 * `view:ai_assistant` row in the VALUES map itself. `dashboard`,
 * `ops_inbox`, `weekly_brief`, `budget`, `labor` and `stripe_account` carry
 * no capability at all (spec §3.4) — gated purely by routing, same as today.
 *
 * `view:ai_assistant` and `view:financial_intelligence` are included
 * unconditionally here, exactly as they were before the re-cut — the SQL
 * ANDs them with `has_subscription_feature(...)`, but that is a runtime,
 * per-restaurant subscription check with no place in a pure (grants, flags)
 * -> Capability[] function, and today's static ROLE_CAPABILITIES table
 * already grants them unconditionally by role. Subscription gating happens
 * downstream of this function, same as it does today downstream of
 * ROLE_CAPABILITIES.
 */
const AREA_CAPABILITIES: Record<AreaKey, AreaCapabilities> = {
  dashboard: {
    view: ['view:dashboard'],
    manageAdds: [],
  },
  integrations: {
    view: ['view:integrations'],
    manageAdds: ['manage:integrations'],
  },
  sales: {
    view: ['view:pos_sales'],
    manageAdds: [],
  },
  ops_inbox: {
    view: [],
    manageAdds: [],
  },
  reviews: {
    view: ['view:reviews'],
    manageAdds: ['manage:reviews'],
  },
  weekly_brief: {
    view: [],
    manageAdds: [],
  },
  scheduling: {
    view: ['view:scheduling'],
    manageAdds: ['edit:scheduling'],
  },
  time_punches: {
    view: ['view:time_punches'],
    manageAdds: ['edit:time_punches'],
  },
  tips: {
    view: ['view:tips'],
    manageAdds: ['edit:tips'],
  },
  payroll: {
    view: ['view:payroll'],
    manageAdds: ['edit:payroll'],
  },
  labor: {
    view: [],
    manageAdds: [],
  },
  recipes: {
    view: ['view:recipes', 'view:batches'],
    manageAdds: ['edit:recipes', 'edit:batches'],
  },
  prep_recipes: {
    view: ['view:prep_recipes'],
    manageAdds: ['edit:prep_recipes'],
  },
  inventory: {
    view: ['view:inventory'],
    manageAdds: [
      'edit:inventory',
      'view:receipt_import', 'edit:receipt_import',
      'view:inventory_transactions', 'edit:inventory_transactions',
    ],
  },
  inventory_audit: {
    view: ['view:inventory_audit'],
    manageAdds: ['edit:inventory_audit'],
  },
  purchasing: {
    view: ['view:purchase_orders'],
    manageAdds: ['edit:purchase_orders'],
  },
  reports: {
    view: ['view:reports'],
    manageAdds: ['view:ai_assistant'], // manage on Reports means "and the AI assistant"
  },
  budget: {
    view: [],
    manageAdds: [],
  },
  customers: {
    view: ['view:customers'],
    manageAdds: ['edit:customers'],
  },
  invoices: {
    view: ['view:invoices'],
    manageAdds: ['edit:invoices'],
  },
  stripe_account: {
    view: [],
    manageAdds: [],
  },
  banking: {
    view: ['view:banking'],
    manageAdds: ['edit:banking'],
  },
  expenses: {
    view: ['view:expenses'],
    manageAdds: ['edit:expenses'],
  },
  print_checks: {
    view: ['view:pending_outflows'],
    manageAdds: ['edit:pending_outflows'],
  },
  assets: {
    view: ['view:assets'],
    manageAdds: ['edit:assets'],
  },
  financial_intelligence: {
    view: ['view:financial_intelligence'],
    manageAdds: [],
  },
  transactions: {
    view: ['view:transactions'],
    manageAdds: ['edit:transactions'],
  },
  chart_of_accounts: {
    view: ['view:chart_of_accounts'],
    manageAdds: ['edit:chart_of_accounts'],
  },
  financial_statements: {
    view: ['view:financial_statements'],
    manageAdds: [],
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
};

/**
 * Expands a role's area grants and sensitive-data flags into the flat
 * capability set it holds — the client-side mirror of what
 * `user_has_capability` computes per-capability in SQL for a `role_id IS NOT
 * NULL` membership.
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
 * One row in the role editor — a `PageArea` enriched with the sidebar's own
 * label, icon, group and position, so none of those is hand-maintained here.
 */
export interface AreaDefinition extends PageArea {
  /** The sidebar's label for this page, or `navLabel` where the page overrides it. */
  label: string;
  icon: LucideIcon;
  /** The `navigationGroups` group label this page belongs to (area_catalog.ui_group). */
  uiGroup: string;
  /** 1-based position within `uiGroup`, taken from `navigationGroups` order. */
  sortOrder: number;
}

/**
 * Walks `navigationGroups` in order and, for each item, emits every
 * `PAGE_AREAS` entry whose `path` matches (two, for `/team`) — the join that
 * makes a sidebar page's label/icon/group/order the single source of truth
 * for the editor instead of a second hand-kept copy. Skips `/help`, which
 * stays universal (`routeAreas.ts`) rather than becoming a grantable area.
 */
function deriveAreaDefinitions(): AreaDefinition[] {
  const definitions: AreaDefinition[] = [];

  for (const group of navigationGroups) {
    let sortOrder = 0;
    for (const item of group.items) {
      if (item.path === '/help') continue;

      for (const area of PAGE_AREAS.filter((candidate) => candidate.path === item.path)) {
        sortOrder += 1;
        definitions.push({
          ...area,
          label: area.navLabel ?? item.label,
          icon: item.icon,
          uiGroup: group.label,
          sortOrder,
        });
      }
    }
  }

  return definitions;
}

/**
 * The 33 editor rows, in sidebar order (Main, Operations, Inventory,
 * Accounting, then Admin). Derived from `navigationGroups` joined against
 * `PAGE_AREAS` — see `deriveAreaDefinitions`.
 */
export const AREA_DEFINITIONS: readonly AreaDefinition[] = deriveAreaDefinitions();

/**
 * One representative nav path per `area_key` — the page a role holding that
 * area lands on, and (via `AREA_PRIORITY`) the page it lands on by default.
 * Derived from `PAGE_AREAS` rather than hand-maintained, so a page moving
 * in the sidebar can't leave this list stale.
 */
export const AREA_LANDING_PATHS: Record<AreaKey, string> = PAGE_AREAS.reduce(
  (paths, area) => {
    paths[area.key] = area.path;
    return paths;
  },
  {} as Record<AreaKey, string>
);

/**
 * Priority order for picking a landing path (or, in `preview.ts`, the "opens
 * here" nav item) when multiple areas are granted — mirrors
 * `AREA_DEFINITIONS`' sidebar ordering (Main, then Operations, Inventory,
 * Accounting, Admin).
 */
export const AREA_PRIORITY: readonly AreaKey[] = AREA_DEFINITIONS.map((area) => area.key);

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
