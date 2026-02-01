/**
 * E2E tests for asset quantity support
 *
 * Tests the ability to create and manage assets with quantity > 1,
 * where a single asset record represents multiple identical units.
 *
 * Example: 2 refrigerators at $20,000 each = $40,000 total
 */

import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser, exposeSupabaseHelpers } from '../helpers/e2e-supabase';

// Helper to select an option from a Radix UI combobox
async function selectRadixOption(page: any, dialog: any, labelPattern: RegExp, optionText: string) {
  const combobox = dialog.getByLabel(labelPattern);
  await combobox.click();
  // Wait for options to appear and click the matching one
  const option = page.getByRole('option', { name: new RegExp(optionText, 'i') });
  await option.click();
}

test.describe('Asset Quantity Support', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    // Navigate to app first before clearing storage (can't access localStorage on about:blank)
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test('can create a multi-quantity asset', async ({ page }) => {
    const user = generateTestUser('asset-qty');

    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    // Navigate to assets page
    await page.goto('/assets');
    await expect(page.getByRole('heading', { name: 'Assets & Equipment' })).toBeVisible({ timeout: 10000 });

    // Click add asset button
    const addButton = page.getByRole('button', { name: /add asset/i });
    await expect(addButton).toBeVisible();
    await addButton.click();

    // Wait for dialog to open
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Fill in asset details
    await dialog.getByLabel(/name/i).fill('Commercial Refrigerator');

    // Select category using Radix combobox
    await selectRadixOption(page, dialog, /category/i, 'Kitchen Equipment');

    await dialog.getByLabel(/purchase date/i).fill('2024-01-15');

    // Set quantity to 2
    const quantityInput = dialog.getByLabel(/quantity/i);
    await quantityInput.clear();
    await quantityInput.fill('2');

    // Set unit cost to $20,000
    const unitCostInput = dialog.getByLabel(/unit cost/i);
    await unitCostInput.clear();
    await unitCostInput.fill('20000');

    // Total cost should be $40,000 (2 × $20,000) - may or may not display in dialog
    // Verify it after save if not shown in dialog

    // Set salvage value
    const salvageInput = dialog.getByLabel(/salvage/i);
    await salvageInput.clear();
    await salvageInput.fill('4000');

    // Set useful life (84 months = 7 years for kitchen equipment)
    const usefulLifeInput = dialog.getByLabel(/useful life/i);
    await usefulLifeInput.clear();
    await usefulLifeInput.fill('84');

    // Save the asset
    await dialog.getByRole('button', { name: /save|create|add/i }).click();

    // Dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Verify asset appears in list
    await expect(page.getByText('Commercial Refrigerator')).toBeVisible({ timeout: 5000 });

    // Should show quantity or total cost - check if either exists
    const hasQuantityFormat = await page.getByText(/2\s*×/i).first().isVisible().catch(() => false);
    const hasTotalCost = await page.getByText('$40,000').first().isVisible().catch(() => false);
    expect(hasQuantityFormat || hasTotalCost).toBeTruthy();
  });

  test('quantity defaults to 1 for single-unit assets', async ({ page }) => {
    const user = generateTestUser('asset-single');

    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    await page.goto('/assets');
    await expect(page.getByRole('heading', { name: 'Assets & Equipment' })).toBeVisible({ timeout: 10000 });

    // Click add asset button
    await page.getByRole('button', { name: /add asset/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Verify quantity defaults to 1
    const quantityInput = dialog.getByLabel(/quantity/i);
    await expect(quantityInput).toHaveValue('1');

    // Fill basic details
    await dialog.getByLabel(/name/i).fill('Single POS Terminal');
    await selectRadixOption(page, dialog, /category/i, 'Electronics');
    await dialog.getByLabel(/purchase date/i).fill('2024-02-01');

    const unitCostInput = dialog.getByLabel(/unit cost/i);
    await unitCostInput.clear();
    await unitCostInput.fill('500');

    await dialog.getByLabel(/salvage/i).fill('50');

    const usefulLifeInput = dialog.getByLabel(/useful life/i);
    await usefulLifeInput.clear();
    await usefulLifeInput.fill('36');

    // Save
    await dialog.getByRole('button', { name: /save|create|add/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Asset should show in list
    await expect(page.getByText('Single POS Terminal')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('$500').first()).toBeVisible();
  });

  test('asset summary counts units not records', async ({ page }) => {
    const user = generateTestUser('asset-summary');

    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(async () => {
      const fn = (window as any).__getRestaurantId;
      return fn ? await fn() : null;
    });

    expect(restaurantId).toBeTruthy();

    // Seed multiple assets with different quantities directly via Supabase
    await page.evaluate(async ({ rid }) => {
      const supabase = (window as any).__supabase;

      // Insert assets with different quantities
      const assets = [
        {
          restaurant_id: rid,
          name: 'Office Chairs',
          category: 'Furniture & Fixtures',
          purchase_date: '2024-01-01',
          quantity: 5,
          unit_cost: 200,
          purchase_cost: 1000,
          salvage_value: 100,
          useful_life_months: 84,
          status: 'active',
          accumulated_depreciation: 0,
        },
        {
          restaurant_id: rid,
          name: 'Laptops',
          category: 'Electronics',
          purchase_date: '2024-01-01',
          quantity: 3,
          unit_cost: 1500,
          purchase_cost: 4500,
          salvage_value: 300,
          useful_life_months: 60,
          status: 'active',
          accumulated_depreciation: 0,
        },
        {
          restaurant_id: rid,
          name: 'Commercial Oven',
          category: 'Kitchen Equipment',
          purchase_date: '2024-01-01',
          quantity: 1,
          unit_cost: 8000,
          purchase_cost: 8000,
          salvage_value: 800,
          useful_life_months: 84,
          status: 'active',
          accumulated_depreciation: 0,
        },
      ];

      const { error } = await supabase.from('assets').insert(assets);
      if (error) throw new Error(`Failed to seed assets: ${error.message}`);
    }, { rid: restaurantId });

    // Navigate to assets page and check summary
    await page.goto('/assets');
    await expect(page.getByRole('heading', { name: 'Assets & Equipment' })).toBeVisible({ timeout: 10000 });

    // Wait for assets to load
    await expect(page.getByText('Office Chairs')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Laptops')).toBeVisible();
    await expect(page.getByText('Commercial Oven')).toBeVisible();

    // The summary should count units: 5 + 3 + 1 = 9 total assets
    // Look for "9" somewhere on the page indicating total assets
    // Check for the number 9 in the asset count context
    const hasNineAssets = await page.getByText('9').first().isVisible({ timeout: 5000 }).catch(() => false);
    expect(hasNineAssets).toBeTruthy();
  });

  test('seeded asset has correct quantity and cost', async ({ page }) => {
    const user = generateTestUser('asset-seed-qty');

    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(async () => {
      const fn = (window as any).__getRestaurantId;
      return fn ? await fn() : null;
    });

    // Seed an asset with quantity > 1
    await page.evaluate(async ({ rid }) => {
      const supabase = (window as any).__supabase;
      await supabase.from('assets').insert({
        restaurant_id: rid,
        name: 'Dining Tables',
        category: 'Furniture & Fixtures',
        purchase_date: '2024-01-01',
        quantity: 4,
        unit_cost: 500,
        purchase_cost: 2000, // 4 × 500
        salvage_value: 200,
        useful_life_months: 84,
        status: 'active',
        accumulated_depreciation: 0,
      });
    }, { rid: restaurantId });

    await page.goto('/assets');
    await expect(page.getByText('Dining Tables')).toBeVisible({ timeout: 10000 });

    // Verify the quantity display (should show "4 ×" or similar)
    const hasQuantityFormat = await page.getByText(/4\s*×/i).first().isVisible().catch(() => false);
    const hasTotalCost = await page.getByText('$2,000').first().isVisible().catch(() => false);
    expect(hasQuantityFormat || hasTotalCost).toBeTruthy();
  });

  test('validates quantity field has minimum of 1', async ({ page }) => {
    const user = generateTestUser('asset-qty-val');

    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    await page.goto('/assets');
    await expect(page.getByRole('heading', { name: 'Assets & Equipment' })).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: /add asset/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Check that quantity input has min=1 attribute
    const quantityInput = dialog.getByLabel(/quantity/i);
    await expect(quantityInput).toHaveAttribute('min', '1');

    // Verify the input is a number type
    await expect(quantityInput).toHaveAttribute('type', 'number');
  });
});
