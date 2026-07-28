import { test, expect, Locator, Page } from '@playwright/test';
import { generateTestUser, signUpAndCreateRestaurant, exposeSupabaseHelpers } from '../helpers/e2e-supabase';

/**
 * E2E: Admin ↔ My Work dual-mode view switching.
 *
 * Design: docs/superpowers/specs/2026-07-24-admin-work-view-mode-design.md
 * Plan:   docs/superpowers/plans/2026-07-24-admin-work-view-mode-plan.md (Task 12)
 *
 * Covers the cross-layer seam that unit/component tests can't: an owner with a
 * linked active employee record sees the "You're viewing as" persona card,
 * switching to "My Work" lands on /employee/schedule with employee chrome
 * (staff nav + personal-view banner), and "Back to admin" returns to the
 * stashed route with admin chrome restored. A plain owner (no linked employee
 * record) never sees the persona card at all — it fails closed.
 */

interface WindowWithHelpers extends Window {
  __getAuthUser: () => Promise<{ id: string } | null>;
  __getRestaurantId: (userId?: string) => Promise<string | null>;
  __insertEmployees: (rows: unknown[], restaurantId: string) => Promise<unknown[]>;
}

/** Link an active employee record to the currently signed-in user. */
async function linkCurrentUserAsEmployee(page: Page, name = 'View Mode Owner') {
  await exposeSupabaseHelpers(page);

  await page.evaluate(async ({ name }) => {
    const win = window as unknown as WindowWithHelpers;
    const user = await win.__getAuthUser();
    if (!user?.id) throw new Error('No user session');

    const restaurantId = await win.__getRestaurantId(user.id);
    if (!restaurantId) throw new Error('No restaurant');

    await win.__insertEmployees(
      [
        {
          name,
          position: 'Owner',
          status: 'active',
          is_active: true,
          compensation_type: 'hourly',
          hourly_rate: 2500,
          user_id: user.id,
        },
      ],
      restaurantId
    );
  }, { name });
}

/** The "You're viewing as" persona card — `role="group"` per the design's non-radiogroup a11y note. */
function viewModeSwitchGroup(page: Page) {
  return page.getByRole('group', { name: 'View mode' });
}

/**
 * Measure an element's real rendered text contrast in the browser.
 *
 * Walks up for the first fully-opaque background, compositing any translucent
 * layers on the way back down, then applies the text colour's own alpha. This
 * is deliberately a *rendered* measurement rather than a class assertion: the
 * persona card once shipped with a perfectly semantic `text-muted-foreground`
 * that measured 1.03:1 on screen, because the token was scoped to a different
 * surface than the one it was mounted on.
 *
 * See docs/superpowers/specs/2026-07-28-persona-card-contrast-design.md
 */
async function renderedContrast(locator: Locator): Promise<number> {
  return locator.evaluate((el: HTMLElement) => {
    type Rgb = [number, number, number];

    const parse = (value: string): { rgb: Rgb; alpha: number } => {
      const m = /rgba?\(([^)]+)\)/.exec(value);
      if (!m) return { rgb: [0, 0, 0], alpha: 0 };
      const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      return {
        rgb: [parts[0], parts[1], parts[2]],
        alpha: parts.length > 3 ? parts[3] : 1,
      };
    };

    const over = (fg: Rgb, alpha: number, bg: Rgb): Rgb => [
      alpha * fg[0] + (1 - alpha) * bg[0],
      alpha * fg[1] + (1 - alpha) * bg[1],
      alpha * fg[2] + (1 - alpha) * bg[2],
    ];

    // Collect translucent backgrounds nearest-first until an opaque one stops us.
    const translucent: Array<{ rgb: Rgb; alpha: number }> = [];
    let base: Rgb = [255, 255, 255];
    for (let node: HTMLElement | null = el; node; node = node.parentElement) {
      const layer = parse(getComputedStyle(node).backgroundColor);
      if (layer.alpha === 0) continue;
      if (layer.alpha >= 1) {
        base = layer.rgb;
        break;
      }
      translucent.push(layer);
    }

    // Repaint bottom-up to get the surface the text actually sits on.
    let surface = base;
    for (let i = translucent.length - 1; i >= 0; i--) {
      surface = over(translucent[i].rgb, translucent[i].alpha, surface);
    }

    const color = parse(getComputedStyle(el).color);
    const text = over(color.rgb, color.alpha, surface);

    const luminance = (c: Rgb) => {
      const lin = (v: number) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    };

    const [lo, hi] = [luminance(text), luminance(surface)].sort((a, b) => a - b);
    return (hi + 0.05) / (lo + 0.05);
  });
}

test.describe('View mode switching (Admin ↔ My Work)', () => {
  test('owner with a linked employee can switch to My Work and back to Admin', async ({ page }) => {
    const user = generateTestUser('viewmode-eligible');
    await signUpAndCreateRestaurant(page, user);
    await linkCurrentUserAsEmployee(page);

    // useCurrentEmployee is a React Query with a 60s staleTime keyed off restaurantId;
    // reload so it refetches now that the employee row exists.
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Persona card visible in the expanded SidebarFooter, defaulted to "Admin".
    const switchGroup = viewModeSwitchGroup(page);
    await expect(switchGroup).toBeVisible({ timeout: 10000 });
    const adminToggle = switchGroup.getByRole('button', { name: 'Admin' });
    const workToggle = switchGroup.getByRole('button', { name: 'My Work' });
    await expect(adminToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(workToggle).toHaveAttribute('aria-pressed', 'false');

    // Every label in the card must be legible where it is actually mounted —
    // the sidebar footer, whose surface is dark even under the light theme.
    // WCAG 1.4.3 normal text; all three labels are 11-13px.
    expect(await renderedContrast(page.getByText(/you're viewing as/i))).toBeGreaterThanOrEqual(4.5);
    expect(await renderedContrast(page.getByText(/switch to clock in/i))).toBeGreaterThanOrEqual(4.5);
    expect(await renderedContrast(workToggle)).toBeGreaterThanOrEqual(4.5);

    // Admin chrome is showing: Dashboard nav item present.
    await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();

    // Switch to My Work.
    await workToggle.click();

    await expect(page).toHaveURL(/\/employee\/schedule$/, { timeout: 10000 });

    // Employee chrome: staff nav item present, admin-only nav item gone.
    await expect(page.getByRole('button', { name: 'My Schedule' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).not.toBeVisible();

    // Personal-view banner (desktop variant), role="status".
    const banner = page.getByRole('status').filter({ hasText: "You're in your personal view." });
    await expect(banner).toBeVisible();

    // Persona card now reflects "My Work" as pressed.
    await expect(workToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(adminToggle).toHaveAttribute('aria-pressed', 'false');

    // Return to admin via the banner's "Back to admin" control.
    await page.getByRole('button', { name: /back to admin/i }).click();

    // Stashed route was '/' (the dashboard) at the time "My Work" was clicked.
    await expect(page).toHaveURL(/\/$/, { timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'My Schedule' })).not.toBeVisible();
    await expect(banner).not.toBeVisible();

    await expect(viewModeSwitchGroup(page).getByRole('button', { name: 'Admin' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  test('a plain owner without a linked employee record never sees the persona card', async ({ page }) => {
    const user = generateTestUser('viewmode-ineligible');
    await signUpAndCreateRestaurant(page, user);

    // No employee record linked — computeCanUseWorkView must be false.
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible({ timeout: 10000 });
    await expect(viewModeSwitchGroup(page)).toHaveCount(0);
  });
});
