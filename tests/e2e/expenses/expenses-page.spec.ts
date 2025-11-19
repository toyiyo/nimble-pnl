import { test, expect } from '@playwright/test';
import { createTestUser, createTestRestaurant, cleanupTestUser } from '../../helpers/auth';

test.describe('Expenses Page', () => {
  let testUserId: string;
  let testRestaurantId: string;
  const testEmail = `test-expenses-${Date.now()}@example.com`;
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

  test('should display expenses page with correct title and stats', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]:has-text("Sign In")');
    
    // Wait for navigation to dashboard
    await page.waitForURL('/', { timeout: 10000 });
    
    // Navigate to expenses page
    await page.goto('/expenses');
    await page.waitForLoadState('networkidle');
    
    // Verify page title
    await expect(page.locator('h1:has-text("Expenses")')).toBeVisible();
    
    // Verify stats cards are visible
    await expect(page.locator('text=Bank Balance')).toBeVisible();
    await expect(page.locator('text=Uncommitted Expenses')).toBeVisible();
    await expect(page.locator('text=Book Balance')).toBeVisible();
    
    // Verify expenses list is visible
    await expect(page.locator('text=Uncommitted Expenses')).toBeVisible();
    
    // Verify "Add Expense" button is present
    await expect(page.locator('button:has-text("Add Expense")')).toBeVisible();
  });

  test('should open add expense dialog when clicking Add Expense button', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]:has-text("Sign In")');
    
    // Wait for navigation to dashboard
    await page.waitForURL('/', { timeout: 10000 });
    
    // Navigate to expenses page
    await page.goto('/expenses');
    await page.waitForLoadState('networkidle');
    
    // Click add expense button
    await page.click('button:has-text("Add Expense")');
    
    // Wait for dialog to appear
    await page.waitForSelector('[role="dialog"]');
    
    // Verify dialog title
    await expect(page.locator('[role="dialog"] >> text=Add Uncommitted Expense')).toBeVisible();
    
    // Verify form fields are present
    await expect(page.locator('label:has-text("Payee / Vendor")')).toBeVisible();
    await expect(page.locator('label:has-text("Payment Method")')).toBeVisible();
    await expect(page.locator('label:has-text("Amount")')).toBeVisible();
  });

  test('should be accessible from Accounting section in sidebar', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]:has-text("Sign In")');
    
    // Wait for navigation to dashboard
    await page.waitForURL('/', { timeout: 10000 });
    
    // Look for Accounting section in sidebar
    const accountingSection = page.locator('text=Accounting');
    await expect(accountingSection).toBeVisible();
    
    // Click to expand Accounting section if collapsed
    await accountingSection.click();
    
    // Verify Expenses link is present
    const expensesLink = page.locator('a:has-text("Expenses")');
    await expect(expensesLink).toBeVisible();
    
    // Click Expenses link
    await expensesLink.click();
    
    // Verify we're on the expenses page
    await page.waitForURL('/expenses');
    await expect(page.locator('h1:has-text("Expenses")')).toBeVisible();
  });
});
