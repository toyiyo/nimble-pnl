import { Buffer } from 'buffer';
import { test, expect, Page } from '@playwright/test';

type TestUser = {
  email: string;
  password: string;
  fullName: string;
  restaurantName: string;
};

type TestProduct = {
  name: string;
  sku: string;
  supplierName: string;
  supplierSku: string;
  costPerUnit: number;
  initialStock: number;
};

const createTestImageBuffer = () =>
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6X8nL8AAAAASUVORK5CYII=', 'base64');

const generateTestUser = (): TestUser => {
  const timestamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  return {
    email: `inventory-${timestamp}-${rand}@test.com`,
    password: 'TestPassword123!',
    fullName: `Inventory Tester ${timestamp}`,
    restaurantName: `Inventory Resto ${timestamp}`,
  };
};

const generateTestProduct = (): TestProduct => {
  const rand = Math.random().toString(36).slice(2, 6);
  return {
    name: `Camera Product ${rand}`,
    sku: `CAM-${rand}`,
    supplierName: `Supplier ${rand}`,
    supplierSku: `SUP-${rand}`,
    costPerUnit: 4.5,
    initialStock: 3,
  };
};

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

  await page.waitForURL('/', { timeout: 10000 });

  await expect(page.getByRole('button', { name: /add restaurant/i })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: /add restaurant/i }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/restaurant name/i).fill(user.restaurantName);
  await dialog.getByLabel(/address/i).fill('123 Inventory Street');
  await dialog.getByLabel(/phone/i).fill('555-987-6543');
  await dialog.getByRole('button', { name: /create restaurant/i }).click();

  await expect(dialog).not.toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);
}

test('user can create a new product with image and supplier in one flow', async ({ page }) => {
  const user = generateTestUser();
  const product = generateTestProduct();

  await signUpAndCreateRestaurant(page, user);

  // Navigate to inventory
  await page.goto('/inventory');
  await page.waitForURL(/\/inventory/);

  // Click add product button (header or empty state)
  const headerAddButton = page.getByRole('button', { name: /add product/i }).first();
  const emptyStateButton = page.getByRole('button', { name: /add your first product/i });
  
  if (await headerAddButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await headerAddButton.click();
  } else {
    await expect(emptyStateButton).toBeVisible();
    await emptyStateButton.click();
  }

  // Fill product form
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByLabel(/sku \*/i).fill(product.sku);
  await dialog.getByLabel(/product name \*/i).fill(product.name);

  // Upload image
  const imageInput = dialog.locator('#image-upload');
  await imageInput.setInputFiles({
    name: 'product.png',
    mimeType: 'image/png',
    buffer: createTestImageBuffer(),
  });
  await expect(dialog.getByAltText(/product preview/i)).toBeVisible();

  // Fill cost per unit
  const costInput = dialog.getByLabel(/cost per .*unit/i);
  await costInput.scrollIntoViewIfNeeded();
  await costInput.fill(product.costPerUnit.toString());

  // Select supplier
  const supplierCombobox = dialog.getByRole('combobox').filter({ has: page.getByRole('button') });
  await supplierCombobox.scrollIntoViewIfNeeded();
  await supplierCombobox.click();
  
  const supplierSearchInput = page.getByPlaceholder(/search or create supplier/i);
  await expect(supplierSearchInput).toBeVisible();
  await supplierSearchInput.fill(product.supplierName);
  
  const createSupplierOption = page.getByText(new RegExp(String.raw`\+ Create New Supplier: "${product.supplierName}"`, 'i'));
  await expect(createSupplierOption).toBeVisible();
  await createSupplierOption.click();
  
  // Fill supplier SKU
  const supplierSkuInput = dialog.getByLabel(/supplier sku/i);
  await supplierSkuInput.scrollIntoViewIfNeeded();
  await supplierSkuInput.fill(product.supplierSku);

  // Fill current stock
  const currentStockInput = dialog.getByLabel(/current stock/i);
  await currentStockInput.scrollIntoViewIfNeeded();
  await currentStockInput.fill(String(product.initialStock));

  // Submit
  await dialog.getByRole('button', { name: /add product/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 10000 });

  // Verify product created with image
  await expect(page.getByRole('heading', { name: product.name })).toBeVisible();
  
  const productImage = page.locator(`img[alt="${product.name}"]`).first();
  await expect(productImage).toBeVisible();

  // Verify supplier info by editing
  const editButton = page.getByRole('button', { name: /edit/i }).first();
  await editButton.click();

  const editDialog = page.getByRole('dialog');
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByText(product.supplierName)).toBeVisible();
  
  const editCostInput = editDialog.getByLabel(/cost per .*unit/i);
  await expect(editCostInput).toHaveValue(product.costPerUnit.toString());
});
