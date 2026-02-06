import { test, expect, Page } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser, exposeSupabaseHelpers } from '../helpers/e2e-supabase';

test('Income Statement shows seeded POS + journal data', async ({ page }) => {
  const user = generateTestUser();

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
  await expect(totalExpensesRow.getByText('$400.00').first()).toBeVisible();

  // Scope Net Income to its row to avoid duplicate amounts elsewhere
  const netIncomeRow = page.getByText('Net Income').locator('xpath=ancestor::div[1]');
  await expect(netIncomeRow).toBeVisible();
  await expect(netIncomeRow.getByText('$500.00')).toBeVisible();
});
