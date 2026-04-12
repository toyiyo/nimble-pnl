import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

test.describe('Shift Template Areas', () => {
  test('can create templates with area, see area filter pills, and filter by area', async ({ page }) => {
    // 1. Sign up and create restaurant
    const testUser = generateTestUser('tmpl-area');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    // Seed two employees so the planner renders
    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    await page.evaluate(
      ({ emps, restId }) => (window as any).__insertEmployees(emps, restId),
      {
        emps: [
          {
            name: 'Chef Maria',
            position: 'Prep Cook',
            status: 'active',
            is_active: true,
            compensation_type: 'hourly',
            hourly_rate: 1800,
          },
          {
            name: 'Server Lisa',
            position: 'Server',
            status: 'active',
            is_active: true,
            compensation_type: 'hourly',
            hourly_rate: 1500,
          },
        ],
        restId: restaurantId,
      },
    );

    // 2. Navigate to scheduling, click Planner tab
    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    const plannerTab = page.getByRole('tab', { name: /planner/i });
    await expect(plannerTab).toBeVisible({ timeout: 10000 });
    await plannerTab.click();

    await expect(page.getByText('Chef Maria')).toBeVisible({ timeout: 10000 });

    // 3. Create first template — Back of House
    await page.getByRole('button', { name: /add shift template/i }).click();

    const dialog = page.getByRole('dialog', { name: /add shift template/i });
    await expect(dialog).toBeVisible({ timeout: 3000 });

    await dialog.locator('#template-name').fill('Opening Prep');
    await dialog.locator('#start-time').fill('06:00');
    await dialog.locator('#end-time').fill('14:00');
    await dialog.locator('#position').fill('Prep Cook');

    // Open the AreaCombobox (trigger has role="combobox" and aria-label="Select employee area")
    await dialog.getByRole('combobox', { name: /select employee area/i }).click();

    // CommandItem renders with role="option" via CMDK
    await page.getByRole('option', { name: /back of house/i }).click();

    // Select Monday
    await dialog.getByRole('button', { name: 'Monday' }).click();

    // Submit
    const create1 = page.waitForResponse(
      (resp) => resp.url().includes('rest/v1/shift_templates') && resp.status() === 201,
      { timeout: 15000 },
    );
    await dialog.getByRole('button', { name: /add template/i }).click();
    await create1;
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Dismiss any toast so it does not block interactions
    const toast1 = page.locator('[data-sonner-toast]').first();
    if (await toast1.isVisible({ timeout: 1000 }).catch(() => false)) {
      await toast1.locator('button[aria-label="Close"]').click().catch(() => {});
    }

    // 4. Create second template — Front of House
    await page.getByRole('button', { name: /add shift template/i }).click();

    const dialog2 = page.getByRole('dialog', { name: /add shift template/i });
    await expect(dialog2).toBeVisible({ timeout: 3000 });

    await dialog2.locator('#template-name').fill('Opening Server');
    await dialog2.locator('#start-time').fill('10:00');
    await dialog2.locator('#end-time').fill('18:00');
    await dialog2.locator('#position').fill('Server');

    await dialog2.getByRole('combobox', { name: /select employee area/i }).click();
    await page.getByRole('option', { name: /front of house/i }).click();

    await dialog2.getByRole('button', { name: 'Monday' }).click();

    const create2 = page.waitForResponse(
      (resp) => resp.url().includes('rest/v1/shift_templates') && resp.status() === 201,
      { timeout: 15000 },
    );
    await dialog2.getByRole('button', { name: /add template/i }).click();
    await create2;
    await expect(dialog2).not.toBeVisible({ timeout: 5000 });

    // 5. Verify both templates are visible in the grid
    await expect(page.getByText('Opening Prep')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Opening Server')).toBeVisible({ timeout: 5000 });

    // 6. Verify area filter pills appear (AreaFilterPills renders plain <button> elements)
    // "All" pill is active by default (selectedArea === null matches pill.value === null)
    const allPill = page.locator('button').filter({ hasText: /^All$/ });
    await expect(allPill).toBeVisible({ timeout: 5000 });

    const bohPill = page.locator('button').filter({ hasText: /^Back of House$/ });
    await expect(bohPill).toBeVisible();

    const fohPill = page.locator('button').filter({ hasText: /^Front of House$/ });
    await expect(fohPill).toBeVisible();

    // 7. Filter to Back of House — only Opening Prep should remain visible
    await bohPill.click();

    await expect(page.getByText('Opening Prep')).toBeVisible();
    await expect(page.getByText('Opening Server')).not.toBeVisible({ timeout: 3000 });

    // 8. Reset to All — both templates visible again
    await allPill.click();
    await expect(page.getByText('Opening Prep')).toBeVisible();
    await expect(page.getByText('Opening Server')).toBeVisible();
  });
});
