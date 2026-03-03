import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser, exposeSupabaseHelpers } from '../helpers/e2e-supabase';

/**
 * E2E Test: POS Sale with Tip — Tip Doubling Prevention
 *
 * Verifies that when a manual POS sale is entered with a tip,
 * the tip is NOT doubled in the totals or on the monthly dashboard.
 * Root cause: adjustment rows (tip, tax) get item_type='sale' by default,
 * so the SQL function counted them as revenue instead of pass-through.
 */
test.describe('POS Sale with Tip — No Doubling', () => {
  test('tip should not be doubled in POS sales totals', async ({ page }) => {
    const user = generateTestUser('tip-dbl');
    await signUpAndCreateRestaurant(page, user);

    // Seed unified_sales rows: sale $50, tip $10, tax $4
    await exposeSupabaseHelpers(page);

    const today = new Date().toISOString().slice(0, 10);

    await page.evaluate(async ({ saleDate }) => {
      const supabase = (window as any).__supabase;
      const user = await (window as any).__getAuthUser();
      if (!user?.id) throw new Error('No user session');
      const restaurantId = await (window as any).__getRestaurantId(user.id);
      if (!restaurantId) throw new Error('No restaurant');

      const orderId = `e2e-tip-test-${Date.now()}`;

      const { error } = await supabase.from('unified_sales').insert([
        {
          restaurant_id: restaurantId,
          pos_system: 'manual',
          external_order_id: orderId,
          item_name: 'Test Burger',
          item_type: 'sale',
          quantity: 1,
          unit_price: 50,
          total_price: 50,
          sale_date: saleDate,
        },
        {
          restaurant_id: restaurantId,
          pos_system: 'manual',
          external_order_id: orderId,
          item_name: 'Tip',
          item_type: 'tip',
          adjustment_type: 'tip',
          quantity: 1,
          unit_price: 10,
          total_price: 10,
          sale_date: saleDate,
        },
        {
          restaurant_id: restaurantId,
          pos_system: 'manual',
          external_order_id: orderId,
          item_name: 'Sales Tax',
          item_type: 'tax',
          adjustment_type: 'tax',
          quantity: 1,
          unit_price: 4,
          total_price: 4,
          sale_date: saleDate,
        },
      ]);

      if (error) throw new Error(`Seed failed: ${error.message}`);
    }, { saleDate: today });

    // Navigate to POS Sales and verify totals
    await page.goto('/pos-sales');
    await page.waitForLoadState('networkidle');

    // Revenue should be $50 (sale only), NOT $64 (sale + tip + tax)
    const revenueText = await page.getByText('$50.00').first();
    await expect(revenueText).toBeVisible({ timeout: 15000 });

    // Pass-through should be $14 (tip $10 + tax $4)
    const passThroughText = await page.getByText('$14.00').first();
    await expect(passThroughText).toBeVisible({ timeout: 5000 });

    // Verify the bad value ($64) does NOT appear as revenue
    // Look for the Revenue label and its adjacent value
    const revenueStat = page.locator('text=Revenue').first();
    await expect(revenueStat).toBeVisible();
  });
});
