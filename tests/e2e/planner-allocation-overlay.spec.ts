import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

test.describe('Planner allocation overlay', () => {
  test('hovering an employee tints active template cells (available state)', async ({ page }) => {
    const user = generateTestUser('alloc-overlay');
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());

    await page.evaluate(
      ({ restId }) => (window as any).__insertEmployees(
        [
          { name: 'Jose Delgado', position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
        ],
        restId,
      ),
      { restId: restaurantId },
    );

    await page.goto('/scheduling');
    await page.getByRole('tab', { name: /planner/i }).click();
    await expect(page.getByText('Jose Delgado')).toBeVisible({ timeout: 10000 });

    // Create a simple weekday template so the grid has at least one active cell.
    await page.getByRole('button', { name: /add shift template/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.locator('#template-name').fill('Morning');
    await dialog.locator('#start-time').fill('09:00');
    await dialog.locator('#end-time').fill('17:00');
    await dialog.locator('#position').fill('Server');
    // Select Monday (aria-label="Monday")
    await dialog.getByRole('button', { name: 'Monday' }).click();
    await dialog.getByRole('button', { name: /add template/i }).click();
    await expect(dialog).toBeHidden({ timeout: 5000 });

    // Hover the employee card
    await page.getByText('Jose Delgado').hover();

    // At least one cell should carry data-allocation-status="available"
    await expect(
      page.locator('[data-allocation-status="available"]').first(),
    ).toBeVisible({ timeout: 3000 });
  });
});
