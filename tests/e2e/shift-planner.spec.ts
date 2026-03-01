import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

test.describe('Shift Planner v2 (Template-First)', () => {
  test('creates shift template and displays in grid', async ({ page }) => {
    const testUser = generateTestUser('planner-v2');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // Seed employees
    await page.evaluate(
      ({ emps, restId }) => (window as any).__insertEmployees(emps, restId),
      {
        emps: [
          { name: 'Alice Johnson', position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
          { name: 'Bob Smith', position: 'Cook', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1800 },
        ],
        restId: restaurantId,
      },
    );

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    // Click Planner tab
    const plannerTab = page.getByRole('tab', { name: /planner/i });
    await expect(plannerTab).toBeVisible({ timeout: 10000 });
    await plannerTab.click();

    // Should see empty template state
    await expect(page.getByText('No shift templates yet')).toBeVisible({ timeout: 10000 });

    // Should see employees in sidebar
    await expect(page.getByText('Alice Johnson')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Bob Smith')).toBeVisible({ timeout: 5000 });

    // Click "Add Shift Template"
    await page.getByRole('button', { name: /add shift template/i }).click();

    // Fill template dialog
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Fill name
    await dialog.locator('#template-name').fill('Morning');

    // Fill times
    await dialog.locator('#start-time').fill('06:00');
    await dialog.locator('#end-time').fill('12:00');

    // Fill position
    await dialog.locator('#position').fill('Server');

    // Select weekdays (Mon-Fri) — click day toggle buttons by their aria-labels
    await dialog.getByRole('button', { name: 'Monday' }).click();
    await dialog.getByRole('button', { name: 'Tuesday' }).click();
    await dialog.getByRole('button', { name: 'Wednesday' }).click();
    await dialog.getByRole('button', { name: 'Thursday' }).click();
    await dialog.getByRole('button', { name: 'Friday' }).click();

    // Set up response listener for template creation
    const templateCreatePromise = page.waitForResponse(
      resp => resp.url().includes('rest/v1/shift_templates') && resp.status() === 201,
      { timeout: 15000 },
    );

    // Submit
    await dialog.getByRole('button', { name: /add template/i }).click();

    // Wait for creation
    await templateCreatePromise;

    // Dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Template should appear in grid
    await expect(page.getByText('Morning')).toBeVisible({ timeout: 5000 });
    // Time range should show (compact format like "6a-12p")
    await expect(page.getByText(/6a.*12p/)).toBeVisible({ timeout: 5000 });
  });

  test('week navigation changes displayed dates', async ({ page }) => {
    const testUser = generateTestUser('planner-v2-nav');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());

    // Seed an employee (needed to not hit empty-employees state)
    await page.evaluate(
      ({ emps, restId }) => (window as any).__insertEmployees(emps, restId),
      {
        emps: [
          { name: 'Charlie Brown', position: 'Host', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1200 },
        ],
        restId: restaurantId,
      },
    );

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    const plannerTab = page.getByRole('tab', { name: /planner/i });
    await expect(plannerTab).toBeVisible({ timeout: 10000 });
    await plannerTab.click();

    // Wait for planner to render (employees sidebar or empty template state)
    await expect(page.getByText('Charlie Brown')).toBeVisible({ timeout: 10000 });

    // Capture current date range
    const dateRange = page.locator('.text-\\[15px\\].font-semibold');
    await expect(dateRange).toBeVisible();
    const initialText = await dateRange.textContent();
    expect(initialText).toBeTruthy();

    // Navigate next week
    await page.getByRole('button', { name: 'Next week' }).click();
    await expect(dateRange).not.toHaveText(initialText!, { timeout: 5000 });

    const nextWeekText = await dateRange.textContent();

    // Navigate back
    await page.getByRole('button', { name: 'Previous week' }).click();
    await expect(dateRange).toHaveText(initialText!, { timeout: 5000 });

    expect(nextWeekText).not.toBe(initialText);
  });

  test('empty state shows when no employees exist', async ({ page }) => {
    const testUser = generateTestUser('planner-v2-empty');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    const plannerTab = page.getByRole('tab', { name: /planner/i });
    await expect(plannerTab).toBeVisible({ timeout: 10000 });
    await plannerTab.click();

    // Should show no-employees empty state
    await expect(page.getByText('No employees found')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/add employees to start building/i)).toBeVisible();
  });
});
