import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

test.describe('Shift Template Capacity', () => {
  test('manager can set staff needed and see capacity indicator', async ({ page }) => {
    // 1. Sign up and create restaurant
    const testUser = generateTestUser('shift-cap');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    // Seed an employee so the planner renders (not empty-employees state)
    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    await page.evaluate(
      ({ emps, restId }) => (window as any).__insertEmployees(emps, restId),
      {
        emps: [
          {
            name: 'Alex Rivera',
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

    // 2. Navigate to /scheduling
    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    // Click the Planner tab
    const plannerTab = page.getByRole('tab', { name: /planner/i });
    await expect(plannerTab).toBeVisible({ timeout: 10000 });
    await plannerTab.click();

    // Wait for planner to load (employee sidebar or empty-template state)
    await expect(page.getByText('Alex Rivera')).toBeVisible({ timeout: 10000 });

    // 3. Click "Add Shift Template"
    await page.getByRole('button', { name: /add shift template/i }).click();

    // 4. Fill template form
    const dialog = page.getByRole('dialog', { name: /add shift template/i });
    await expect(dialog).toBeVisible({ timeout: 3000 });

    await dialog.locator('#template-name').fill('Closing Server');
    await dialog.locator('#start-time').fill('16:00');
    await dialog.locator('#end-time').fill('22:00');
    await dialog.locator('#position').fill('Server');

    // 5. Click Monday button
    await dialog.getByRole('button', { name: 'Monday' }).click();

    // 6. Set Staff Needed to 3
    const staffNeededInput = dialog.locator('#capacity');
    await staffNeededInput.clear();
    await staffNeededInput.fill('3');

    // 7. Submit
    const templateCreatePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('rest/v1/shift_templates') && resp.status() === 201,
      { timeout: 15000 },
    );

    await dialog.getByRole('button', { name: /add template/i }).click();
    await templateCreatePromise;

    // Dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // 8. Wait for template to appear in the grid (dismisses toast naturally)
    await expect(page.getByText('Closing Server')).toBeVisible({ timeout: 10000 });

    // 9. Dismiss any remaining toasts that might overlay elements
    const toast = page.locator('[data-sonner-toast]').first();
    if (await toast.isVisible({ timeout: 1000 }).catch(() => false)) {
      await toast.locator('button[aria-label="Close"]').click().catch(() => {});
    }

    // 10. Verify "0/3" capacity indicator is visible somewhere on the page
    // The indicator shows assigned/capacity, starting at 0/3 for a new template
    await expect(page.getByText('0/3')).toBeVisible({ timeout: 5000 });
  });

  test('default capacity shows no indicator', async ({ page }) => {
    // 1. Sign up and create restaurant
    const testUser = generateTestUser('shift-cap-default');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    // Seed an employee so the planner renders
    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    await page.evaluate(
      ({ emps, restId }) => (window as any).__insertEmployees(emps, restId),
      {
        emps: [
          {
            name: 'Sam Torres',
            position: 'Cashier',
            status: 'active',
            is_active: true,
            compensation_type: 'hourly',
            hourly_rate: 1400,
          },
        ],
        restId: restaurantId,
      },
    );

    // 2. Navigate to /scheduling
    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    // Click the Planner tab
    const plannerTab = page.getByRole('tab', { name: /planner/i });
    await expect(plannerTab).toBeVisible({ timeout: 10000 });
    await plannerTab.click();

    // Wait for planner to load
    await expect(page.getByText('Sam Torres')).toBeVisible({ timeout: 10000 });

    // 3. Click "Add Shift Template"
    await page.getByRole('button', { name: /add shift template/i }).click();

    // 4. Fill template form
    const dialog = page.getByRole('dialog', { name: /add shift template/i });
    await expect(dialog).toBeVisible({ timeout: 3000 });

    await dialog.locator('#template-name').fill('Morning Cashier');
    await dialog.locator('#start-time').fill('06:00');
    await dialog.locator('#end-time').fill('14:00');
    await dialog.locator('#position').fill('Cashier');

    // 5. Click Tuesday button
    await dialog.getByRole('button', { name: 'Tuesday' }).click();

    // 6. Verify "Staff Needed" input defaults to 1 — do NOT change it
    const staffNeededInput = dialog.locator('#capacity');
    await expect(staffNeededInput).toHaveValue('1');

    // 7. Submit
    const templateCreatePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('rest/v1/shift_templates') && resp.status() === 201,
      { timeout: 15000 },
    );

    await dialog.getByRole('button', { name: /add template/i }).click();
    await templateCreatePromise;

    // Dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // 8. Wait for template to appear in the grid
    await expect(page.getByText('Morning Cashier')).toBeVisible({ timeout: 10000 });

    // 9. Dismiss any remaining toasts
    const toast = page.locator('[data-sonner-toast]').first();
    if (await toast.isVisible({ timeout: 1000 }).catch(() => false)) {
      await toast.locator('button[aria-label="Close"]').click().catch(() => {});
    }

    // 10. Verify NO "0/1" indicator is shown (capacity=1 is intentionally hidden)
    await expect(page.getByText('0/1')).not.toBeVisible();
  });
});
