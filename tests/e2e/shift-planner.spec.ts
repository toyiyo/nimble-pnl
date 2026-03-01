import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

test.describe('Shift Planner', () => {
  test('planner tab renders weekly grid, creates shift via quick-create dialog', async ({ page }) => {
    const testUser = generateTestUser('planner');

    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    // Get restaurant ID and seed employees
    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

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

    // Navigate to scheduling page and wait for it to load
    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    // Click the Planner tab
    const plannerTab = page.getByRole('tab', { name: /planner/i });
    await expect(plannerTab).toBeVisible({ timeout: 10000 });
    await plannerTab.click();

    // Wait for the grid to render with employee rows (data may already be cached)
    await expect(page.getByText('Alice Johnson')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Bob Smith')).toBeVisible({ timeout: 5000 });

    // Verify "Open Shifts" row exists
    await expect(page.getByText('Open Shifts')).toBeVisible();

    // Verify the PlannerHeader shows week navigation
    await expect(page.getByRole('button', { name: 'Previous week' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next week' })).toBeVisible();
    await expect(page.getByText(/today/i)).toBeVisible();

    // Verify total hours display in planner header ("0h scheduled")
    await expect(page.getByText(/0h\s*scheduled/)).toBeVisible();

    // Click an empty cell to open quick create dialog
    const aliceCell = page.getByRole('button', { name: /add shift for alice johnson/i }).first();
    await expect(aliceCell).toBeVisible({ timeout: 5000 });
    await aliceCell.click();

    // Verify the quick create dialog opens
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 3000 });
    await expect(dialog.getByText(/quick add shift/i)).toBeVisible();
    await expect(dialog.getByText(/alice johnson/i)).toBeVisible();

    // Fill in shift times (browser renders as AM/PM time input)
    const startInput = dialog.locator('input[type="time"]').first();
    const endInput = dialog.locator('input[type="time"]').nth(1);
    await startInput.fill('10:00');
    await endInput.fill('16:00');

    // Set up response listener BEFORE clicking create
    const shiftCreatePromise = page.waitForResponse(
      resp => resp.url().includes('rest/v1/shifts') && resp.status() === 201,
      { timeout: 15000 },
    );

    // Submit the form
    const createButton = dialog.getByRole('button', { name: /add shift/i });
    await expect(createButton).toBeVisible();
    await createButton.click();

    // Wait for the mutation
    await shiftCreatePromise;

    // Dialog should close after successful creation
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Verify the shift block appears in the grid (compact time format)
    await expect(page.getByText('10a-4p')).toBeVisible({ timeout: 5000 });

    // Verify total hours updated (6h for a 10:00-16:00 shift)
    await expect(page.getByText(/6h\s*scheduled/)).toBeVisible({ timeout: 5000 });
  });

  test('week navigation changes displayed dates', async ({ page }) => {
    const testUser = generateTestUser('planner-nav');

    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

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

    // Switch to Planner tab
    const plannerTab = page.getByRole('tab', { name: /planner/i });
    await expect(plannerTab).toBeVisible({ timeout: 10000 });
    await plannerTab.click();

    // Wait for grid to render
    await expect(page.getByText('Charlie Brown')).toBeVisible({ timeout: 10000 });

    // Capture current date range text
    const dateRange = page.locator('.text-\\[15px\\].font-semibold');
    await expect(dateRange).toBeVisible();
    const initialText = await dateRange.textContent();
    expect(initialText).toBeTruthy();

    // Click "Next week"
    await page.getByRole('button', { name: 'Next week' }).click();

    // Date range text should change
    await expect(dateRange).not.toHaveText(initialText!, { timeout: 5000 });
    const nextWeekText = await dateRange.textContent();

    // Click "Previous week" to go back
    await page.getByRole('button', { name: 'Previous week' }).click();

    // Should be back to original range
    await expect(dateRange).toHaveText(initialText!, { timeout: 5000 });

    // Verify next week was indeed different
    expect(nextWeekText).not.toBe(initialText);
  });

  test('empty state shows when no employees exist', async ({ page }) => {
    const testUser = generateTestUser('planner-empty');

    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    // Navigate to scheduling WITHOUT seeding employees
    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    // Switch to Planner tab
    const plannerTab = page.getByRole('tab', { name: /planner/i });
    await expect(plannerTab).toBeVisible({ timeout: 10000 });
    await plannerTab.click();

    // Should show the empty state (wait for data to load and render)
    await expect(page.getByText('No employees found')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/add employees to start building/i)).toBeVisible();
  });
});
