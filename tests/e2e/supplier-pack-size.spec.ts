import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser } from '../helpers/e2e-supabase';

const generateTestProduct = () => {
  const rand = Math.random().toString(36).slice(2, 6);
  return {
    name: `Pack Size Product ${rand}`,
    sku: `PACK-${rand}`,
    supplierName: `Pack Supplier ${rand}`,
  };
};

test('user can add a supplier with a pack size and see the per-unit price', async ({ page }) => {
  const user = generateTestUser();
  const product = generateTestProduct();

  await signUpAndCreateRestaurant(page, user);

  // Create a product with no supplier yet.
  await page.goto('/inventory');
  await page.waitForURL(/\/inventory/);

  const headerAddButton = page.getByRole('button', { name: /add product/i }).first();
  const emptyStateButton = page.getByRole('button', { name: /add your first product/i });

  if (await headerAddButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    await headerAddButton.click();
  } else {
    await expect(emptyStateButton).toBeVisible();
    await emptyStateButton.click();
  }

  const createDialog = page.getByRole('dialog');
  await expect(createDialog).toBeVisible();
  await createDialog.getByLabel(/sku \*/i).fill(product.sku);
  await createDialog.getByLabel(/product name \*/i).fill(product.name);
  await createDialog.getByLabel(/quantity.*add/i).first().fill('0');
  await createDialog.getByRole('button', { name: 'Update Product' }).click();
  await expect(createDialog).not.toBeVisible({ timeout: 10000 });

  await expect(page.getByRole('heading', { name: product.name })).toBeVisible({ timeout: 10000 });

  // Reopen the product to add a supplier with a pack size.
  await page.getByRole('button', { name: `Edit ${product.name}` }).click();

  const editDialog = page.getByRole('dialog');
  await expect(editDialog).toBeVisible();
  await editDialog.getByRole('button', { name: 'Add Supplier' }).click();

  await editDialog.getByRole('combobox').filter({ hasText: 'Search or create supplier...' }).click();
  await page.getByPlaceholder('Search or create supplier...').fill(product.supplierName);
  await page.getByText(`+ Create New Supplier: "${product.supplierName}"`).click();

  await editDialog.getByLabel('Cost per Unit ($)').fill('12');
  await editDialog.getByLabel('Pack size').fill('4');
  await editDialog.getByRole('combobox', { name: 'Pack size unit' }).click();
  await page.getByRole('option', { name: 'lb', exact: true }).click();

  await editDialog.getByRole('button', { name: 'Save Supplier' }).click();

  // $12 / 4 lb = $3.00/lb.
  await expect(editDialog.getByText('$3.00/lb')).toBeVisible({ timeout: 10000 });
});
