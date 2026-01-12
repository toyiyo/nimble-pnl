import { test, expect, Page } from '@playwright/test';
import { exposeSupabaseHelpers } from '../helpers/e2e-supabase';

type TestUser = {
  email: string;
  password: string;
  fullName: string;
  restaurantName: string;
};

const generateUser = (): TestUser => {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  return {
    email: `bs-${ts}-${rand}@test.com`,
    password: 'TestPassword123!',
    fullName: `Balance Sheet Tester ${rand}`,
    restaurantName: `BS Resto ${rand}`,
  };
};

async function signUpAndCreateRestaurant(page: Page, user: TestUser) {
  await page.goto('/');
  await page.waitForURL(/\/(auth)?$/);

  // If on marketing page, hop to auth
  if (page.url().endsWith('/')) {
    const signInLink = page.getByRole('link', { name: /sign in|log in|get started/i });
    if (await signInLink.isVisible().catch(() => false)) {
      await signInLink.click();
      await page.waitForURL('/auth');
    }
  }

  await page.getByRole('tab', { name: /sign up/i }).click();
  await page.getByLabel(/email/i).first().fill(user.email);
  await page.getByLabel(/full name/i).fill(user.fullName);
  await page.getByLabel(/password/i).first().fill(user.password);
  await page.getByRole('button', { name: /sign up|create account/i }).click();

  const addRestaurantButton = page.getByRole('button', { name: /add restaurant/i });
  await expect(addRestaurantButton).toBeVisible({ timeout: 40000 });
  await addRestaurantButton.click();

  const dialog = page.getByRole('dialog', { name: /add new restaurant/i });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/restaurant name/i).fill(user.restaurantName);
  await dialog.getByLabel(/address/i).fill('123 Balance St');
  await dialog.getByLabel(/phone/i).fill('555-111-2222');
  await dialog.getByRole('button', { name: /create restaurant|add restaurant/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5000 });
}

test('Balance Sheet shows accrual balances across cash, inventory, liabilities, and net income', async ({ page }) => {
  const user = generateUser();

  await signUpAndCreateRestaurant(page, user);
  await exposeSupabaseHelpers(page);

  const restaurantId = await page.evaluate(async () => {
    const fn = (window as any).__getRestaurantId;
    return fn ? await fn() : null;
  });

  expect(restaurantId).toBeTruthy();

  const asOfDate = new Date().toISOString().slice(0, 10);

  await page.evaluate(async ({ rid, dateStr }) => {
    const seed = (window as any).__seedBalanceSheet;
    if (!seed) throw new Error('seed helper not available');
    await seed({ restaurantId: rid, asOfDate: dateStr });
  }, { rid: restaurantId, dateStr: asOfDate });

  await page.goto('/financial-statements');
  await page.getByRole('tab', { name: /balance sheet/i }).click();

  // Assets
  const bsCard = page.getByRole('heading', { name: /balance sheet/i }).locator('xpath=ancestor::div[contains(@class,"card")]');

  await expect(bsCard.getByText('Cash', { exact: true })).toBeVisible();
  await expect(bsCard.getByText('$7,800.00')).toBeVisible();
  await expect(bsCard.getByText('Inventory', { exact: true })).toBeVisible();
  await expect(bsCard.getByText('$800.00')).toBeVisible();
  const totalAssetsRow = bsCard.getByText('Total Assets').locator('xpath=ancestor::div[1]');
  await expect(totalAssetsRow).toBeVisible();
  await expect(totalAssetsRow.getByText('$8,600.00')).toBeVisible();

  // Liabilities
  await expect(bsCard.getByText('Sales Tax Payable').first()).toBeVisible();
  await expect(bsCard.getByText('Tips Payable').first()).toBeVisible();
  await expect(bsCard.getByText('Payroll Liabilities').first()).toBeVisible();
  await expect(bsCard.getByText('$200.00')).toBeVisible();
  await expect(bsCard.getByText('$300.00')).toBeVisible();
  await expect(bsCard.getByText('$400.00')).toBeVisible();
  const totalLiabilitiesRow = bsCard.getByText('Total Liabilities', { exact: true }).locator('xpath=ancestor::div[1]');
  await expect(totalLiabilitiesRow).toBeVisible();
  await expect(totalLiabilitiesRow.getByText('$900.00')).toBeVisible();

  // Equity and net income
  await expect(page.getByText('Opening Equity')).toBeVisible();
  await expect(page.getByText('Current Period Net Income')).toBeVisible();
  await expect(page.getByText('$7,000.00')).toBeVisible();
  await expect(page.getByText('$700.00')).toBeVisible();
  await expect(page.getByText('Total Equity')).toBeVisible();
  await expect(page.getByText('$7,700.00')).toBeVisible();

  // Balance check
  await expect(bsCard.getByText('Total Liabilities & Equity')).toBeVisible();
  const totalLERow = bsCard.getByText('Total Liabilities & Equity').locator('xpath=ancestor::div[1]');
  await expect(totalLERow.getByText('$8,600.00')).toBeVisible();
});
