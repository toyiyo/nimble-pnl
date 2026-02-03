import { test, expect, Page } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser } from '../helpers/e2e-supabase';

type TestProduct = {
  name: string;
  sku: string;
  initialStock: number;
  reconciledStock: number;
  costPerUnit: number;
};

const generateTestProduct = (): TestProduct => {
  const rand = Math.random().toString(36).slice(2, 6);
  return {
    name: `Recon Product ${rand}`,
    sku: `RECON-${rand}`,
    initialStock: 5,
    reconciledStock: 9,
    costPerUnit: 2.5,
  };
};

async function createProduct(page: Page, product: TestProduct) {
  await page.goto('/inventory');
  await page.waitForURL(/\/inventory/);

  // Prefer the header action; fall back to empty-state button if needed
  const addButton = page.getByRole('button', { name: 'Add new product manually' }).first();
  if (!(await addButton.isVisible())) {
    await page.getByRole('button', { name: 'Add Your First Product' }).click();
  } else {
    await addButton.click();
  }
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByLabel(/sku \*/i).fill(product.sku);
  await dialog.getByLabel(/product name \*/i).fill(product.name);

  // Set exact starting stock for the new product
  const setExactButton = dialog.getByRole('button', { name: /set exact count/i });
  await setExactButton.click();
  await dialog.getByLabel(/exact stock count/i).fill(String(product.initialStock));

  await dialog.getByRole('button', { name: /update product|add product|save/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 10000 });
  // The product grid renders the name in multiple cards; assert the first visible instance
  await expect(page.getByRole('heading', { name: product.name }).first()).toBeVisible({ timeout: 10000 });
}

async function completeReconciliation(page: Page, product: TestProduct) {
  const reconcileTab = page.getByRole('tab', { name: /reconciliation/i });
  await expect(reconcileTab).toBeVisible({ timeout: 10000 });
  await reconcileTab.click();

  const startButton = page.getByRole('button', { name: /start new count/i });
  await expect(startButton).toBeVisible({ timeout: 15000 });
  await startButton.click();

  await expect(page.getByText(/counting in progress/i)).toBeVisible({ timeout: 15000 });

  const countInput = page.getByPlaceholder(/count/i).first();
  await countInput.fill(String(product.reconciledStock));
  await countInput.press('Enter');

  const reviewButton = page.getByRole('button', { name: /review/i });
  await expect(reviewButton).toBeEnabled({ timeout: 10000 });
  await reviewButton.click();

  await expect(page.getByText(/reconciliation summary/i)).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: /confirm & submit reconciliation/i }).click();

  // Wait until we are back on the reconciliation history view
  await expect(page.getByText(/inventory reconciliation history/i)).toBeVisible({ timeout: 20000 });
}

test('inventory reconciliation updates product stock', async ({ page }) => {
  const user = generateTestUser();
  const product = generateTestProduct();

  await signUpAndCreateRestaurant(page, user);
  await createProduct(page, product);
  await completeReconciliation(page, product);

  await page.getByRole('tab', { name: /products/i }).click();

  // Confirm stock on at least one product card reflects the reconciled count
  await expect(page.getByRole('heading', { name: product.name }).first()).toBeVisible({ timeout: 10000 });
  await expect(
    page.getByText(new RegExp(`${product.reconciledStock.toFixed(2)}\\s+pieces`, 'i'))
  ).toBeVisible({ timeout: 10000 });
});
