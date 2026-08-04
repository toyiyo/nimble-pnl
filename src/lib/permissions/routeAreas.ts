/**
 * Route eligibility derived from area grants (roles-and-areas design).
 *
 * `COLLABORATOR_ROUTES` in App.tsx is hand-written per builtin collaborator
 * role, so a user-named custom role has no entry there at all — and
 * `StaffRoleChecker` treats "no entry" as "no restriction". This module is
 * what a custom role is checked against instead: one path -> (area, level)
 * map, plus the two things a path map cannot express (paths no collaborator
 * may reach whatever they hold, and paths everyone may reach holding
 * nothing).
 *
 * The map is *calibrated*, not invented: feeding each builtin collaborator's
 * seeded `role_areas` (20260730110000_seed_builtin_roles.sql) through
 * `allowedPathsForAreas` reproduces that role's hand-written allow-list
 * exactly — see tests/unit/routeAreas.test.ts. The builtins keep their
 * hand-written lists at runtime; the calibration is what lets a custom role
 * assembled from the same areas reach the same pages and no more.
 *
 * Deliberately unmapped: `/budget`, `/labor`, `/stripe-account`,
 * `/ops-inbox`, `/weekly-brief`. No collaborator role reaches them today
 * (they surface P&L, labor cost, and financial-account controls), and
 * leaving them out of the map is what keeps that true for custom roles.
 */

import { AREA_PRIORITY, AREA_LANDING_PATHS } from './areas';
import type { AreaKey, AreaLevel } from './areas';

export interface AreaRoute {
  path: string;
  /** The area that gates this path. */
  area: AreaKey;
  /** The level the role must hold in that area to reach it. */
  minLevel: AreaLevel;
}

/**
 * Path -> (area, level). Ordered by `AREA_PRIORITY`, so the derived
 * allow-list reads in the same order as the editor's rows.
 */
export const AREA_ROUTES: readonly AreaRoute[] = [
  // reports / sales
  { path: '/', area: 'reports', minLevel: 'view' },
  { path: '/reports', area: 'reports', minLevel: 'view' },
  { path: '/pos-sales', area: 'sales', minLevel: 'view' },

  // inventory / purchasing
  { path: '/inventory', area: 'inventory', minLevel: 'view' },
  { path: '/inventory-audit', area: 'inventory', minLevel: 'manage' },
  { path: '/receipt-import', area: 'inventory', minLevel: 'manage' },
  { path: '/purchase-orders', area: 'purchasing', minLevel: 'view' },

  // recipes
  { path: '/recipes', area: 'recipes', minLevel: 'view' },
  { path: '/prep-recipes', area: 'recipes', minLevel: 'view' },

  // scheduling
  { path: '/scheduling', area: 'scheduling', minLevel: 'view' },
  { path: '/time-punches', area: 'scheduling', minLevel: 'manage' },
  { path: '/tips', area: 'scheduling', minLevel: 'manage' },

  // books / chart of accounts
  { path: '/transactions', area: 'books', minLevel: 'view' },
  { path: '/banking', area: 'books', minLevel: 'view' },
  { path: '/expenses', area: 'books', minLevel: 'view' },
  { path: '/invoices', area: 'books', minLevel: 'view' },
  { path: '/customers', area: 'books', minLevel: 'view' },
  { path: '/financial-statements', area: 'books', minLevel: 'view' },
  { path: '/financial-intelligence', area: 'books', minLevel: 'view' },
  { path: '/assets', area: 'books', minLevel: 'view' },
  // Writing a check moves money — the only books path gated at manage.
  { path: '/print-checks', area: 'books', minLevel: 'manage' },
  { path: '/chart-of-accounts', area: 'chart_of_accounts', minLevel: 'view' },

  // payroll / people
  { path: '/payroll', area: 'payroll', minLevel: 'view' },
  { path: '/employees', area: 'employees', minLevel: 'view' },
  { path: '/team', area: 'team', minLevel: 'view' },

  // settings
  { path: '/settings', area: 'settings', minLevel: 'view' },
  { path: '/integrations', area: 'integrations', minLevel: 'view' },
];

/** Reachable holding no areas at all, exactly as every collaborator nav has /help today. */
export const UNIVERSAL_PATHS: readonly string[] = ['/help'];

/**
 * Paths no collaborator-flavored role reaches, whatever it was granted.
 *
 *  - `/` and `/reports` are the P&L surfaces (Index.tsx renders net revenue,
 *    food cost, labor cost and prime cost %; Reports.tsx defaults to P&L
 *    Trends). Every hand-written collaborator list excludes both, including
 *    the roles that do hold the `reports` area (Codex P1, PR #596).
 *  - `/team` mints and assigns roles. The editor already caps the `team` area
 *    as ungrantable to a collaborator; this is the second lock, so a
 *    `role_areas` row written any other way still cannot reach that screen.
 */
export const COLLABORATOR_PATH_EXCLUSIONS: readonly string[] = ['/', '/reports', '/team'];

/** `manage` satisfies a `view` requirement; `view` does not satisfy `manage`. */
function satisfies(held: AreaLevel | undefined, required: AreaLevel): boolean {
  if (!held) return false;
  return required === 'view' ? true : held === 'manage';
}

/**
 * The paths a collaborator role holding `grants` may reach, in the order
 * `AREA_ROUTES` declares them, with the universal paths first.
 */
export function allowedPathsForAreas(grants: Partial<Record<AreaKey, AreaLevel>>): string[] {
  const excluded = new Set(COLLABORATOR_PATH_EXCLUSIONS);
  const allowed = [...UNIVERSAL_PATHS];

  for (const route of AREA_ROUTES) {
    if (excluded.has(route.path)) continue;
    if (satisfies(grants[route.area], route.minLevel)) allowed.push(route.path);
  }

  return allowed;
}

/**
 * The `{ landing, allowed }` shape `StaffRoleChecker` consumes, for a role
 * with no `COLLABORATOR_ROUTES` entry.
 *
 * The landing path is picked from `AREA_PRIORITY` like every other
 * area-derived landing, but only from paths the role can actually open — a
 * landing outside `allowed` is a redirect loop (bounced to the landing, then
 * bounced off it). A `reports`-only role is exactly that case: it holds the
 * highest-priority area and can reach neither of its pages.
 */
export function customCollaboratorRoutes(grants: Partial<Record<AreaKey, AreaLevel>>): {
  landing: string;
  allowed: string[];
} {
  const allowed = allowedPathsForAreas(grants);
  const reachable = new Set(allowed);

  for (const area of AREA_PRIORITY) {
    if (!grants[area]) continue;
    const path = AREA_LANDING_PATHS[area];
    if (reachable.has(path)) return { landing: path, allowed };
  }

  // Granted nothing, or granted only areas whose pages are excluded.
  // `allowed` always carries the universal paths, so this never redirects
  // somewhere the role would be bounced off again.
  return { landing: allowed[0], allowed };
}
