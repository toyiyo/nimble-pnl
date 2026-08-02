import { test, expect, Page } from '@playwright/test';
import {
  signUpAndCreateRestaurant,
  generateTestUser,
  exposeSupabaseHelpers,
  fillHours,
  type RolePercentagesMap,
} from '../helpers/e2e-supabase';

interface WindowHelpers {
  __getAuthUser: () => Promise<{ id: string } | null>;
  __getRestaurantId: (userId?: string) => Promise<string | null>;
  __insertEmployees: (rows: unknown[], restaurantId: string) => Promise<Array<{ id: string }>>;
  __getApprovedTipAmounts: (restaurantId?: string) => Promise<number[]>;
  __checkApprovedSplits: (restaurantId: string) => Promise<boolean>;
  __getTipPoolSettings: (restaurantId: string) => Promise<RolePercentagesMap | null>;
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
    await fillHours(page, 'ana server', '6');
    await fillHours(page, 'ben bartender', '4');
    await fillHours(page, 'cal runner', '2');

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
    // The heading is always rendered, but we need to wait for the page to transition
    // back from the review view after approval completes
    await expect(page.getByText(/recent tip splits/i)).toBeVisible({ timeout: 15000 });
    // Wait for the split data to load and display the approved amount
    await expect(page.getByText(/\$300\.00/).first()).toBeVisible({ timeout: 15000 });
  });

  test('a guaranteed role receives at least its configured percentage', async ({ page }) => {
    // Setup: sign up, create restaurant, add employees
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);

    await createEmployees(page, [
      { name: 'Manager Mo', email: 'mo@test.com', position: 'Manager' },
      { name: 'Server Sam', email: 'sam@test.com', position: 'Server' },
    ]);

    await page.goto('/tips');
    await page.getByRole('heading', { name: /^tips$/i }).first().waitFor({ state: 'visible', timeout: 25000 });

    // Configure Manager at "at least 30%".
    await page.getByRole('button', { name: 'Setup' }).click();
    const managerMode = page.getByLabel('Manager allocation mode');
    await managerMode.getByRole('radio', { name: 'Manager: at least a set percentage' }).click();
    await page.getByLabel('Manager percentage').fill('30');
    await page.getByRole('button', { name: /close|done/i }).first().click();

    // Confirm the autosave actually landed in the database before trusting the UI's
    // in-memory state for the rest of the test — a debounce that silently failed to
    // persist would still show the right value on screen right now.
    await exposeSupabaseHelpers(page);
    await expect(async () => {
      const settings = await page.evaluate(async () => {
        const win = window as unknown as WindowHelpers;
        const authUser = await win.__getAuthUser();
        if (!authUser?.id) return null;
        const restaurantId = await win.__getRestaurantId(authUser.id);
        if (!restaurantId) return null;
        return await win.__getTipPoolSettings(restaurantId);
      });
      expect(settings?.Manager).toEqual({ mode: 'at_least', percentage: 30 });
    }).toPass({ timeout: 10000 });

    // Switch to Daily Entry without reloading the page — a fresh navigation here would
    // unmount the app mid-debounce and lose the role percentage we just set (it autosaves
    // 1s after the last edit; a `goto` cancels that pending save on unmount). The check
    // above already proved the save completed, so this is purely about not re-triggering
    // another debounce cycle.
    const dailyEntryButton = page.getByRole('button', { name: /daily entry/i });
    await expect(dailyEntryButton).toBeVisible({ timeout: 5000 });
    await dailyEntryButton.click();
    await expect(page.getByRole('button', { name: /enter.*tips/i }).first()).toBeVisible({ timeout: 5000 });

    // Enter a tip amount and hours that would otherwise put the manager well below 30%.
    await enterTipAmount(page, '100');
    await fillHours(page, 'manager mo', '1');
    await fillHours(page, 'server sam', '9');

    // The entry screen shows the guarantee and the resulting percentage. (The same
    // "Guaranteed 30%" badge also appears in the review table below, so scope to .first().)
    await expect(page.getByText('Guaranteed 30%').first()).toBeVisible();
    await expect(page.getByText('30.0% · $30.00')).toBeVisible();

    // Review carries the same figure through.
    await expect(page.getByRole('cell', { name: '30.0%' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Edit tip amount for .*Manager/ })).toContainText('$30.00');
  });
});
