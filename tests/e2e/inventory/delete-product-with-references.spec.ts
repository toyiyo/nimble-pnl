import { test, expect } from '@playwright/test';
import { createTestUser, createTestRestaurant, cleanupTestUser } from '../../helpers/auth';
import { getTestSupabaseClient } from '../../helpers/supabase';

test.describe('Delete Product with References', () => {
  let testUserId: string;
  let testRestaurantId: string;
  let testProductId: string;
  const testEmail = `test-delete-${Date.now()}@example.com`;
  const testPassword = 'TestPassword123!';

  test.beforeAll(async () => {
    // Setup test user and restaurant
    const user = await createTestUser(testEmail, testPassword, 'Test User');
    testUserId = user.id;
    testRestaurantId = await createTestRestaurant(testUserId, 'Test Restaurant for Deletion');
    
    // Create a test product
    const supabase = getTestSupabaseClient();
    const { data: product } = await supabase
      .from('products')
      .insert({
        restaurant_id: testRestaurantId,
        sku: 'DELETE-TEST-001',
        name: 'Product to Delete',
        cost_per_unit: 10.00,
        current_stock: 5,
        purchase_unit: 'unit',
      })
      .select()
      .single();
    
    testProductId = product.id;

    // Create a receipt import and link it to the product
    const { data: receipt } = await supabase
      .from('receipt_imports')
      .insert({
        restaurant_id: testRestaurantId,
        vendor_name: 'Test Vendor',
        status: 'processed',
      })
      .select()
      .single();

    // Create a receipt line item that references the product
    await supabase
      .from('receipt_line_items')
      .insert({
        receipt_id: receipt.id,
        raw_text: 'Product to Delete x2',
        matched_product_id: testProductId,
        mapping_status: 'matched',
      });
  });

  test.afterAll(async () => {
    // Cleanup
    await cleanupTestUser(testUserId);
  });

  test('should successfully delete a product even when referenced by receipt line items', async ({ page }) => {
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
    
    // Wait for product to appear
    await expect(page.locator('text=Product to Delete')).toBeVisible({ timeout: 10000 });
    
    // Find and click delete button for the product
    // Look for the product card and find the delete button within it
    const productCard = page.locator('text=Product to Delete').locator('..').locator('..');
    await productCard.locator('button[aria-label*="delete" i], button:has-text("Delete")').first().click();
    
    // Wait for confirmation dialog
    await page.waitForSelector('[role="alertdialog"], [role="dialog"]', { timeout: 5000 });
    
    // Confirm deletion
    await page.click('button:has-text("Delete Product"), button:has-text("Delete")');
    
    // Verify success toast
    await expect(page.locator('text=Product deleted')).toBeVisible({ timeout: 5000 });
    
    // Verify product is removed from the list
    await expect(page.locator('text=Product to Delete')).not.toBeVisible({ timeout: 5000 });
    
    // Verify in database that product is deleted
    const supabase = getTestSupabaseClient();
    const { data: product } = await supabase
      .from('products')
      .select('*')
      .eq('id', testProductId)
      .maybeSingle();
    
    expect(product).toBeNull();

    // Verify that receipt line item still exists but with null matched_product_id
    const { data: lineItem } = await supabase
      .from('receipt_line_items')
      .select('*')
      .eq('receipt_id', (await supabase
        .from('receipt_imports')
        .select('id')
        .eq('restaurant_id', testRestaurantId)
        .single()).data.id)
      .single();
    
    expect(lineItem).toBeTruthy();
    expect(lineItem.matched_product_id).toBeNull();
    expect(lineItem.raw_text).toBe('Product to Delete x2');
  });
});
