import { test, expect } from '@playwright/test';
import { createTestUser, createTestRestaurant, cleanupTestUser } from '../../helpers/auth';

test.describe('Scheduling - filter by position', () => {
  let testUserId: string;
  let testRestaurantId: string;
  const testEmail = `test-${Date.now()}@example.com`;
  const testPassword = 'TestPassword123!';

  test.beforeAll(async () => {
    const user = await createTestUser(testEmail, testPassword, 'Filter Test User');
    testUserId = user.id;
    testRestaurantId = await createTestRestaurant(testUserId, 'FilterTest Restaurant');
  });

  test.afterAll(async () => {
    await cleanupTestUser(testUserId);
  });

  test('can filter employees by position on scheduling page', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]:has-text("Sign In")');
    await page.waitForURL('/', { timeout: 10000 });

    // Navigate to scheduling
    await page.goto('/scheduling');
    await page.waitForLoadState('networkidle');

    // Add Bartender
    await page.click('button:has-text("Add Employee")');
    await page.waitForSelector('[role="dialog"]');
    await page.fill('input[id="name"]', 'Bartender 1');
    await page.fill('input[id="hourlyRate"]', '14.00');
    await page.click('button[aria-label="Select employee position"]');
    await page.click('div:has-text("Bartender")');
    await page.click('button[type="submit"]:has-text("Add Employee")');

    // Add Cashier
    await page.click('button:has-text("Add Employee")');
    await page.waitForSelector('[role="dialog"]');
    await page.fill('input[id="name"]', 'Cashier 1');
    await page.fill('input[id="hourlyRate"]', '12.50');
    await page.click('button[aria-label="Select employee position"]');
    await page.click('div:has-text("Cashier")');
    await page.click('button[type="submit"]:has-text("Add Employee")');

    // Wait for both to appear
    await page.waitForSelector('text=Bartender 1');
    await page.waitForSelector('text=Cashier 1');

    // Apply the position filter to Bartender
    await page.click('button[aria-label="Filter by position"]');
    await page.click('div[role="option"]:has-text("Bartender")');

    // Ensure only bartender rows are shown
    await expect(page.locator('text=Bartender 1')).toBeVisible();
    await expect(page.locator('text=Cashier 1')).toHaveCount(0);

    // Apply filter to Cashier
    await page.click('button[aria-label="Filter by position"]');
    await page.click('div[role="option"]:has-text("Cashier")');

    // Ensure only cashier rows are shown
    await expect(page.locator('text=Cashier 1')).toBeVisible();
    await expect(page.locator('text=Bartender 1')).toHaveCount(0);

    // Clear filter
    await page.click('button[aria-label="Filter by position"]');
    await page.click('div[role="option"]:has-text("All Positions")');

    // Both employees visible again
    await expect(page.locator('text=Bartender 1')).toBeVisible();
    await expect(page.locator('text=Cashier 1')).toBeVisible();
  });
});
