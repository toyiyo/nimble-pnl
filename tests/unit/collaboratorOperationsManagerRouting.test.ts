import { describe, it, expect } from 'vitest';
import { COLLABORATOR_ROUTES } from '@/App';
import { getNavigationForRole, navigationGroups, operationsManagerNav } from '@/components/AppSidebar.nav';

const ROLE = 'collaborator_operations_manager';

describe('collaborator_operations_manager route guard', () => {
  it('has a route config (not fail-open)', () => {
    expect(COLLABORATOR_ROUTES[ROLE]).toBeDefined();
    expect(COLLABORATOR_ROUTES[ROLE].landing).toBe('/scheduling');
  });

  it('allows operational routes and denies admin/accounting routes', () => {
    const allowed = COLLABORATOR_ROUTES[ROLE].allowed;
    for (const p of ['/scheduling', '/time-punches', '/tips', '/inventory', '/recipes', '/settings']) {
      expect(allowed, `should allow ${p}`).toContain(p);
    }
    // '/reports' is a P&L page (Reports.tsx defaults to P&L Trends) — must be denied
    // to this accounting-excluded role (Codex P1, PR #596).
    for (const p of ['/team', '/integrations', '/transactions', '/banking', '/chart-of-accounts', '/reports', '/']) {
      expect(allowed, `should NOT allow ${p}`).not.toContain(p);
    }
  });
});

describe('collaborator_operations_manager sidebar nav', () => {
  it('has a scoped, bespoke nav (not fail-open to the full internal navigationGroups, and not reusing operationsManagerNav)', () => {
    const nav = getNavigationForRole(ROLE);
    expect(nav).toBeDefined();
    expect(nav).not.toBe(navigationGroups);
    expect(nav).not.toBe(operationsManagerNav);
    expect(nav.length).toBeGreaterThan(0);
  });

  it('includes operational paths and excludes admin/accounting/team/employees paths', () => {
    const nav = getNavigationForRole(ROLE);
    const paths = nav.flatMap((group) => group.items.map((item) => item.path));

    for (const p of ['/scheduling', '/time-punches', '/tips', '/payroll', '/recipes', '/prep-recipes', '/inventory', '/inventory-audit', '/purchase-orders', '/pos-sales', '/settings', '/help']) {
      expect(paths, `should include ${p}`).toContain(p);
    }
    // '/reports' excluded — it is a P&L page, not inventory reports (Codex P1, PR #596).
    for (const p of ['/', '/reports', '/team', '/integrations', '/employees', '/transactions', '/banking', '/chart-of-accounts', '/invoices', '/customers', '/expenses', '/budget', '/assets', '/financial-intelligence', '/financial-statements', '/stripe-account', '/print-checks']) {
      expect(paths, `should NOT include ${p}`).not.toContain(p);
    }
  });
});
