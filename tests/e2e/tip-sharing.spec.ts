import { test, expect, Page } from '@playwright/test';
import {
  signUpAndCreateRestaurant,
  generateTestUser,
  exposeSupabaseHelpers,
  fillHours,
  type RolePercentagesMap,
  type ApprovedSplitRow,
} from '../helpers/e2e-supabase';

interface WindowHelpers {
  __getAuthUser: () => Promise<{ id: string } | null>;
  __getRestaurantId: (userId?: string) => Promise<string | null>;
  __insertEmployees: (rows: unknown[], restaurantId: string) => Promise<Array<{ id: string }>>;
  __getApprovedTipAmounts: (restaurantId?: string) => Promise<number[]>;
  __checkApprovedSplits: (restaurantId: string) => Promise<boolean>;
  __getTipPoolSettings: (restaurantId: string) => Promise<RolePercentagesMap | null>;
  __getApprovedSplitBreakdown: (restaurantId: string) => Promise<ApprovedSplitRow[]>;
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

const MODE_DESCRIPTIONS = {
  at_least: 'at least a set percentage',
  exactly: 'exactly a set percentage',
} as const;

/**
 * Open Tip Pool Settings, set one role's allocation rule, and close.
 *
 * Returns only once the rule is verified present in `tip_pool_settings` — the
 * dialog autosaves on a 1s debounce, so the on-screen value proves nothing
 * about what was persisted, and everything after this point depends on the
 * saved row. Assumes the page is already on /tips.
 */
async function configureRoleRule(
  page: Page,
  role: string,
  mode: keyof typeof MODE_DESCRIPTIONS,
  percentage: number,
) {
  await page.getByRole('button', { name: 'Setup' }).click();
  await page
    .getByLabel(`${role} allocation mode`)
    .getByRole('radio', { name: `${role}: ${MODE_DESCRIPTIONS[mode]}` })
    .click();
  await page.getByLabel(`${role} percentage`).fill(String(percentage));
  await page.getByRole('button', { name: /close|done/i }).first().click();

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
    expect(settings?.[role]).toEqual({ mode, percentage });
  }).toPass({ timeout: 10000 });
}

/** Read every approved payout for the signed-in user's restaurant, by employee name. */
async function readApprovedBreakdown(page: Page): Promise<ApprovedSplitRow[]> {
  await exposeSupabaseHelpers(page);
  return await page.evaluate(async () => {
    const win = window as unknown as WindowHelpers;
    const authUser = await win.__getAuthUser();
    if (!authUser?.id) return [];
    const restaurantId = await win.__getRestaurantId(authUser.id);
    if (!restaurantId) return [];
    return await win.__getApprovedSplitBreakdown(restaurantId);
  });
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

    await configureRoleRule(page, 'Manager', 'at_least', 30);

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

  // The whole chain in one pass: settings save → survive a reload → drive the
  // allocation → show up on review → persist to tip_split_items with the rule
  // that produced them. Also covers the two edges the "at least" test does not:
  // `Exactly` capping someone whose hours would earn more, and a teammate on a
  // guaranteed role who did not work drawing nothing.
  test('a fixed-percentage role is capped, an off-shift teammate draws nothing, and the split persists', async ({
    page,
  }) => {
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);

    await createEmployees(page, [
      { name: 'Manager Mo', email: 'mo@test.com', position: 'Manager' },
      { name: 'Manager Mia', email: 'mia@test.com', position: 'Manager' },
      { name: 'Server Sam', email: 'sam@test.com', position: 'Server' },
    ]);

    await page.goto('/tips');
    await page.getByRole('heading', { name: /^tips$/i }).first().waitFor({ state: 'visible', timeout: 25000 });

    await configureRoleRule(page, 'Manager', 'exactly', 30);

    // Reload before entering anything. The rule now has to come back out of the
    // database and re-hydrate the allocation — the previous test only ever
    // exercises the in-memory state written by the settings dialog.
    await navigateToTipsDailyEntry(page);

    // $100 pool. Mo works 1h of the 10h logged, so hours alone would pay him
    // $10; `Exactly 30%` pins him at $30 regardless. Mia is on the same
    // guaranteed role but did not work, so her rule must not apply — if it did,
    // she would take $30 off the top and Sam would drop to $40.
    await enterTipAmount(page, '100');
    await fillHours(page, 'manager mo', '1');
    await fillHours(page, 'manager mia', '0');
    await fillHours(page, 'server sam', '9');

    await expect(page.getByText('30.0% · $30.00')).toBeVisible();
    await expect(page.getByText('70.0% · $70.00')).toBeVisible();

    // The badge lives inside each person's hours label, so scope to the label
    // rather than the page: Mo carries the rule, Mia — same role, no shift —
    // must not, or the UI would be advertising a guarantee she is not getting.
    await expect(page.locator('label', { hasText: 'Manager Mo' })).toContainText('Fixed 30%');
    await expect(page.locator('label', { hasText: 'Manager Mia' })).not.toContainText('Fixed 30%');

    await page.getByRole('button', { name: /approve tips/i }).click();

    // What actually landed in the database — amounts and the audit trail of
    // which rule produced them.
    await expect(async () => {
      const rows = await readApprovedBreakdown(page);
      const by = (name: string) => rows.find(r => r.name === name);

      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows.reduce((sum, r) => sum + r.amountCents, 0)).toBe(10000);

      expect(by('Manager Mo')?.amountCents).toBe(3000);
      expect(by('Manager Mo')?.appliedRule).toEqual({ mode: 'exactly', percentage: 30 });

      expect(by('Server Sam')?.amountCents).toBe(7000);
      expect(by('Server Sam')?.appliedRule).toBeNull();

      // Mia may or may not get a zero row depending on how the split is
      // written; what matters is that she was not paid and not badged.
      const mia = by('Manager Mia');
      if (mia) {
        expect(mia.amountCents).toBe(0);
        expect(mia.appliedRule).toBeNull();
      }
    }).toPass({ timeout: 15000 });
  });
});
