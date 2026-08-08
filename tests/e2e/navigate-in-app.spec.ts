import { test, expect } from '@playwright/test';
import { navigateInApp } from '../helpers/e2e-navigation';

/**
 * Self-test for `navigateInApp`, the helper the route sweeps in
 * permissions-roles.spec.ts use instead of a full `page.goto`.
 *
 * Without this, the helper has a silent false-green mode: if react-router ever
 * stops listening for `popstate`, every sweep would still "pass" because the
 * helper sets `window.location` itself — the assertions would be checking the
 * URL the test just wrote, not a routing decision.
 *
 * These cases run signed out, so they need no database: `ProtectedRoute`
 * redirecting an anonymous visitor to /auth is the same `<Navigate replace>`
 * mechanism the role guards use.
 */
test.describe('navigateInApp', () => {
  test('routes client-side and lets a redirect guard settle the URL', async ({ page }) => {
    await page.goto('/auth');
    await expect(page.getByRole('tab', { name: /sign up/i })).toBeVisible();

    // Survives a client-side navigation; a full page load would wipe it.
    await page.evaluate(() => {
      (window as unknown as { __noReload?: true }).__noReload = true;
    });

    // A public route: the router should swap the view without a reload.
    await navigateInApp(page, '/forgot-password');
    await expect(page).toHaveURL('/forgot-password');
    await expect(page.getByRole('tab', { name: /sign up/i })).toBeHidden();

    // A guarded route: ProtectedRoute sends an anonymous visitor to /auth.
    // This is what proves the helper drives real routing rather than just
    // rewriting the address bar.
    await navigateInApp(page, '/team');
    await expect(page).toHaveURL('/auth');

    expect(
      await page.evaluate(() => (window as unknown as { __noReload?: true }).__noReload)
    ).toBe(true);
  });

  test('refuses to run before the SPA has booted, instead of silently passing', async ({ page }) => {
    await page.goto('about:blank');
    await expect(navigateInApp(page, '/team')).rejects.toThrow(/booted SPA/);
  });
});
