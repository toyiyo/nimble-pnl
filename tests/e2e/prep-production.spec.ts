import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser } from '../helpers/e2e-supabase';

test.describe('Prep Production E2E Flow', () => {
  test('should complete full prep production workflow with cost calculations', async ({ page }) => {
    const user = generateTestUser();

    // Step 1: Sign up and create restaurant
    await signUpAndCreateRestaurant(page, user);

    // Navigate to Inventory via sidebar
    const sidebar = page.locator('[data-sidebar="sidebar"]');
    await sidebar.locator('[data-sidebar="group-label"]', { hasText: /^Inventory$/ }).click();
    await sidebar.locator('[data-sidebar="menu-button"]', { hasText: /^Inventory$/ }).click();

    // Create a product
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
    await page.getByRole('button', { name: 'New Recipe' }).click();

    // Fill in Details tab
    await page.getByRole('textbox', { name: 'Recipe Name' }).fill('CHICKEN SOUP');

    // Set yield on Details tab
    await page.getByRole('spinbutton', { name: '1X Yield' }).clear();
    await page.getByRole('spinbutton', { name: '1X Yield' }).fill('10');
    await page.getByRole('combobox', { name: 'Yield Unit' }).click();
    await page.getByRole('option', { name: 'L', exact: true }).click();

    // Navigate to Ingredients tab
    await page.getByRole('tab', { name: 'Ingredients' }).click();

    // Add ingredient - click the ingredient selector
    await page.getByRole('combobox').filter({ hasText: 'Select Ingredient' }).click();
    await page.getByText('CHICKEN-BREAST').first().click();

    // Set ingredient quantity to 10 (the first 1X QTY field)
    const qtyInputs = page.locator('input[type="number"]');
    await qtyInputs.first().clear();
    await qtyInputs.first().fill('10');

    // Create the recipe
    await page.getByRole('button', { name: 'Create Recipe' }).click();

    // Wait for dialog to close
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });

    // Validate Step 2: Recipe was created correctly
    await expect(page.getByRole('heading', { name: 'CHICKEN SOUP' })).toBeVisible();

    // Step 3: Use "Cook Now" to complete the prep production
    // Find the recipe card and click Cook Now
    const recipeCard = page.locator('[class*="card"]').filter({ hasText: 'CHICKEN SOUP' });
    await recipeCard.getByRole('button', { name: 'Cook Now' }).click();

    // Validate the Quick Cook confirmation dialog appears
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Cook Now: CHICKEN SOUP')).toBeVisible();

    // Should show ingredient preview with deduction
    await expect(page.getByRole('dialog').getByText('CHICKEN-BREAST')).toBeVisible();

    // Confirm the cook
    await page.getByRole('dialog').getByRole('button', { name: 'Cook Now' }).click();

    // Wait for the dialog to close and success notification
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });

    // Step 4: Verify inventory was updated correctly
    await page.getByRole('button', { name: 'Inventory' }).click();

    // Find the chicken breast product card and check stock
    const chickenCard = page.getByRole('heading', { name: 'CHICKEN-BREAST' }).locator('..').locator('..');
    await chickenCard.getByRole('button', { name: 'Edit' }).click();

    // Validate: Inventory was updated correctly (10 lb used = 1 bag consumed, 9 remaining)
    await expect(
      page.getByRole('dialog').getByText(/Current Stock: 9(?:\.0+)? bag/)
    ).toBeVisible();
  });
});
