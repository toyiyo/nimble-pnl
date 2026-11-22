import { test, expect } from '@playwright/test';
import {
  signUpAndCreateRestaurant,
  generateTestUser,
  exposeSupabaseHelpers,
  type E2EHelperWindow,
} from '../helpers/e2e-supabase';

/**
 * E2E Test: POS Sales period comparison
 *
 * The range is a fixed Monday-to-Sunday week (2026-11-09 to 2026-11-15).
 * The prior period is the week before (2026-11-02 to 2026-11-08).
 * Net sales: $200 this week, $100 last week. The delta is +100.0%.
 */
const WEEK_START = '2026-11-09';
const WEEK_END = '2026-11-15';
const PRIOR_START = '2026-11-02';

test.describe('POS Sales period comparison', () => {
  test('Net sales tile shows the prior period delta and the switch hides it', async ({ page }) => {
    const user = generateTestUser('cmp');
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    await page.evaluate(async () => {
      const w = window as unknown as E2EHelperWindow;
      const supabase = w.__supabase;
      const authUser = await w.__getAuthUser();
      if (!authUser?.id) throw new Error('No user session');
      const restaurantId = await w.__getRestaurantId(authUser.id);
      if (!restaurantId) throw new Error('No restaurant');

      const stamp = Date.now();
      const sale = (orderId: string, saleDate: string, amount: number) => ({
        restaurant_id: restaurantId,
        pos_system: 'manual',
        external_order_id: `e2e-cmp-${stamp}-${orderId}`,
        item_name: 'Test Burger',
        item_type: 'sale',
        quantity: 1,
        unit_price: amount,
        total_price: amount,
        sale_date: saleDate,
      });

      const { error } = await supabase.from('unified_sales').insert([
        sale('cur-1', '2026-11-10', 100),
        sale('cur-2', '2026-11-12', 100),
        sale('prior-1', '2026-11-03', 100),
      ]);
      if (error) throw new Error(`Seed failed: ${error.message}`);
    });

    // Wait for the prior-period RPC. Its body names the prior week start.
    const priorResponse = page.waitForResponse(
      (res) =>
        res.url().includes('/rpc/get_sales_daily_series') &&
        (res.request().postData() ?? '').includes(PRIOR_START),
      { timeout: 30000 },
    );
    await page.goto(`/pos-sales?startDate=${WEEK_START}&endDate=${WEEK_END}`);

    const compareSwitch = page.getByRole('switch', { name: /compare to previous period/i });
    await expect(compareSwitch).toBeVisible({ timeout: 15000 });
    await expect(compareSwitch).toBeChecked();
    expect((await priorResponse).ok()).toBe(true);

    // The caption names the prior range and the rule.
    const caption = page.getByText(/^vs .+ · same days, last week$/);
    await expect(caption).toBeVisible();

    // Net sales $200 against $100 in the prior week is +100.0%, or +$100.00.
    const summaryList = page.getByLabel('Sales trend summary');
    const netSalesDelta = summaryList.getByText('+100.0% · +$100.00');
    await expect(netSalesDelta).toBeVisible({ timeout: 15000 });

    await compareSwitch.click();
    await expect(compareSwitch).not.toBeChecked();
    await expect(caption).toBeHidden();
    await expect(netSalesDelta).toBeHidden();
  });
});
