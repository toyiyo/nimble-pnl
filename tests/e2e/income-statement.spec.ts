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
    email: `pnl-${ts}-${rand}@test.com`,
    password: 'TestPassword123!',
    fullName: `PnL Tester ${rand}`,
    restaurantName: `PnL Resto ${rand}`,
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

  await page.waitForURL('/', { timeout: 20000 });

  const addRestaurantButton = page.getByRole('button', { name: /add restaurant/i });
  await expect(addRestaurantButton).toBeVisible({ timeout: 15000 });
  await addRestaurantButton.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/restaurant name/i).fill(user.restaurantName);
  await dialog.getByLabel(/address/i).fill('123 Test Street');
  await dialog.getByLabel(/phone/i).fill('555-000-0000');
  await dialog.getByRole('button', { name: /create restaurant|add restaurant/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5000 });
}

test('Income Statement shows seeded POS + journal data', async ({ page }) => {
  const user = generateUser();

  await signUpAndCreateRestaurant(page, user);
  await exposeSupabaseHelpers(page);

  const restaurantId = await page.evaluate(async () => {
    const fn = (window as any).__getRestaurantId;
    return fn ? await fn() : null;
  });

  expect(restaurantId).toBeTruthy();

  await page.evaluate(async (rid) => {
    const seed = (window as any).__seedIncomeStatement;
    if (!seed) throw new Error('seed helper not available');
    await seed({ restaurantId: rid });
  }, restaurantId);

  await page.goto('/financial-statements');
  await expect(page.getByRole('heading', { name: /income statement/i })).toBeVisible({ timeout: 15000 });

  // Revenue section
  await expect(page.getByText('Net Sales Revenue')).toBeVisible();
  await expect(page.getByText('$1,400.00')).toBeVisible();
  await expect(page.getByText('Gross Revenue')).toBeVisible();
  await expect(page.getByText('$1,500.00')).toBeVisible();
  await expect(page.getByText('Sales Tax Payable')).toBeVisible();
  await expect(page.getByText('Tips Payable')).toBeVisible();

  // Totals from journal entries
  await expect(page.getByText('Total COGS')).toBeVisible();
  await expect(page.getByText('$500.00').first()).toBeVisible();
  await expect(page.getByText('Total Expenses')).toBeVisible();
  const totalExpensesRow = page.getByText('Total Expenses').locator('xpath=ancestor::div[1]');
  await expect(totalExpensesRow.getByText('$400.00')).toBeVisible();

  // Scope Net Income to its row to avoid duplicate amounts elsewhere
  const netIncomeRow = page.getByText('Net Income').locator('xpath=ancestor::div[1]');
  await expect(netIncomeRow).toBeVisible();
  await expect(netIncomeRow.getByText('$500.00')).toBeVisible();
});
