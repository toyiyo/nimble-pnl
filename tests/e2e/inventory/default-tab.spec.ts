import { test, expect } from '@playwright/test';
import { createTestUser, createTestRestaurant, cleanupTestUser } from '../../helpers/auth';

test.describe('Inventory Page Default Tab', () => {
  let testUserId: string;
  let testRestaurantId: string;
  const testEmail = `test-default-tab-${Date.now()}@example.com`;
  const testPassword = 'TestPassword123!';

  test.beforeAll(async () => {
    // Setup test user and restaurant
    const user = await createTestUser(testEmail, testPassword, 'Test User');
    testUserId = user.id;
    testRestaurantId = await createTestRestaurant(testUserId, 'Test Restaurant');
  });

  test.afterAll(async () => {
    // Cleanup
    await cleanupTestUser(testUserId);
  });

  test('should show Products tab by default when opening inventory page', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]:has-text("Sign In")');
    
    // Wait for navigation to dashboard
    await page.waitForURL('/', { timeout: 10000 });
    
    // Navigate to inventory
    await page.goto('/inventory');
    await page.waitForLoadState('networkidle');
    
    // Check that Products tab is selected (has aria-selected="true")
    const productsTab = page.locator('[role="tab"]:has-text("Products")');
    await expect(productsTab).toHaveAttribute('aria-selected', 'true');
    
    // Verify Products content is visible (should show inventory metrics or product list)
    await expect(page.locator('text=Total Inventory Cost')).toBeVisible({ timeout: 5000 });
    
    // Verify Scanner tab is NOT selected
    const scannerTab = page.locator('[role="tab"]:has-text("Scanner")');
    await expect(scannerTab).toHaveAttribute('aria-selected', 'false');
  });

  test('should allow switching to Scanner tab', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]:has-text("Sign In")');
    await page.waitForURL('/', { timeout: 10000 });
    
    // Navigate to inventory (should show Products by default)
    await page.goto('/inventory');
    await page.waitForLoadState('networkidle');
    
    // Click Scanner tab
    await page.click('[role="tab"]:has-text("Scanner")');
    
    // Verify Scanner tab is now selected
    const scannerTab = page.locator('[role="tab"]:has-text("Scanner")');
    await expect(scannerTab).toHaveAttribute('aria-selected', 'true');
    
    // Verify Products tab is no longer selected
    const productsTab = page.locator('[role="tab"]:has-text("Products")');
    await expect(productsTab).toHaveAttribute('aria-selected', 'false');
    
    // Verify Scanner content is visible (should show scanner type selection)
    await expect(page.locator('text=Camera Scanner')).toBeVisible({ timeout: 5000 });
  });
});
