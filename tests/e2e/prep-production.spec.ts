import { test, expect, Page } from '@playwright/test';

type TestUser = {
  email: string;
  password: string;
  fullName: string;
  restaurantName: string;
};

const generateTestUser = (): TestUser => {
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  return {
    email: `prep-${stamp}-${rand}@example.com`,
    password: 'TestPassword123!',
    fullName: `Prep User ${stamp}`,
    restaurantName: `Prep Resto ${stamp}`,
  };
};

test.describe('Prep Production E2E Flow', () => {
  test('should complete full prep production workflow with cost calculations', async ({ page }) => {
    const user = generateTestUser();

    // Step 1: Sign up and create restaurant
    await page.goto('/');
    await page.waitForURL(/\/(auth)?$/);

    if (page.url().endsWith('/')) {
      const signInLink = page.getByRole('link', { name: /sign in|log in|get started/i });
      if (await signInLink.isVisible()) {
        await signInLink.click();
        await page.waitForURL('/auth');
      }
    }

    await page.getByRole('tab', { name: /sign up/i }).click();
    await page.getByLabel(/email/i).first().fill(user.email);
    await page.getByLabel(/full name/i).fill(user.fullName);
    await page.getByLabel(/password/i).first().fill(user.password);
    await page.getByRole('button', { name: /sign up|create account/i }).click();
    await page.waitForURL('/');

    const addRestaurantButton = page.getByRole('button', { name: /add restaurant/i });
    await addRestaurantButton.click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/restaurant name/i).fill(user.restaurantName);
    await dialog.getByRole('button', { name: /create restaurant/i }).click();
    await expect(page.getByRole('main').getByText(user.restaurantName)).toBeVisible({ timeout: 2000 });

    // Select the restaurant on the main page
    await page.getByRole('button', { name: user.restaurantName }).click();
    await page.goto('http://localhost:4173/auth');
    await page.getByRole('tab', { name: 'Sign Up' }).click();
    await page.getByRole('textbox', { name: 'Email' }).click();
    await page.getByRole('textbox', { name: 'Email' }).fill('testemail@test.com');
    await page.getByRole('textbox', { name: 'Email' }).press('Tab');
    await page.getByRole('textbox', { name: 'Full Name' }).fill('testing prep');
    await page.getByRole('textbox', { name: 'Full Name' }).press('Tab');
    await page.getByRole('textbox', { name: 'Password' }).fill('test1234');
    await page.getByRole('button', { name: 'Sign Up' }).click();
    await page.getByRole('button', { name: 'Add Restaurant' }).click();
    await page.getByRole('textbox', { name: 'Restaurant Name *' }).click();
    await page.getByRole('textbox', { name: 'Restaurant Name *' }).fill('prep restaurant');
    await page.getByRole('button', { name: 'Create Restaurant' }).click();
    await page.getByText('Inventory', { exact: true }).click();
    await page.getByRole('button', { name: 'Inventory', exact: true }).click();
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
    await page.getByRole('combobox').filter({ hasText: 'Select unit' }).press('Tab');
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
    await page.getByRole('button', { name: 'Prep Recipes' }).click();
    await page.getByRole('button', { name: 'New prep recipe' }).click();
    await page.getByRole('textbox', { name: 'Recipe name' }).fill('CHICKEN SOUP');
    await page.getByRole('combobox').filter({ hasText: 'Select product' }).click();
    await page.getByText('CHICKEN-BREAST').click();
    await page.getByRole('combobox').filter({ hasText: 'kg' }).click();
    await page.getByRole('option', { name: 'lb' }).click();
    await page.getByRole('combobox', { name: 'Output item' }).click();
    await page.locator('.fixed.inset-0').click();
    await page.getByRole('spinbutton', { name: 'Default yield' }).click();
    await page.getByRole('spinbutton', { name: 'Default yield' }).fill('10');
    await page.getByRole('combobox', { name: 'Yield unit' }).click();
    await page.getByRole('option', { name: 'L', exact: true }).click();
    await page.getByRole('spinbutton').nth(2).click();
    await page.getByRole('spinbutton').nth(2).fill('10');
    await page.getByRole('button', { name: 'Create recipe' }).click();
    await page.getByRole('button', { name: 'Batches' }).click();
    await page.getByLabel('All0').getByRole('button', { name: 'New batch' }).click();
    await page.getByRole('button', { name: 'Create batch' }).click();
    await page.getByRole('button', { name: 'planned Target 10 L CHICKEN' }).click();



  });
});
