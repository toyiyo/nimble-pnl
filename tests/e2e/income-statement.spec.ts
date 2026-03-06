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

  // COGS section
  await expect(page.getByText('Total COGS')).toBeVisible();
  await expect(page.getByText('$500.00').first()).toBeVisible();

  // USAR-aligned section headers
  await expect(page.getByText('LABOR COSTS')).toBeVisible();
  await expect(page.getByText('Prime Cost (COGS + Labor)')).toBeVisible();
  await expect(page.getByText('CONTROLLABLE EXPENSES')).toBeVisible();
  await expect(page.getByText('Operating Income')).toBeVisible();

  // Seeded $400 expenses (subtype 'operating_expenses') appear under Controllable
  const totalControllableRow = page.getByText('Total Controllable').locator('xpath=ancestor::div[1]');
  await expect(totalControllableRow.getByText('$400.00').first()).toBeVisible();

  // Percentage column present (e.g. "28.6%" next to a dollar amount)
  await expect(page.getByText(/\d+\.\d+%/).first()).toBeVisible();

  // EBITDA should NOT appear (no depreciation accounts seeded)
  await expect(page.getByText('EBITDA')).not.toBeVisible();

  // Scope Net Income to its row to avoid duplicate amounts elsewhere
  const netIncomeRow = page.getByText('Net Income').locator('xpath=ancestor::div[1]');
  await expect(netIncomeRow).toBeVisible();
  await expect(netIncomeRow.getByText('$500.00')).toBeVisible();
});
