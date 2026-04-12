import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

test.describe('AI Schedule Generation', () => {
  test('shows Generate with AI button in planner header', async ({ page }) => {
    const testUser = generateTestUser('gen-ai-btn');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // Seed at least one employee so the planner renders fully
    await page.evaluate(
      ({ emps, restId }) => (window as any).__insertEmployees(emps, restId),
      {
        emps: [
          { name: 'Alice Johnson', position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
        ],
        restId: restaurantId,
      },
    );

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    // Navigate to the Planner tab
    const plannerTab = page.getByRole('tab', { name: /planner/i });
    await expect(plannerTab).toBeVisible({ timeout: 10000 });
    await plannerTab.click();

    // The "Generate with AI" button should be visible in the planner header
    // aria-label is "Generate schedule with AI"; text content is "Generate with AI"
    const generateBtn = page.getByRole('button', { name: /generate schedule with ai/i });
    await expect(generateBtn).toBeVisible({ timeout: 10000 });
  });

  test('opens dialog with employee list and generate button', async ({ page }) => {
    const testUser = generateTestUser('gen-ai-dialog');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // Seed two employees so the Employees section is populated
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

    // Navigate to Planner tab
    const plannerTab = page.getByRole('tab', { name: /planner/i });
    await expect(plannerTab).toBeVisible({ timeout: 10000 });
    await plannerTab.click();

    // Dismiss any toasts that might block button clicks
    const toasts = page.locator('[data-sonner-toast]');
    if (await toasts.count() > 0) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // Click "Generate with AI" button in the planner header
    // aria-label is "Generate schedule with AI"; text content is "Generate with AI"
    const generateBtn = page.getByRole('button', { name: /generate schedule with ai/i });
    await expect(generateBtn).toBeVisible({ timeout: 10000 });
    await generateBtn.click();

    // Dialog should open — scope with name to avoid Popover/Combobox conflicts
    const dialog = page.getByRole('dialog', { name: /generate schedule/i });
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // "Employees" section header should be visible inside the dialog
    await expect(dialog.getByText('Employees', { exact: true })).toBeVisible();

    // Generate button should be present (in dialog footer)
    // aria-label is "Generate schedule with AI"
    const generateActionBtn = dialog.getByRole('button', { name: /generate schedule with ai/i });
    await expect(generateActionBtn).toBeVisible();

    // Cancel button should be present (in dialog footer)
    const cancelBtn = dialog.getByRole('button', { name: /cancel/i });
    await expect(cancelBtn).toBeVisible();
  });

  test('cancel closes the dialog without generating', async ({ page }) => {
    const testUser = generateTestUser('gen-ai-cancel');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // Seed one employee so the planner renders properly
    await page.evaluate(
      ({ emps, restId }) => (window as any).__insertEmployees(emps, restId),
      {
        emps: [
          { name: 'Carol Davis', position: 'Bartender', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1600 },
        ],
        restId: restaurantId,
      },
    );

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    // Navigate to Planner tab
    const plannerTab = page.getByRole('tab', { name: /planner/i });
    await expect(plannerTab).toBeVisible({ timeout: 10000 });
    await plannerTab.click();

    // Dismiss any toasts that might block button clicks
    const toasts = page.locator('[data-sonner-toast]');
    if (await toasts.count() > 0) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // Click "Generate with AI" to open dialog
    // aria-label is "Generate schedule with AI"; text content is "Generate with AI"
    const generateBtn = page.getByRole('button', { name: /generate schedule with ai/i });
    await expect(generateBtn).toBeVisible({ timeout: 10000 });
    await generateBtn.click();

    // Confirm dialog is open
    const dialog = page.getByRole('dialog', { name: /generate schedule/i });
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Click Cancel
    const cancelBtn = dialog.getByRole('button', { name: /cancel/i });
    await cancelBtn.click();

    // Dialog should be closed
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
  });
});
