import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

test.describe('Planner mobile layout', () => {
  test('overview panel renders stacked with visible day cards', async ({ page }) => {
    // Do signup at desktop viewport — OnboardingDrawer's SheetContent is
    // wider than a 390px mobile viewport and would intercept the "Add
    // Restaurant" click. Switch to mobile once we're ready to exercise the
    // planner (useIsMobile uses matchMedia and re-renders on width change).
    const user = generateTestUser('mobile-overview');
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    // Seed an employee so the planner renders (empty-state bypasses the panel).
    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    await page.evaluate(
      ({ restId }) => (window as any).__insertEmployees(
        [{ name: 'Mobile Tester', position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 }],
        restId,
      ),
      { restId: restaurantId },
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/scheduling');
    await page.getByRole('tab', { name: /planner/i }).click();

    // Overview panel expanded by default
    await expect(page.getByRole('region', { name: /weekly schedule overview/i })).toBeVisible();

    // 7 day cards are rendered
    const dayCards = page.locator('[data-overview-day]');
    await expect(dayCards).toHaveCount(7);

    // Collapsing hides the cards. The panel body stays mounted (with the
    // `hidden` HTML attribute) so `aria-controls` always resolves to an
    // element, but the cards become non-visible.
    await page.getByRole('button', { expanded: true, name: /schedule overview/i }).click();
    await expect(dayCards.first()).not.toBeVisible();
  });
});
