import { test, expect, Page } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser, exposeSupabaseHelpers } from '../helpers/e2e-supabase';

test('Balance Sheet shows accrual balances across cash, inventory, liabilities, and net income', async ({ page }) => {
  const user = generateTestUser();

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
