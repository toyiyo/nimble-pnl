import { Page, expect } from '@playwright/test';

/**
 * Navigate inside the already-booted SPA, the way a real user does.
 *
 * `page.goto` is a full browser navigation: Vite re-serves the module graph,
 * auth restores the session, and the membership query re-runs — 4-6s per hop on
 * CI's unbundled dev server. A sweep over a dozen routes spends all of that
 * re-proving the boot sequence the test already proved on its first navigation,
 * and it is what pushed these specs past their time budget.
 *
 * Pushing the path through the History API exercises the same router and the
 * same `StaffRoleChecker` guard for ~100ms instead. Cold-boot-into-a-guarded-
 * route stays covered by the real navigations each spec still does (the
 * `page.reload()` in `setUserRole`, and the dedicated single-route tests).
 *
 * Resolves once the URL has stopped moving, so the caller asserts on a settled
 * location rather than one a guard is about to change.
 */
export async function navigateInApp(page: Page, path: string): Promise<void> {
  const mounted = await page.evaluate(() =>
    Boolean(document.getElementById('root')?.firstElementChild)
  );
  if (!mounted) {
    throw new Error(
      `navigateInApp('${path}') needs a booted SPA, but #root is empty. ` +
        'Load the app with a real page.goto (or page.reload) first.'
    );
  }

  await page.evaluate((target) => {
    // Mirror the state shape react-router writes so its internal history index
    // keeps counting — a guard's own <Navigate replace> reads it on the way out.
    const idx = ((window.history.state as { idx?: number } | null)?.idx ?? 0) + 1;
    window.history.pushState({ usr: null, key: String(idx), idx }, '', target);
    // pushState is silent by design; the router only wakes up on popstate.
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);

  await waitForUrlToSettle(page, path);
}

/** Wait until the pathname holds still across two consecutive polls. */
async function waitForUrlToSettle(page: Page, requested: string): Promise<void> {
  let previous: string | null = null;
  await expect
    .poll(
      () => {
        const current = new URL(page.url()).pathname;
        const held = current === previous;
        previous = current;
        return held;
      },
      {
        message: `URL never settled after navigating to '${requested}' — the app kept redirecting.`,
        timeout: 10_000,
        intervals: [100, 100, 200, 400, 1000],
      }
    )
    .toBe(true);
}
