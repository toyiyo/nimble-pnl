import { describe, it, expect } from 'vitest';
import { COLLABORATOR_ROUTES } from '@/App';

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
    for (const p of ['/team', '/integrations', '/transactions', '/banking', '/chart-of-accounts', '/']) {
      expect(allowed, `should NOT allow ${p}`).not.toContain(p);
    }
  });
});
