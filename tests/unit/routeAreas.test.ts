/**
 * Route eligibility derived from area grants (roles-and-areas, task 9g).
 *
 * A custom role has no entry in `COLLABORATOR_ROUTES`, so without this
 * derivation `StaffRoleChecker` finds no config and lets it through — a
 * `collaborator_custom` membership would reach `/team` and `/banking` by URL.
 * These tests pin the derivation to the one authority that already exists for
 * what a collaborator may reach: the four hand-written route lists.
 *
 * The calibration test below is the important one. It asserts that feeding a
 * builtin collaborator's *seeded areas* through the derivation reproduces that
 * role's hand-written allow-list exactly. The builtins keep their hand-written
 * lists at runtime — this only proves the map is faithful, so a custom role
 * built from the same areas reaches the same pages and no more.
 */
import { describe, it, expect } from 'vitest';
import { COLLABORATOR_ROUTES } from '@/App';
import {
  AREA_ROUTES,
  COLLABORATOR_PATH_EXCLUSIONS,
  UNIVERSAL_PATHS,
  allowedPathsForAreas,
  customCollaboratorRoutes,
} from '@/lib/permissions/routeAreas';
import type { AreaKey, AreaLevel } from '@/lib/permissions/areas';

type Grants = Partial<Record<AreaKey, AreaLevel>>;

/**
 * The four collaborator builtins' `role_areas` rows, transcribed from
 * supabase/migrations/20260730110000_seed_builtin_roles.sql.
 */
const SEEDED_COLLABORATOR_AREAS: Record<string, Grants> = {
  collaborator_accountant: {
    books: 'manage',
    chart_of_accounts: 'manage',
    payroll: 'view',
    employees: 'view',
    settings: 'view',
  },
  collaborator_inventory: {
    inventory: 'manage',
    purchasing: 'manage',
    settings: 'view',
  },
  collaborator_chef: {
    inventory: 'view',
    recipes: 'manage',
    settings: 'view',
  },
  collaborator_operations_manager: {
    reports: 'manage',
    sales: 'view',
    inventory: 'manage',
    purchasing: 'manage',
    recipes: 'manage',
    scheduling: 'manage',
    payroll: 'view',
    employees: 'view',
    settings: 'view',
  },
};

describe('routeAreas – calibration against the hand-written collaborator lists', () => {
  for (const [role, grants] of Object.entries(SEEDED_COLLABORATOR_AREAS)) {
    it(`derives exactly ${role}'s allow-list from its seeded areas`, () => {
      const derived = allowedPathsForAreas(grants);
      const handWritten = COLLABORATOR_ROUTES[role].allowed;
      expect([...derived].sort()).toEqual([...handWritten].sort());
    });
  }
});

describe('routeAreas – the exclusions that areas cannot express', () => {
  it('never admits the P&L surfaces, whatever the reports grant', () => {
    // `/` is the P&L dashboard (revenue, food cost, labor cost, prime cost %)
    // and `/reports` defaults to P&L Trends — excluded from every collaborator
    // list today (Codex P1, PR #596). A `reports` grant buys the capability,
    // not these two pages.
    const derived = allowedPathsForAreas({ reports: 'manage' });
    expect(derived).not.toContain('/');
    expect(derived).not.toContain('/reports');
  });

  it('never admits /team, even though the area exists in the model', () => {
    // The collaborator cap already makes `team` ungrantable in the editor;
    // this is the second lock, so a row written any other way still cannot
    // reach the screen that mints roles.
    expect(allowedPathsForAreas({ team: 'manage', collaborators: 'manage' })).not.toContain('/team');
    expect(COLLABORATOR_PATH_EXCLUSIONS).toContain('/team');
  });

  it('admits /help with no grants at all', () => {
    expect(allowedPathsForAreas({})).toEqual([...UNIVERSAL_PATHS]);
  });

  it('maps no path to an area more than once', () => {
    const paths = AREA_ROUTES.map((route) => route.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('treats manage as satisfying a view requirement, and view as not satisfying manage', () => {
    expect(allowedPathsForAreas({ inventory: 'manage' })).toContain('/inventory');
    expect(allowedPathsForAreas({ inventory: 'manage' })).toContain('/inventory-audit');
    expect(allowedPathsForAreas({ inventory: 'view' })).toContain('/inventory');
    expect(allowedPathsForAreas({ inventory: 'view' })).not.toContain('/inventory-audit');
  });
});

/**
 * The ten builtins' `role_areas` rows, transcribed from
 * supabase/migrations/20260730110000_seed_builtin_roles.sql. Includes the
 * four collaborator grants above (SEEDED_COLLABORATOR_AREAS) plus the six
 * platform roles.
 */
const SEEDED_BUILTIN_AREAS: Record<string, Grants> = {
  owner: {
    reports: 'manage',
    sales: 'view',
    inventory: 'manage',
    purchasing: 'manage',
    recipes: 'manage',
    scheduling: 'manage',
    books: 'manage',
    chart_of_accounts: 'manage',
    payroll: 'manage',
    employees: 'manage',
    team: 'manage',
    collaborators: 'manage',
    settings: 'manage',
    integrations: 'manage',
  },
  manager: {
    reports: 'manage',
    sales: 'view',
    inventory: 'manage',
    purchasing: 'manage',
    recipes: 'manage',
    scheduling: 'manage',
    books: 'manage',
    chart_of_accounts: 'view',
    payroll: 'manage',
    employees: 'manage',
    team: 'manage',
    collaborators: 'manage',
    settings: 'view',
    integrations: 'view',
  },
  operations_manager: {
    reports: 'manage',
    sales: 'view',
    inventory: 'manage',
    purchasing: 'manage',
    recipes: 'manage',
    scheduling: 'manage',
    payroll: 'manage',
    employees: 'manage',
    team: 'manage',
    settings: 'view',
  },
  chef: {
    reports: 'view',
    sales: 'view',
    inventory: 'manage',
    purchasing: 'view',
    recipes: 'manage',
    scheduling: 'view',
    settings: 'view',
  },
  employee_self_service: {
    settings: 'view',
  },
  kiosk: {},
  ...SEEDED_COLLABORATOR_AREAS,
};

describe('routeAreas – /print-checks is gated on books@manage across every builtin', () => {
  for (const [role, grants] of Object.entries(SEEDED_BUILTIN_AREAS)) {
    const satisfiesBooksManage = grants.books === 'manage';
    it(`${satisfiesBooksManage ? 'admits' : 'excludes'} /print-checks for ${role}`, () => {
      const derived = allowedPathsForAreas(grants);
      if (satisfiesBooksManage) {
        expect(derived).toContain('/print-checks');
      } else {
        expect(derived).not.toContain('/print-checks');
      }
    });
  }

  it('admits /print-checks for a synthetic books@manage role', () => {
    expect(allowedPathsForAreas({ books: 'manage' })).toContain('/print-checks');
  });

  it('excludes /print-checks for a synthetic books@view role', () => {
    expect(allowedPathsForAreas({ books: 'view' })).not.toContain('/print-checks');
  });
});

describe('routeAreas – customCollaboratorRoutes', () => {
  it('lands on a page the role can actually open', () => {
    // A landing path outside `allowed` is a redirect loop: StaffRoleChecker
    // bounces the user to `landing`, then bounces them off it again.
    const cases: Grants[] = [
      {},
      { reports: 'manage' },
      { scheduling: 'manage' },
      { books: 'manage', payroll: 'view' },
      { settings: 'view' },
    ];
    for (const grants of cases) {
      const { landing, allowed } = customCollaboratorRoutes(grants);
      expect(allowed).toContain(landing);
    }
  });

  it('lands a scheduling-only role on /scheduling and an inventory-only role on /inventory', () => {
    expect(customCollaboratorRoutes({ scheduling: 'manage' }).landing).toBe('/scheduling');
    expect(customCollaboratorRoutes({ inventory: 'view' }).landing).toBe('/inventory');
  });

  it('falls back to /help for a role granted nothing', () => {
    // "This role can sign in and see nothing" is a state the editor allows;
    // it must still resolve to a page rather than an empty redirect target.
    expect(customCollaboratorRoutes({}).landing).toBe('/help');
  });

  it('does not land a reports-only role on the P&L dashboard it cannot open', () => {
    const { landing, allowed } = customCollaboratorRoutes({ reports: 'view' });
    expect(landing).not.toBe('/');
    expect(allowed).toContain(landing);
  });
});
