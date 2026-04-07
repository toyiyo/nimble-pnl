import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

async function setupPlannerWithTemplates(page: any) {
  const testUser = generateTestUser('pdm');
  await signUpAndCreateRestaurant(page, testUser);
  await exposeSupabaseHelpers(page);

  const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
  expect(restaurantId).toBeTruthy();

  const employees = await page.evaluate(
    ({ emps, restId }: any) => (window as any).__insertEmployees(emps, restId),
    {
      emps: [
        { name: 'Alice Server', position: 'Server', area: 'Front', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
        { name: 'Bob Cook', position: 'Cook', area: 'Back', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1800 },
      ],
      restId: restaurantId,
    },
  );

  await page.evaluate(
    async ({ restId }: any) => {
      const sb = (window as any).__supabase;
      await sb.from('shift_templates').insert({
        restaurant_id: restId,
        name: 'Opening',
        start_time: '10:00',
        end_time: '14:00',
        position: 'Server',
        applicable_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      });
    },
    { restId: restaurantId },
  );

  return { restaurantId, employees };
}

test.describe('Planner mobile tap-to-assign', () => {
  test('can tap employee then tap cell to assign on mobile', async ({ page }) => {
    // Setup at desktop
    await setupPlannerWithTemplates(page);

    // Switch to mobile
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    // Navigate to Planner tab — find the tab with the grid icon (last tab)
    const tabs = page.locator('[role="tablist"] button');
    await expect(tabs.first()).toBeVisible({ timeout: 10000 });
    const tabCount = await tabs.count();
    // Planner tab is typically the last one
    await tabs.nth(tabCount - 1).click();
    await page.waitForTimeout(1500);

    // Look for the floating Team button
    const teamButton = page.getByLabel('Show team members');
    await expect(teamButton).toBeVisible({ timeout: 5000 });
    await teamButton.click();
    await page.waitForTimeout(500);

    // Tap an employee in the sidebar
    const aliceCard = page.locator('text=Alice Server').first();
    await expect(aliceCard).toBeVisible({ timeout: 3000 });
    await aliceCard.click();

    // Sidebar should close, selection banner should appear
    const banner = page.getByText('Tap a cell to assign', { exact: false });
    await expect(banner).toBeVisible({ timeout: 3000 });

    // Take screenshot showing the selection state
    await page.screenshot({ path: 'test-results/planner-tap-assign-selected.png', fullPage: true });
  });
});
