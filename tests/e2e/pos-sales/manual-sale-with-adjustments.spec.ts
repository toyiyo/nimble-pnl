import { test, expect } from '@playwright/test';
import { createTestUser, createTestRestaurant, cleanupTestUser } from '../../helpers/auth';
import { getTestSupabaseClient } from '../../helpers/supabase';

test.describe('Manual POS Sale Entry with Adjustments', () => {
  let testUserId: string;
  let testRestaurantId: string;
  const testEmail = `test-pos-sale-${Date.now()}@example.com`;
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

  test('should create manual sale with adjustments in single submission', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]:has-text("Sign In")');
    
    // Wait for navigation to dashboard
    await page.waitForURL('/', { timeout: 10000 });
    
    // Navigate to POS Sales
    await page.goto('/pos-sales');
    await page.waitForLoadState('networkidle');
    
    // Open manual sale dialog
    await page.click('button:has-text("Record Manual Sale")');
    await page.waitForSelector('[role="dialog"]');
    
    // Fill main item details
    await page.fill('input[placeholder*="Select or type an item"]', 'Test Margarita');
    await page.click('text=Create new item');
    await page.fill('input[name="quantity"]', '1');
    await page.fill('input[name="totalPrice"]', '10.00');
    
    // Fill adjustment fields
    await page.fill('input[placeholder="0.00"]:below(text=Sales Tax)', '0.80');
    await page.fill('input[placeholder="0.00"]:below(text=Tip)', '2.00');
    await page.fill('input[placeholder="0.00"]:below(text=Service Charge)', '1.50');
    await page.fill('input[placeholder="0.00"]:below(text=Platform Fee)', '0.50');
    
    // Verify total calculated correctly
    await expect(page.locator('text=/Total Collected at POS.*\\$14\\.80/')).toBeVisible();
    
    // Verify breakdown is shown
    await expect(page.locator('text=/\\$10\\.00 revenue/')).toBeVisible();
    await expect(page.locator('text=/\\$0\\.80 tax/')).toBeVisible();
    await expect(page.locator('text=/\\$2\\.00 tip/')).toBeVisible();
    
    // Submit form
    await page.click('button[type="submit"]:has-text("Record Sale")');
    
    // Verify success toast
    await expect(page.locator('text=Sale recorded')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=/with 4 adjustment/')).toBeVisible();
    
    // Verify in database - should have created 5 entries
    const supabase = getTestSupabaseClient();
    const { data: sales, error } = await supabase
      .from('unified_sales')
      .select('*')
      .eq('restaurant_id', testRestaurantId)
      .like('external_order_id', 'manual_%')
      .order('created_at', { ascending: false })
      .limit(5);
    
    expect(error).toBeNull();
    expect(sales).toHaveLength(5);
    
    // Verify all entries share same order ID
    const orderIds = new Set(sales.map(s => s.external_order_id));
    expect(orderIds.size).toBe(1);
    
    // Verify revenue entry
    const revenueEntry = sales.find(s => s.adjustment_type === null);
    expect(revenueEntry).toBeTruthy();
    expect(revenueEntry.item_name).toBe('Test Margarita');
    expect(Number(revenueEntry.total_price)).toBeCloseTo(10.00, 2);
    
    // Verify tax entry
    const taxEntry = sales.find(s => s.adjustment_type === 'tax');
    expect(taxEntry).toBeTruthy();
    expect(taxEntry.item_name).toBe('Sales Tax');
    expect(Number(taxEntry.total_price)).toBeCloseTo(0.80, 2);
    
    // Verify tip entry
    const tipEntry = sales.find(s => s.adjustment_type === 'tip');
    expect(tipEntry).toBeTruthy();
    expect(tipEntry.item_name).toBe('Tip');
    expect(Number(tipEntry.total_price)).toBeCloseTo(2.00, 2);
    
    // Verify service charge entry
    const serviceChargeEntry = sales.find(s => s.adjustment_type === 'service_charge');
    expect(serviceChargeEntry).toBeTruthy();
    expect(serviceChargeEntry.item_name).toBe('Service Charge');
    expect(Number(serviceChargeEntry.total_price)).toBeCloseTo(1.50, 2);
    
    // Verify fee entry
    const feeEntry = sales.find(s => s.adjustment_type === 'fee');
    expect(feeEntry).toBeTruthy();
    expect(feeEntry.item_name).toBe('Platform Fee');
    expect(Number(feeEntry.total_price)).toBeCloseTo(0.50, 2);
    
    // Verify all entries have same date/time
    const saleDates = new Set(sales.map(s => s.sale_date));
    expect(saleDates.size).toBe(1);
  });

  test('should create sale without adjustments when none provided', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]:has-text("Sign In")');
    await page.waitForURL('/', { timeout: 10000 });
    
    // Navigate to POS Sales
    await page.goto('/pos-sales');
    await page.waitForLoadState('networkidle');
    
    // Open manual sale dialog
    await page.click('button:has-text("Record Manual Sale")');
    await page.waitForSelector('[role="dialog"]');
    
    // Fill only main item details (no adjustments)
    await page.fill('input[placeholder*="Select or type an item"]', 'Simple Drink');
    await page.click('text=Create new item');
    await page.fill('input[name="quantity"]', '1');
    await page.fill('input[name="totalPrice"]', '5.00');
    
    // Submit form
    await page.click('button[type="submit"]:has-text("Record Sale")');
    
    // Verify success
    await expect(page.locator('text=Sale recorded')).toBeVisible({ timeout: 5000 });
    
    // Verify in database - should have created only 1 entry
    const supabase = getTestSupabaseClient();
    const { data: sales } = await supabase
      .from('unified_sales')
      .select('*')
      .eq('restaurant_id', testRestaurantId)
      .eq('item_name', 'Simple Drink');
    
    expect(sales).toHaveLength(1);
    expect(sales[0].adjustment_type).toBeNull();
    expect(Number(sales[0].total_price)).toBeCloseTo(5.00, 2);
  });

  test('should validate non-negative amounts', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]:has-text("Sign In")');
    await page.waitForURL('/', { timeout: 10000 });
    
    // Navigate to POS Sales
    await page.goto('/pos-sales');
    await page.waitForLoadState('networkidle');
    
    // Open manual sale dialog
    await page.click('button:has-text("Record Manual Sale")');
    await page.waitForSelector('[role="dialog"]');
    
    // Try to enter negative tax amount
    const taxInput = page.locator('input[placeholder="0.00"]:below(text=Sales Tax)');
    await taxInput.fill('-5.00');
    
    // Input should not accept negative value or show validation error
    // HTML5 number inputs with min="0" typically prevent negative entry
    const taxValue = await taxInput.inputValue();
    expect(parseFloat(taxValue)).toBeGreaterThanOrEqual(0);
  });

  test('should calculate total collected correctly with discount', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]:has-text("Sign In")');
    await page.waitForURL('/', { timeout: 10000 });
    
    // Navigate to POS Sales
    await page.goto('/pos-sales');
    await page.waitForLoadState('networkidle');
    
    // Open manual sale dialog
    await page.click('button:has-text("Record Manual Sale")');
    await page.waitForSelector('[role="dialog"]');
    
    // Fill item with discount
    await page.fill('input[placeholder*="Select or type an item"]', 'Discounted Item');
    await page.click('text=Create new item');
    await page.fill('input[name="totalPrice"]', '20.00');
    await page.fill('input[placeholder="0.00"]:below(text=Discount)', '5.00');
    
    // Total should be $15.00 (20 - 5)
    await expect(page.locator('text=/Total Collected at POS.*\\$15\\.00/')).toBeVisible();
    await expect(page.locator('text=/-\\$5\\.00 discount/')).toBeVisible();
  });
});
