import { test, expect, devices } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser } from '../helpers/e2e-supabase';

test.use({ ...devices['iPhone 13'] });

test.describe('Planner mobile layout', () => {
  test('overview panel renders stacked with visible day cards', async ({ page }) => {
    const user = generateTestUser('mobile-overview');
    await signUpAndCreateRestaurant(page, user);
    await page.goto('/scheduling');
    await page.getByRole('tab', { name: /planner/i }).click();

    // Overview panel expanded by default
    await expect(page.getByRole('region', { name: /weekly schedule overview/i })).toBeVisible();

    // 7 day cards are rendered
    const dayCards = page.locator('[data-overview-day]');
    await expect(dayCards).toHaveCount(7);

    // Collapsing works
    await page.getByRole('button', { expanded: true, name: /schedule overview/i }).click();
    await expect(dayCards).toHaveCount(0);
  });
});
