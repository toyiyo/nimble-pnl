import { test, expect } from '@playwright/test';
import { generateTestUser, signUpAndCreateRestaurant, exposeSupabaseHelpers } from '../helpers/e2e-supabase';

test.describe('Employee Help Video Cards', () => {
  test('help video cards are visible on schedule page and can be dismissed', async ({ page }) => {
    // === SETUP: Sign up and create restaurant ===
    const user = generateTestUser('help-videos');
    await signUpAndCreateRestaurant(page, user);

    // Ensure helpers are available (signUpAndCreateRestaurant calls exposeSupabaseHelpers internally,
    // but we call it again to be sure after the navigation flow settles)
    await exposeSupabaseHelpers(page);

    // === SETUP: Get restaurant and user IDs ===
    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    const userId = await page.evaluate(() =>
      (window as any).__getAuthUser().then((u: any) => u?.id)
    );
    expect(userId).toBeTruthy();

    // === SETUP: Set subscription tier to pro so features are unlocked ===
    await page.evaluate(
      (restId) => (window as any).__setSubscriptionTier(restId, 'pro', 'active'),
      restaurantId
    );

    // === SETUP: Create an employee record linked to the test user ===
    await page.evaluate(
      async ({ restId, uid, email }: { restId: string; uid: string; email: string }) => {
        const inserted = await (window as any).__insertEmployees(
          [
            {
              user_id: uid,
              email,
              name: 'Help Video Test Employee',
              position: 'Server',
              status: 'active',
              is_active: true,
              compensation_type: 'hourly',
              hourly_rate: 1500,
            },
          ],
          restId
        );
        if (!inserted || inserted.length === 0) throw new Error('Failed to create employee');
      },
      { restId: restaurantId, uid: userId, email: user.email }
    );

    // === SETUP: Set the user role to 'staff' ===
    await page.evaluate(
      async ({ restId, uid }: { restId: string; uid: string }) => {
        const { error } = await (window as any).__supabase
          .from('user_restaurants')
          .update({ role: 'staff' })
          .eq('restaurant_id', restId)
          .eq('user_id', uid);
        if (error) throw new Error(`Failed to update role: ${error.message}`);
      },
      { restId: restaurantId, uid: userId }
    );

    // === SETUP: Reload so the staff role takes effect in the UI routing ===
    await page.reload();
    await page.waitForLoadState('networkidle');

    // === NAVIGATE: Go to employee schedule page ===
    await page.goto('/employee/schedule');
    await page.waitForLoadState('networkidle');

    // Wait for the page to settle and employee to be loaded
    await expect(page).toHaveURL(/\/employee\/schedule/, { timeout: 10000 });

    // === VERIFY: Both help video cards are visible (expanded state shows title text) ===
    await expect(page.getByText('Welcome to EasyShiftHQ')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Viewing Your Schedule')).toBeVisible({ timeout: 10000 });

    // === VERIFY: Video elements are rendered (cards are expanded) ===
    const videoPlayers = page.locator('[data-testid="help-video-player"]');
    await expect(videoPlayers.first()).toBeVisible({ timeout: 5000 });

    // === ACTION: Dismiss the welcome card ===
    // The dismiss button has aria-label "Dismiss help video" and is inside the welcome card
    // We find the first dismiss button (for the welcome card which appears first)
    const dismissButtons = page.getByRole('button', { name: /dismiss help video/i });
    await expect(dismissButtons.first()).toBeVisible({ timeout: 5000 });
    await dismissButtons.first().click();

    // === VERIFY: Welcome card collapses to pill after dismiss ===
    // The expanded card with video disappears; only the pill button remains
    // The video element for the welcome card should no longer be visible
    await expect(page.getByText('Welcome to EasyShiftHQ')).toBeVisible({ timeout: 5000 });

    // After dismiss, the welcome card should be a collapsed pill (button, not expanded card)
    // The schedule card should still be expanded
    const welcomePill = page.getByRole('button', { name: 'Welcome to EasyShiftHQ' });
    await expect(welcomePill).toBeVisible({ timeout: 5000 });

    // === ACTION: Reload the page to verify persistence ===
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/employee\/schedule/, { timeout: 10000 });

    // Wait for the page content to load
    await page.waitForTimeout(1000);

    // === VERIFY: After reload, welcome card remains collapsed (persisted in localStorage) ===
    // The welcome card should render as the collapsed pill button, not the expanded card with video
    const welcomePillAfterReload = page.getByRole('button', { name: 'Welcome to EasyShiftHQ' });
    await expect(welcomePillAfterReload).toBeVisible({ timeout: 10000 });

    // The schedule card should still be expanded (still shows its video)
    await expect(page.getByText('Viewing Your Schedule')).toBeVisible({ timeout: 5000 });
  });
});
