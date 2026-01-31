import { test, expect, Page } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser, exposeSupabaseHelpers } from '../helpers/e2e-supabase';

async function createEmployeesViaAPI(page: Page, names: string[]) {
  await page.evaluate(async ({ employees }) => {
    const { supabase } = await import('/src/integrations/supabase/client');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('No user session');

    const { data: ur } = await supabase
      .from('user_restaurants')
      .select('restaurant_id')
      .eq('user_id', user.id)
      .limit(1)
      .single();

    if (!ur?.restaurant_id) throw new Error('No restaurant');

    const rows = employees.map((name: string, idx: number) => ({
      restaurant_id: ur.restaurant_id,
      name,
      position: 'Server',
      status: 'active',
      compensation_type: 'hourly',
      hourly_rate: 1200 + idx * 100,
      is_active: true,
      tip_eligible: true,
    }));

    const { error } = await supabase.from('employees').insert(rows);
    if (error) throw error;
  }, { employees: names });
}

test.describe('Tip pooling flow', () => {
  test('manual tips split by hours with live preview', async ({ page }) => {
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    const employeeNames = ['Alice Tips', 'Bob Tips'];
    await createEmployeesViaAPI(page, employeeNames);

    await page.goto('/tips');
    const tipsHeading = page.getByRole('heading', { name: /^tips$/i }).first();
    await expect(tipsHeading).toBeVisible({ timeout: 10000 });

    // Switch to Daily Entry mode (page defaults to Overview mode)
    const dailyEntryButton = page.getByRole('button', { name: /daily entry/i });
    await expect(dailyEntryButton).toBeVisible({ timeout: 5000 });
    await dailyEntryButton.click();

    // Click to open tip entry dialog
    const enterTipsButton = page.getByRole('button', { name: /enter.*tips/i }).first();
    await expect(enterTipsButton).toBeVisible({ timeout: 5000 });
    await enterTipsButton.click();
    await expect(page.locator('#tip-amount')).toBeVisible({ timeout: 10000 });

    await page.locator('#tip-amount').fill('100');
    await page.getByRole('button', { name: /continue/i }).click();
    await page.getByRole('spinbutton', { name: /alice tips/i }).fill('5');
    await page.getByRole('spinbutton', { name: /bob tips/i }).fill('3');

    await expect(page.getByText('$62.50')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('$37.50')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/total remaining/i)).toBeVisible();

    await page.getByRole('button', { name: /approve tips/i }).click();

    // Verify persistence using Playwright's built-in retry
    await expect(async () => {
      const amounts = await page.evaluate(async () => {
        return await (window as any).__getApprovedTipAmounts();
      });

      expect(Array.isArray(amounts)).toBe(true);
      expect(amounts.length).toBeGreaterThanOrEqual(2);
      const sum = amounts.slice(0, 2).reduce((s: number, amt: number) => s + amt, 0);
      expect(sum).toBe(10000);
    }).toPass({ timeout: 10000 });

    // Verify the Recent Tip Splits section appears (shows approved splits)
    await expect(page.getByText(/recent tip splits/i)).toBeVisible({ timeout: 5000 });
  });
});
