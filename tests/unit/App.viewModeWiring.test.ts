import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

/**
 * `src/App.tsx` is a large provider/router tree (Auth, Restaurant context,
 * collaborator role gating, etc.) that isn't practically unit-rendered —
 * see `appLaborRoute.test.ts` / `appNoVercelAnalytics.test.ts` for the
 * established source-text-assertion pattern this test follows.
 *
 * Design doc: docs/superpowers/specs/2026-07-24-admin-work-view-mode-design.md
 * Plan task 8: mount `<ViewModeProvider>` inside `RestaurantProvider`, and
 * wire `LayoutSwitcher` to read `viewMode` for mobile-layout selection and
 * to show `<PersonalViewBanner variant="desktop" />` above `{children}` in
 * desktop work mode.
 */
describe('App.tsx mounts ViewModeProvider and wires LayoutSwitcher', () => {
  const appSource = readFileSync(path.resolve(__dirname, '../../src/App.tsx'), 'utf-8');

  it('imports ViewModeProvider (and useViewMode) from the ViewModeContext', () => {
    expect(appSource).toMatch(
      /import\s+\{[^}]*ViewModeProvider[^}]*useViewMode[^}]*\}\s+from\s+["']@\/contexts\/ViewModeContext["'];|import\s+\{[^}]*useViewMode[^}]*ViewModeProvider[^}]*\}\s+from\s+["']@\/contexts\/ViewModeContext["'];/
    );
  });

  it('imports PersonalViewBanner from the components directory', () => {
    expect(appSource).toMatch(
      /import\s+\{\s*PersonalViewBanner\s*\}\s+from\s+["']@\/components\/PersonalViewBanner["'];/
    );
  });

  it('mounts ViewModeProvider inside RestaurantProvider, wrapping AiChatProvider/StaffRoleChecker/LayoutSwitcher', () => {
    const restaurantProviderOpenIndex = appSource.indexOf('<RestaurantProvider>');
    const viewModeProviderOpenIndex = appSource.indexOf('<ViewModeProvider>');
    const aiChatProviderOpenIndex = appSource.indexOf('<AiChatProvider>');
    const viewModeProviderCloseIndex = appSource.indexOf('</ViewModeProvider>');
    const restaurantProviderCloseIndex = appSource.indexOf('</RestaurantProvider>');

    expect(restaurantProviderOpenIndex).toBeGreaterThan(-1);
    expect(viewModeProviderOpenIndex).toBeGreaterThan(-1);
    expect(aiChatProviderOpenIndex).toBeGreaterThan(-1);
    expect(viewModeProviderCloseIndex).toBeGreaterThan(-1);
    expect(restaurantProviderCloseIndex).toBeGreaterThan(-1);

    // RestaurantProvider > ViewModeProvider > AiChatProvider ... </ViewModeProvider> ... </RestaurantProvider>
    expect(restaurantProviderOpenIndex).toBeLessThan(viewModeProviderOpenIndex);
    expect(viewModeProviderOpenIndex).toBeLessThan(aiChatProviderOpenIndex);
    expect(aiChatProviderOpenIndex).toBeLessThan(viewModeProviderCloseIndex);
    expect(viewModeProviderCloseIndex).toBeLessThan(restaurantProviderCloseIndex);
  });

  it('LayoutSwitcher reads viewMode via useViewMode()', () => {
    const layoutSwitcherIndex = appSource.indexOf('function LayoutSwitcher');
    expect(layoutSwitcherIndex).toBeGreaterThan(-1);
    const nextFunctionIndex = appSource.indexOf('function ProtectedRoute');
    expect(nextFunctionIndex).toBeGreaterThan(layoutSwitcherIndex);
    const layoutSwitcherBody = appSource.slice(layoutSwitcherIndex, nextFunctionIndex);

    expect(layoutSwitcherBody).toMatch(/const\s+\{\s*viewMode\s*\}\s*=\s*useViewMode\(\)/);
  });

  it('routes to MobileLayout when staff OR work-mode, on mobile', () => {
    const layoutSwitcherIndex = appSource.indexOf('function LayoutSwitcher');
    const nextFunctionIndex = appSource.indexOf('function ProtectedRoute');
    const layoutSwitcherBody = appSource.slice(layoutSwitcherIndex, nextFunctionIndex);

    expect(layoutSwitcherBody).toMatch(
      /\(\s*isStaff\s*\|\|\s*viewMode\s*===\s*['"]work['"]\s*\)\s*&&\s*isMobile/
    );
  });

  it('renders PersonalViewBanner variant="desktop" above {children} in desktop work mode', () => {
    const layoutSwitcherIndex = appSource.indexOf('function LayoutSwitcher');
    const nextFunctionIndex = appSource.indexOf('function ProtectedRoute');
    const layoutSwitcherBody = appSource.slice(layoutSwitcherIndex, nextFunctionIndex);

    expect(layoutSwitcherBody).toMatch(
      /viewMode\s*===\s*['"]work['"]\s*&&\s*[\s\S]{0,80}?<PersonalViewBanner\s+variant="desktop"\s*\/>/
    );

    const bannerIndex = layoutSwitcherBody.search(/<PersonalViewBanner\s+variant="desktop"\s*\/>/);
    // The MobileLayout branch also renders {children} earlier in the source —
    // find the {children} occurrence AFTER the banner (the desktop <main> one).
    const childrenIndexAfterBanner = layoutSwitcherBody.indexOf('{children}', bannerIndex);
    expect(bannerIndex).toBeGreaterThan(-1);
    expect(childrenIndexAfterBanner).toBeGreaterThan(-1);
    expect(bannerIndex).toBeLessThan(childrenIndexAfterBanner);
  });
});
