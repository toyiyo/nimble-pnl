import { test, expect } from '@playwright/test';
import { createTestUser, createTestRestaurant, cleanupTestUser } from '../../helpers/auth';
import { getTestSupabaseClient } from '../../helpers/supabase';

test.describe('Add Product with Full Details', () => {
  let testUserId: string;
  let testRestaurantId: string;
  const testEmail = `test-full-${Date.now()}@example.com`;
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

  test('should save all product fields including SKU, size, packaging, and supplier', async ({ page }) => {
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
    
    // Fill basic product information
    await page.fill('input[placeholder="e.g., BEEF-001"]', 'WINE-750ML-001');
    await page.fill('input[placeholder*="Ground Beef"]', 'Premium Red Wine');
    await page.fill('textarea[placeholder*="Additional product details"]', 'Fine Italian red wine');
    await page.fill('input[placeholder*="Local Farm"]', 'Vineyard Brand');
    
    // Select category
    await page.click('button[role="combobox"]:near(:text("Category"))');
    await page.waitForSelector('[role="option"]:has-text("Beverages")');
    await page.click('[role="option"]:has-text("Beverages")');
    
    // Fill size and packaging details
    await page.fill('input[placeholder="750"]', '750');
    
    // Select size unit (ml)
    const unitSelector = page.locator('button[role="combobox"]').filter({ hasText: 'Select unit' }).first();
    await unitSelector.click();
    await page.waitForSelector('[role="option"]:has-text("ml")');
    await page.click('[role="option"]:has-text("ml")');
    
    // Select package type (bottle)
    await page.click('button[role="combobox"]:near(:text("Package Type"))');
    await page.waitForSelector('[role="option"]:has-text("Bottle")');
    await page.click('[role="option"]:has-text("Bottle")');
    
    // Fill cost and supplier information
    await page.fill('input[placeholder="0.00"]', '15.99');
    
    // Enter supplier name
    const supplierInput = page.locator('input[placeholder*="Search or create supplier"]');
    await supplierInput.fill('Test Wine Supplier');
    await page.keyboard.press('Enter');
    
    // Fill supplier SKU
    await page.fill('input[placeholder*="Supplier\'s product code"]', 'SUP-WINE-750');
    
    // Fill inventory levels
    await page.fill('input[placeholder="0"]:near(:text("Current Stock"))', '24');
    await page.fill('input[placeholder="0"]:near(:text("Reorder Point"))', '6');
    await page.fill('input[placeholder="0"]:near(:text("Minimum Par Level"))', '12');
    await page.fill('input[placeholder="0"]:near(:text("Maximum Par Level"))', '48');
    
    // Submit form
    await page.click('button[type="submit"]:has-text("Add Product")');
    
    // Wait for success toast
    await page.waitForTimeout(2000); // Give time for the product to be created
    
    // Verify in database that ALL fields were saved
    const supabase = getTestSupabaseClient();
    const { data: product, error } = await supabase
      .from('products')
      .select('*')
      .eq('sku', 'WINE-750ML-001')
      .eq('restaurant_id', testRestaurantId)
      .single();
    
    expect(error).toBeNull();
    expect(product).toBeTruthy();
    
    // Verify basic fields
    expect(product.sku).toBe('WINE-750ML-001');
    expect(product.name).toBe('Premium Red Wine');
    expect(product.description).toBe('Fine Italian red wine');
    expect(product.brand).toBe('Vineyard Brand');
    expect(product.category).toBe('Beverages');
    
    // Verify size and packaging fields (THE MAIN ISSUE)
    expect(product.size_value).toBe(750);
    expect(product.size_unit).toBe('ml');
    expect(product.uom_purchase).toBe('bottle');
    
    // Verify supplier information (THE MAIN ISSUE)
    expect(product.supplier_name).toBe('Test Wine Supplier');
    expect(product.supplier_sku).toBe('SUP-WINE-750');
    
    // Verify cost and inventory levels
    expect(Number(product.cost_per_unit)).toBeCloseTo(15.99, 2);
    expect(Number(product.current_stock)).toBe(24);
    expect(Number(product.reorder_point)).toBe(6);
    expect(Number(product.par_level_min)).toBe(12);
    expect(Number(product.par_level_max)).toBe(48);
  });
  
  test('should handle optional fields correctly (null vs empty string)', async ({ page }) => {
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
    
    // Fill only required fields (SKU and Name)
    await page.fill('input[placeholder="e.g., BEEF-001"]', 'MIN-PRODUCT-001');
    await page.fill('input[placeholder*="Ground Beef"]', 'Minimal Product');
    
    // Submit form without filling optional fields
    await page.click('button[type="submit"]:has-text("Add Product")');
    
    // Wait for success
    await page.waitForTimeout(2000);
    
    // Verify in database that optional fields are properly null/undefined
    const supabase = getTestSupabaseClient();
    const { data: product, error } = await supabase
      .from('products')
      .select('*')
      .eq('sku', 'MIN-PRODUCT-001')
      .eq('restaurant_id', testRestaurantId)
      .single();
    
    expect(error).toBeNull();
    expect(product).toBeTruthy();
    
    // Required fields should have values
    expect(product.sku).toBe('MIN-PRODUCT-001');
    expect(product.name).toBe('Minimal Product');
    
    // Optional string fields should be null or undefined, NOT empty strings
    // This ensures the database schema is properly respected
    expect(product.description).toBeNull();
    expect(product.brand).toBeNull();
    expect(product.category).toBeNull();
    expect(product.size_unit).toBeNull();
    expect(product.uom_purchase).toBeNull();
    expect(product.uom_recipe).toBeNull();
    expect(product.supplier_name).toBeNull();
    expect(product.supplier_sku).toBeNull();
  });
});
