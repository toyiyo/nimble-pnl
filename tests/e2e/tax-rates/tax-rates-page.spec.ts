import { test, expect } from '@playwright/test';
import { createTestUser, createTestRestaurant, cleanupTestUser } from '../../helpers/auth';

test.describe('Tax Rates Page', () => {
  let testUserId: string;
  let testRestaurantId: string;
  const testEmail = `test-tax-rates-${Date.now()}@example.com`;
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

  test('should display tax rates page with correct title and stats', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]:has-text("Sign In")');
    
    // Wait for navigation to dashboard
    await page.waitForURL('/', { timeout: 10000 });
    
    // Navigate to tax rates page
    await page.goto('/tax-rates');
    await page.waitForLoadState('networkidle');
    
    // Verify page title
    await expect(page.locator('h1:has-text("Tax Rates & Categories")')).toBeVisible();
    
    // Verify stats cards are visible
    await expect(page.locator('text=Active Tax Rates')).toBeVisible();
    await expect(page.locator('text=Total Tax Rates')).toBeVisible();
    await expect(page.locator('text=Revenue Categories')).toBeVisible();
    
    // Verify "Add Tax Rate" button is present
    await expect(page.locator('button:has-text("Add Tax Rate")')).toBeVisible();
    
    // Verify "Generate Tax Report" button is present
    await expect(page.locator('button:has-text("Generate Tax Report")')).toBeVisible();
  });

  test('should open tax rate dialog when Add Tax Rate is clicked', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]:has-text("Sign In")');
    
    // Wait for navigation to dashboard
    await page.waitForURL('/', { timeout: 10000 });
    
    // Navigate to tax rates page
    await page.goto('/tax-rates');
    await page.waitForLoadState('networkidle');
    
    // Click Add Tax Rate button
    await page.click('button:has-text("Add Tax Rate")');
    
    // Verify dialog appears
    await expect(page.locator('text=Create Tax Rate')).toBeVisible();
    await expect(page.locator('label:has-text("Tax Rate Name")')).toBeVisible();
    await expect(page.locator('label:has-text("Rate (%)")')).toBeVisible();
    await expect(page.locator('label:has-text("Description")')).toBeVisible();
    await expect(page.locator('label:has-text("Active")')).toBeVisible();
    await expect(page.locator('label:has-text("Revenue Categories")')).toBeVisible();
  });

  test('should open tax report dialog when Generate Tax Report is clicked', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]:has-text("Sign In")');
    
    // Wait for navigation to dashboard
    await page.waitForURL('/', { timeout: 10000 });
    
    // Navigate to tax rates page
    await page.goto('/tax-rates');
    await page.waitForLoadState('networkidle');
    
    // Click Generate Tax Report button
    await page.click('button:has-text("Generate Tax Report")');
    
    // Verify dialog appears
    await expect(page.locator('text=Tax Report')).toBeVisible();
    await expect(page.locator('label:has-text("Start Date")')).toBeVisible();
    await expect(page.locator('label:has-text("End Date")')).toBeVisible();
    await expect(page.locator('button:has-text("Calculate Taxes")')).toBeVisible();
  });
});
