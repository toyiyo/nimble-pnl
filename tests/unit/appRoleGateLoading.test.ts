import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

/**
 * `src/App.tsx` is a large provider/router tree that isn't practically
 * unit-rendered — this follows the established source-text-assertion pattern
 * (see App.viewModeWiring.test.ts, appLaborRoute.test.ts).
 *
 * The rule under test: `StaffRoleChecker` gates on `selectedRestaurant?.role`,
 * which is undefined while `RestaurantProvider` is still loading. Without an
 * explicit loading branch every check falls through to `<>{children}</>`, so a
 * kiosk or staff user renders the restricted page for a frame and fires its
 * queries — a fail-open. Found by the Phase 7a logic reviewer.
 */
describe('StaffRoleChecker holds rendering until the role is known', () => {
  const appSource = readFileSync(path.resolve(__dirname, '../../src/App.tsx'), 'utf-8');

  const checkerBody = (() => {
    const start = appSource.indexOf('function StaffRoleChecker');
    expect(start).toBeGreaterThan(-1);
    const end = appSource.indexOf('const App = ', start);
    expect(end).toBeGreaterThan(start);
    return appSource.slice(start, end);
  })();

  it('destructures loading from useRestaurantContext()', () => {
    expect(checkerBody).toMatch(
      /const\s+\{[^}]*\bloading\b[^}]*\}\s*=\s*useRestaurantContext\(\)/
    );
  });

  it('returns the loading screen before reading the role', () => {
    const loadingBranchIndex = checkerBody.indexOf('<RouteLoadingScreen />');
    // The assignment, not a mention of it — the comment above the loading
    // branch also names `selectedRestaurant?.role`.
    const roleReadIndex = checkerBody.indexOf('const role = selectedRestaurant?.role');

    expect(loadingBranchIndex).toBeGreaterThan(-1);
    expect(roleReadIndex).toBeGreaterThan(-1);
    expect(loadingBranchIndex).toBeLessThan(roleReadIndex);
    expect(checkerBody).toMatch(/if\s*\(\s*loading\s*\)\s*\{\s*return\s+<RouteLoadingScreen\s*\/>;/);
  });

  it('shares one loading screen component with ProtectedRoute', () => {
    expect(appSource).toMatch(/function\s+RouteLoadingScreen\s*\(\s*\)/);
    // Both gates render it, so they cannot drift into two different screens.
    expect(appSource.match(/<RouteLoadingScreen\s*\/>/g)?.length).toBe(2);
  });
});
