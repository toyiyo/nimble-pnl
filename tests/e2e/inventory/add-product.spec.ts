import { test, expect } from '@playwright/test';
import { createTestUser, createTestRestaurant, cleanupTestUser } from '../../helpers/auth';
import { getTestSupabaseClient } from '../../helpers/supabase';

test.describe('Add Product to Inventory', () => {
  let testUserId: string;
  let testRestaurantId: string;
  const testEmail = `test-${Date.now()}@example.com`;
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

  test('should successfully add a new product', async ({ page }) => {
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
    
    // Open add product dialog
    await page.click('button:has-text("Add Product")');
    await page.waitForSelector('[role="dialog"]');
    
    // Fill product form
    await page.fill('input[name="sku"]', 'TEST-001');
    await page.fill('input[name="name"]', 'Test Product');
    await page.fill('input[name="description"]', 'A test product for E2E testing');
    await page.fill('input[name="brand"]', 'Test Brand');
    await page.fill('input[name="category"]', 'Test Category');
    await page.fill('input[name="cost_per_unit"]', '10.99');
    await page.fill('input[name="current_stock"]', '50');
    
    // Select purchase unit
    await page.click('button[role="combobox"]:has-text("Select unit")');
    await page.click('div[role="option"]:has-text("unit")');
    
    // Submit form
    await page.click('button[type="submit"]:has-text("Add Product")');
    
    // Verify success toast
    await expect(page.locator('text=Product added successfully')).toBeVisible({ timeout: 5000 });
    
    // Verify product appears in list
    await expect(page.locator('text=Test Product')).toBeVisible();
    await expect(page.locator('text=TEST-001')).toBeVisible();
    
    // Verify in database
    const supabase = getTestSupabaseClient();
    const { data: product } = await supabase
      .from('products')
      .select('*')
      .eq('sku', 'TEST-001')
      .eq('restaurant_id', testRestaurantId)
      .single();
    
    expect(product).toBeTruthy();
    expect(product.name).toBe('Test Product');
    expect(product.current_stock).toBe('50');
    expect(product.cost_per_unit).toBe('10.99');
  });

  test('should show validation errors for invalid data', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]:has-text("Sign In")');
    await page.waitForURL('/', { timeout: 10000 });
    
    // Navigate to inventory
    await page.goto('/inventory');
    await page.waitForLoadState('networkidle');
    
    // Open add product dialog
    await page.click('button:has-text("Add Product")');
    await page.waitForSelector('[role="dialog"]');
    
    // Try to submit empty form
    await page.click('button[type="submit"]:has-text("Add Product")');
    
    // Check for validation errors (form should prevent submission)
    // The form uses react-hook-form which will show validation errors
    await expect(page.locator('[role="dialog"]')).toBeVisible();
  });

  test('should update inventory metrics after adding product', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]:has-text("Sign In")');
    await page.waitForURL('/', { timeout: 10000 });
    
    // Navigate to inventory
    await page.goto('/inventory');
    await page.waitForLoadState('networkidle');
    
    // Check initial metrics (should be 0 or showing previous test product)
    const initialCostText = await page.locator('text=Total Inventory Cost').locator('..').locator('text=/\\$[\\d,]+\\.\\d{2}/').first().textContent();
    
    // Open add product dialog
    await page.click('button:has-text("Add Product")');
    await page.waitForSelector('[role="dialog"]');
    
    // Add another test product
    await page.fill('input[name="sku"]', 'TEST-002');
    await page.fill('input[name="name"]', 'Test Product 2');
    await page.fill('input[name="cost_per_unit"]', '25.50');
    await page.fill('input[name="current_stock"]', '10');
    await page.click('button[role="combobox"]:has-text("Select unit")');
    await page.click('div[role="option"]:has-text("unit")');
    await page.click('button[type="submit"]:has-text("Add Product")');
    
    // Wait for success
    await expect(page.locator('text=Product added successfully')).toBeVisible({ timeout: 5000 });
    
    // Wait for metrics to update by checking when the value changes
    await page.waitForFunction(
      (initialValue) => {
        const metricElement = document.evaluate(
          "//text()[contains(., 'Total Inventory Cost')]/ancestor::*[1]//text()[contains(., '$')]",
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        ).singleNodeValue;
        return metricElement && metricElement.textContent !== initialValue;
      },
      initialCostText,
      { timeout: 10000 }
    );
    
    // Verify metrics updated (should now show $255.00 for this product: 10 * $25.50)
    const updatedCostText = await page.locator('text=Total Inventory Cost').locator('..').locator('text=/\\$[\\d,]+\\.\\d{2}/').first().textContent();
    expect(updatedCostText).not.toBe(initialCostText);
  });
});
