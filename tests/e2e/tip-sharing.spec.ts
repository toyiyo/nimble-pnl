import { test, expect, Page } from '@playwright/test';
import {
  signUpAndCreateRestaurant,
  generateTestUser,
  exposeSupabaseHelpers,
} from '../helpers/e2e-supabase';

interface WindowHelpers {
  __getAuthUser: () => Promise<{ id: string } | null>;
  __getRestaurantId: (userId?: string) => Promise<string | null>;
  __insertEmployees: (rows: unknown[], restaurantId: string) => Promise<Array<{ id: string }>>;
  __getApprovedTipAmounts: (restaurantId?: string) => Promise<number[]>;
  __checkApprovedSplits: (restaurantId: string) => Promise<boolean>;
}

async function createEmployees(
  page: Page,
  employees: Array<{ name: string; email: string; position: string }>,
) {
  await exposeSupabaseHelpers(page);
  await page.evaluate(
    async ({ empData }) => {
      const win = window as unknown as WindowHelpers;
      const user = await win.__getAuthUser();
      if (!user?.id) throw new Error('No user session');
      const restaurantId = await win.__getRestaurantId(user.id);
      if (!restaurantId) throw new Error('No restaurant');

      const rows = empData.map((emp: { name: string; email: string; position: string }) => ({
        name: emp.name,
        email: emp.email,
        position: emp.position,
        status: 'active',
        compensation_type: 'hourly',
        hourly_rate: 1500,
        is_active: true,
        tip_eligible: true,
      }));

      await win.__insertEmployees(rows, restaurantId);
    },
    { empData: employees },
  );
}

async function navigateToTipsDailyEntry(page: Page) {
  await page.goto('/tips');
  await page.getByRole('heading', { name: /^tips$/i }).first().waitFor({ state: 'visible', timeout: 25000 });

  const dailyEntryButton = page.getByRole('button', { name: /daily entry/i });
  await expect(dailyEntryButton).toBeVisible({ timeout: 5000 });
  await dailyEntryButton.click();

  await expect(page.getByRole('button', { name: /enter.*tips/i }).first()).toBeVisible({ timeout: 5000 });
}

async function enterTipAmount(page: Page, amount: string) {
  await page.getByRole('button', { name: /enter.*tips/i }).first().click();
  await expect(page.locator('#tip-amount')).toBeVisible({ timeout: 8000 });
  await page.locator('#tip-amount').fill(amount);
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.locator('#tip-amount')).not.toBeVisible({ timeout: 5000 });
}

test.describe('Tip sharing', () => {
  test.describe.configure({ mode: 'serial' });

  test('splits tips proportionally by hours and persists approved amounts', async ({ page }) => {
    // Setup: sign up, create restaurant, add employees
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);

    await createEmployees(page, [
      { name: 'Ana Server', email: 'ana@test.com', position: 'Server' },
      { name: 'Ben Bartender', email: 'ben@test.com', position: 'Bartender' },
      { name: 'Cal Runner', email: 'cal@test.com', position: 'Runner' },
    ]);

    // Navigate to tips daily entry
    await navigateToTipsDailyEntry(page);

    // Enter $300 in tips
    await enterTipAmount(page, '300');

    // Enter hours: Ana=6, Ben=4, Cal=2 (total 12 hours)
    // Expected split: Ana=$150, Ben=$100, Cal=$50
    await page.getByRole('spinbutton', { name: /ana server/i }).fill('6');
    await page.getByRole('spinbutton', { name: /ben bartender/i }).fill('4');
    await page.getByRole('spinbutton', { name: /cal runner/i }).fill('2');

    // Verify live preview shows correct proportional amounts
    await expect(page.getByText('$150.00').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('$100.00').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('$50.00').first()).toBeVisible({ timeout: 5000 });

    // Approve
    await page.getByRole('button', { name: /approve tips/i }).click();

    // Verify approval succeeded (toast or backend)
    const toast = page.getByText(/tips approved/i).first();
    try {
      await toast.waitFor({ state: 'visible', timeout: 7000 });
    } catch {
      // Fall back to backend verification
      await exposeSupabaseHelpers(page);
      const approved = await page.evaluate(async () => {
        const win = window as unknown as WindowHelpers;
        const authUser = await win.__getAuthUser();
        if (!authUser?.id) return false;
        const restaurantId = await win.__getRestaurantId(authUser.id);
        if (!restaurantId) return false;
        return await win.__checkApprovedSplits(restaurantId);
      });
      expect(approved).toBe(true);
    }

    // Verify amounts persisted in database (sum should equal 30000 cents = $300)
    await expect(async () => {
      const amounts = await page.evaluate(async () => {
        return await (window as unknown as WindowHelpers).__getApprovedTipAmounts();
      });
      expect(Array.isArray(amounts)).toBe(true);
      expect(amounts.length).toBeGreaterThanOrEqual(3);
      const sum = amounts.slice(0, 3).reduce((s, amt) => s + amt, 0);
      expect(sum).toBe(30000);
    }).toPass({ timeout: 10000 });

    // Verify Recent Tip Splits section shows the approved split
    await expect(page.getByText(/recent tip splits/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/\$300\.00/).first()).toBeVisible({ timeout: 5000 });
  });
});
