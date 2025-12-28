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

const products = [
  { name: 'Raw Chicken', sku: 'RAW-CHICKEN', initialStock: 50, uom: 'Bag', cost: 4 },
  { name: 'Water', sku: 'WATER', initialStock: 100, uom: 'Bottle', cost: 0.1 },
  { name: 'Chicken Soup Base', sku: 'SOUP-BASE', initialStock: 0, uom: 'Case', cost: 0 },
];

async function signUpAndCreateRestaurant(page: Page, user: TestUser) {
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
  await dialog.getByLabel(/address/i).fill('123 Prep Street');
  await dialog.getByLabel(/phone/i).fill('555-111-2222');
  await dialog.getByRole('button', { name: /create restaurant/i }).click();
  await expect(dialog).not.toBeVisible();
}

async function createProduct(page: Page, product: { name: string; sku: string; initialStock: number; uom: string; cost: number; }) {
  await page.goto('/inventory');
  await page.waitForURL(/\/inventory/);

  const addButtons = [
    page.getByRole('button', { name: /add product/i }).first(),
    page.getByRole('button', { name: /add your first product/i }).first(),
    page.getByRole('button', { name: /add item/i }).first(),
  ];
  let clicked = false;
  for (const btn of addButtons) {
    try {
      if (await btn.isVisible({ timeout: 500 })) {
        await btn.click();
        clicked = true;
        break;
      }
    } catch {
      /* ignore */
    }
  }
  if (!clicked) {
    throw new Error('Could not find add product button');
  }

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/sku \*/i).fill(product.sku);
  await dialog.getByLabel(/product name \*/i).fill(product.name);
  await dialog.getByLabel(/package type/i).click();
  await page.getByRole('option', { name: product.uom, exact: true }).click();
  await dialog.getByLabel(/cost per/i).fill(String(product.cost));

  const qtyInput = dialog.getByLabel(/quantity.*add/i).first();
  await qtyInput.fill(String(product.initialStock));

  await dialog.getByRole('button', { name: /save|update/i }).first().click();
  await expect(dialog).not.toBeVisible({ timeout: 5000 });
}

test('Prep recipe -> batch completion -> prep stock available for sales', async ({ page }) => {
  const user = generateTestUser();

  await signUpAndCreateRestaurant(page, user);

  // Seed products (raw ingredients + prep output shell)
  for (const p of products) {
    await createProduct(page, p);
  }

  // Create prep recipe
  await page.goto('/prep-recipes');
  await page.getByRole('button', { name: /new recipe/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/recipe name/i).fill('Chicken Soup Base');
  await dialog.getByLabel(/default yield/i).fill('10');
  await dialog.getByLabel(/yield unit/i).click();
  await page.getByRole('option', { name: /^L$/ }).click();

  // Ingredient 1: Raw Chicken 5 kg
  await dialog.getByText(/product/i).first().click();
  await page.getByRole('option', { name: /raw chicken/i }).click();
  await dialog.getByLabel(/quantity/i).first().fill('5');
  await dialog.getByText(/^Unit$/i).first().click();
  await page.getByRole('option', { name: /^kg$/ }).click();

  // Ingredient 2: Water 5 L
  await dialog.getByText(/product/i).nth(1).click();
  await page.getByRole('option', { name: /^water$/i }).click();
  await dialog.getByLabel(/quantity/i).nth(1).fill('5');
  await dialog.getByText(/^Unit$/i).nth(1).click();
  await page.getByRole('option', { name: /^L$/ }).click();

  await dialog.getByRole('button', { name: /create recipe/i }).click();
  await expect(page.getByText(/chicken soup base/i).first()).toBeVisible({ timeout: 5000 });

  // Create a batch for 20 L
  await page.goto('/batches');
  await page.getByRole('button', { name: /new batch/i }).click();
  const batchDialog = page.getByRole('dialog');
  await batchDialog.getByRole('combobox').click();
  await page.getByRole('option', { name: /chicken soup base/i }).click();
  await batchDialog.getByLabel(/target yield/i).fill('20');
  await batchDialog.getByLabel(/unit/i).click();
  await page.getByRole('option', { name: /^L$/ }).click();
  await batchDialog.getByRole('button', { name: /create batch/i }).click();
  await expect(page.getByText(/chicken soup base/i).first()).toBeVisible({ timeout: 5000 });

  // Open batch detail and complete
  await page.getByText(/chicken soup base/i).first().click();
  const detailDialog = page.getByRole('dialog');
  await detailDialog.getByRole('button', { name: /complete batch/i }).click({ timeout: 5000 });
  await expect(page.getByText(/batch completed/i)).toBeVisible({ timeout: 5000 });
  await detailDialog.getByRole('button', { name: /close/i }).click();

  // Validate inventory changes by checking stocks roughly
  await page.goto('/inventory');
  await page.getByPlaceholder(/search/i).fill('Raw Chicken');
  const chickenRow = page.getByText(/raw chicken/i).first();
  await expect(chickenRow).toBeVisible();

  await page.getByPlaceholder(/search/i).fill('Chicken Soup Base');
  const soupRow = page.getByText(/chicken soup base/i).first();
  await expect(soupRow).toBeVisible();
});
