import { test, expect, Page } from '@playwright/test';
import { generateTestUser, signUpAndCreateRestaurant, exposeSupabaseHelpers } from '../helpers/e2e-supabase';

// Mobile viewport dimensions
const MOBILE_WIDTH = 375;
const MOBILE_HEIGHT = 812;

// Helper to update a user's role via the database and reload
async function setUserRole(page: Page, role: string): Promise<void> {
  await exposeSupabaseHelpers(page);
  await page.evaluate(
    async ({ role }) => {
      const user = await (window as any).__getAuthUser();
      if (!user?.id) throw new Error('No user session');

      const restaurantId = await (window as any).__getRestaurantId(user.id);
      if (!restaurantId) throw new Error('No restaurant');

      const { error } = await (window as any).__supabase
        .from('user_restaurants')
        .update({ role })
        .eq('user_id', user.id)
        .eq('restaurant_id', restaurantId);

      if (error) throw new Error(`Failed to update role: ${error.message}`);
    },
    { role }
  );
  await page.reload();
  await page.waitForLoadState('networkidle');
}

// Helper: sign up at desktop width (avoids OnboardingDrawer overlap),
// then set staff role and resize to mobile viewport
async function setupStaffMobile(page: Page, prefix: string): Promise<void> {
  const user = generateTestUser(prefix);
  await signUpAndCreateRestaurant(page, user);
  await setUserRole(page, 'staff');
  await page.setViewportSize({ width: MOBILE_WIDTH, height: MOBILE_HEIGHT });
  await page.reload();
  await page.waitForLoadState('networkidle');
}

// ============================================================
// EMPLOYEE MOBILE EXPERIENCE TESTS
// ============================================================

test.describe('Employee Mobile Experience', () => {
  test('staff user sees bottom tab bar on mobile, not sidebar', async ({ page }) => {
    await setupStaffMobile(page, 'staff-mobile');

    await expect(page).toHaveURL('/employee/schedule', { timeout: 10000 });

    // Should see tab bar with correct aria-label
    await expect(page.getByRole('navigation', { name: /employee navigation/i })).toBeVisible();

    // Should NOT see sidebar
    await expect(page.locator('[data-sidebar]')).not.toBeVisible();
  });

  test('default landing page is Schedule', async ({ page }) => {
    await setupStaffMobile(page, 'staff-landing');

    await expect(page).toHaveURL('/employee/schedule', { timeout: 10000 });
  });

  test('can navigate between tabs', async ({ page }) => {
    await setupStaffMobile(page, 'staff-tabs');
    await expect(page).toHaveURL('/employee/schedule', { timeout: 10000 });

    // Navigate to Pay
    await page.getByRole('link', { name: /pay/i }).click();
    await expect(page).toHaveURL(/\/employee\/pay/);

    // Navigate to Clock
    await page.getByRole('link', { name: /clock/i }).click();
    await expect(page).toHaveURL(/\/employee\/clock/);

    // Navigate to More
    await page.getByRole('link', { name: /more/i }).click();
    await expect(page).toHaveURL(/\/employee\/more/);
  });

  test('More page shows all sub-navigation items', async ({ page }) => {
    await setupStaffMobile(page, 'staff-more');
    await page.goto('/employee/more', { waitUntil: 'networkidle' });

    await expect(page.getByText('Timecard')).toBeVisible();
    await expect(page.getByText('Requests')).toBeVisible();
    await expect(page.getByText('Shift Marketplace')).toBeVisible();
    await expect(page.getByText('Tips')).toBeVisible();
    await expect(page.getByText('Settings')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
  });

  test('More page links navigate to correct pages', async ({ page }) => {
    await setupStaffMobile(page, 'staff-more-nav');
    await page.goto('/employee/more', { waitUntil: 'networkidle' });

    await page.getByText('Timecard').click();
    await expect(page).toHaveURL(/\/employee\/timecard/);

    // More tab should still be highlighted (timecard is under moreRoutes)
    const moreTab = page.getByRole('link', { name: /more/i });
    await expect(moreTab).toHaveAttribute('aria-current', 'page');
  });
});
