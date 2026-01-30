import { test, expect, Page } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser } from '../helpers/e2e-supabase';

test.describe('Prep Production E2E Flow', () => {
  test('should complete full prep production workflow with cost calculations', async ({ page }) => {
    const user = generateTestUser();

    // Step 1: Sign up and create restaurant
    await signUpAndCreateRestaurant(page, user);

    // Select the restaurant on the main page

    const sidebar = page.locator('[data-sidebar="sidebar"]');
    await sidebar.locator('[data-sidebar="group-label"]', { hasText: /^Inventory$/ }).click();
    await sidebar.locator('[data-sidebar="menu-button"]', { hasText: /^Inventory$/ }).click();
    await page.getByRole('button', { name: 'Add Your First Product' }).click();
    await page.getByRole('spinbutton', { name: 'Quantity to Add (in pieces)' }).click();
    await page.getByRole('spinbutton', { name: 'Quantity to Add (in pieces)' }).fill('10');
    await page.getByRole('textbox', { name: 'SKU *' }).click();
    await page.getByRole('textbox', { name: 'SKU *' }).press('CapsLock');
    await page.getByRole('textbox', { name: 'SKU *' }).fill('CHICKEN BREAST');
    await page.getByRole('textbox', { name: 'Product Name *' }).click();
    await page.getByRole('textbox', { name: 'Product Name *' }).fill('CHICKEN-BREAST');
    await page.getByRole('spinbutton', { name: 'Amount per Package 📦' }).click();
    await page.getByRole('spinbutton', { name: 'Amount per Package 📦' }).fill('10');
    await page.getByRole('spinbutton', { name: 'Amount per Package 📦' }).press('Tab');
    await page.getByRole('combobox').filter({ hasText: 'Select unit' }).click();
    await page.getByRole('option', { name: 'lb' }).click();
    await page.getByRole('combobox', { name: /package type/i }).click();
    await page.getByRole('option', { name: 'Bag', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Amount per Package 📦' }).click();
    await page.getByRole('button', { name: 'Add Supplier' }).click();
    await page.getByRole('combobox').filter({ hasText: 'Search or create supplier...' }).click();
    await page.getByPlaceholder('Search or create supplier...').fill('HEB');
    await page.getByText('+ Create New Supplier: "HEB"').click();
    await page.getByPlaceholder('0.00').click();
    await page.getByPlaceholder('0.00').fill('10');
    await page.getByPlaceholder('0.00').press('Tab');
    await page.getByRole('button', { name: 'Save Supplier' }).click();
    await page.getByLabel('Notifications (F8)').locator('button').click();
    await page.getByRole('button', { name: 'Update Product' }).click();

    // Validate Step 1: Product was created correctly
    await expect(page.getByRole('heading', { name: 'CHICKEN-BREAST' })).toBeVisible();
    await expect(page.getByText('CHICKEN BREAST')).toBeVisible();
    await expect(page.getByText('$10.00')).toBeVisible(); // Cost per unit
    await expect(page.getByText('10.00 bag')).toBeVisible(); // Stock quantity

    // Step 2: Create a prep recipe with that inventory item
    await page.getByRole('button', { name: 'Prep Recipes' }).click();
    await page.getByRole('button', { name: 'New prep recipe' }).click();
    await page.getByRole('textbox', { name: 'Recipe name' }).fill('CHICKEN SOUP');
    await page.getByRole('combobox').filter({ hasText: 'Select product' }).click();
    await page.getByText('CHICKEN-BREAST').first().click();
    await page.getByRole('combobox').filter({ hasText: 'kg' }).click();
    await page.getByRole('option', { name: 'lb' }).click();
    await page.getByRole('combobox', { name: 'Output item' }).click();
    await page.locator('.fixed.inset-0').click();
    await page.getByRole('spinbutton', { name: 'Default yield' }).click();
    await page.getByRole('spinbutton', { name: 'Default yield' }).fill('10');
    await page.getByRole('combobox', { name: 'Yield unit' }).click();
    await page.getByRole('option', { name: 'L', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Quantity' }).nth(0).click();
    await page.getByRole('spinbutton', { name: 'Quantity' }).nth(0).fill('10');
    await page.getByRole('button', { name: 'Create recipe' }).click();

    // Validate Step 2: Recipe was created correctly
    await expect(page.getByText('CHICKEN SOUP', { exact: true })).toBeVisible();
    await expect(page.getByText('Yields 10 L')).toBeVisible(); // Yield
    await expect(
      page.getByLabel(/Cost \$10\.00 per batch, \$1\.00 per L/)
    ).toBeVisible(); // Cost per batch + unit

    // Step 3: Create and complete a prep production batch
    await page.getByRole('button', { name: 'Batches' }).click();
    await page.getByLabel('All0').getByRole('button', { name: 'New batch' }).click();
    await page.getByRole('button', { name: 'Create batch' }).click();

    // Validate Step 3: Batch was created correctly

    await expect(page.getByRole('button', { name: 'planned Target 10 L CHICKEN' })).toBeVisible();

    await page.getByRole('button', { name: 'planned Target 10 L CHICKEN' }).click();

   await page.getByRole('button', { name: 'Complete batch' }).click();
   await page.getByRole('button', { name: 'Close' }).nth(1).click();

   // Validate Step 4: Batch was completed and costs calculated
   await expect(page.getByRole('button', { name: 'completed Target 10 L Actual' })).toBeVisible();

   
   await page.getByRole('button', { name: 'Inventory' }).click();
   const chickenCard = page.getByRole('heading', { name: 'CHICKEN-BREAST' }).locator('..').locator('..');
   await chickenCard.getByRole('button', { name: 'Edit' }).click();

   // Validate Step 5: Inventory was updated correctly (10 lb used -> 1 bag consumed)
   await expect(
     page.getByRole('dialog').getByText(/Current Stock: 9(?:\.0+)? bag/)
   ).toBeVisible();
  });
});
