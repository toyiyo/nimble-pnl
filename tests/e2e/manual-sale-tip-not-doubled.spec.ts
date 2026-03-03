import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser, exposeSupabaseHelpers } from '../helpers/e2e-supabase';

/**
 * E2E Test: Manual Sale Tip Not Doubled
 *
 * Verifies that when a user records a manual sale with a tip via the UI,
 * the tip is NOT counted as revenue. The bug: createManualSaleWithAdjustments
 * sets adjustment_type='tip' but not item_type='tip', so the row defaults to
 * item_type='sale' and SQL functions count it as revenue.
 *
 * Expected behavior after fix:
 * - Sale: $50 (revenue), item_type='sale'
 * - Tip: $10 (pass-through), item_type='tip', adjustment_type='tip'
 * - Tax: $4 (pass-through), item_type='tax', adjustment_type='tax'
 * - POS Sales page: Revenue=$50, Pass-Through=$14
 * - Monthly dashboard: Gross Revenue=$50
 */

/** Helper to fill the manual sale form and submit */
async function recordManualSale(
  page: import('@playwright/test').Page,
  opts: { itemName: string; totalPrice: string; tip: string; tax: string }
) {
  // Open the "Add Sale" dialog
  await page.getByRole('button', { name: /add sale/i }).click();
  const dialog = page.getByRole('dialog', { name: /record manual sale/i });
  await expect(dialog).toBeVisible({ timeout: 5000 });

  // Fill in the item name — click the combobox, type, create new item
  await dialog.getByRole('combobox').click();
  // The search input inside the command popover (use .last() to get the one in the dialog)
  await page.getByPlaceholder('Search items...').last().fill(opts.itemName);
  // Select "Create new" option from the command palette
  await page.getByRole('option', { name: new RegExp(`create new.*${opts.itemName}`, 'i') }).click({ timeout: 5000 });

  // Fill in Total Price
  await dialog.getByLabel(/total price/i).fill(opts.totalPrice);

  // Fill in Tip
  await dialog.getByLabel(/^tip$/i).fill(opts.tip);

  // Fill in Sales Tax
  await dialog.getByLabel(/sales tax/i).fill(opts.tax);

  // The dialog extends beyond viewport; click submit via JS evaluate
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button[type="submit"]'));
    const recordBtn = btns.find(b => b.textContent?.includes('Record Sale'));
    if (recordBtn) (recordBtn as HTMLButtonElement).click();
  });

  // Wait for dialog to close (sale recorded successfully)
  await expect(dialog).not.toBeVisible({ timeout: 10000 });
}

test.describe('Manual Sale Tip Not Doubled', () => {
  test('tip entered via Record Manual Sale should not inflate revenue', async ({ page }) => {
    const user = generateTestUser('tip-nodbl');
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    // Navigate to POS Sales page
    await page.goto('/pos-sales');
    await expect(page.getByRole('heading', { name: /^sales$/i })).toBeVisible({ timeout: 15000 });

    // Record a manual sale: $50 revenue + $10 tip + $4 tax
    await recordManualSale(page, {
      itemName: 'Test Burger',
      totalPrice: '50',
      tip: '10',
      tax: '4',
    });

    // Reload to ensure fresh data from server
    await page.reload();
    await expect(page.getByRole('heading', { name: /^sales$/i })).toBeVisible({ timeout: 15000 });

    // Wait for data to fully load (3 items should be present)
    await expect(page.getByText(/3 sales/)).toBeVisible({ timeout: 10000 });

    // Verify POS Sales dashboard metrics
    // Revenue should be $50 (just the sale item), NOT $0 (bug) or $64 (all items)
    // The dashboard shows: COLLECTED $X  REVENUE $X  DISCOUNTS $X  PASS-THROUGH $X
    await expect(page.getByText('REVENUE').first()).toBeVisible();
    // Bug: Currently shows $0.00 because item_type is null on the sale row.
    // After fix: should show $50.00
    const revenueSibling = page.locator('text=REVENUE').first().locator('xpath=following-sibling::*[1]');
    await expect(revenueSibling).toHaveText('$50.00', { timeout: 10000 });
  });

  test('verify adjustment rows have correct item_type in database', async ({ page }) => {
    const user = generateTestUser('tip-itemtype');
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    // Navigate to POS Sales and add a manual sale with tip
    await page.goto('/pos-sales');
    await expect(page.getByRole('heading', { name: /^sales$/i })).toBeVisible({ timeout: 15000 });

    // Record a manual sale: $100 revenue + $20 tip + $8 tax
    await recordManualSale(page, {
      itemName: 'DB Check Burger',
      totalPrice: '100',
      tip: '20',
      tax: '8',
    });

    // Wait for data to be inserted
    await page.waitForTimeout(1000);

    // Query the database to verify item_type is set correctly on adjustment rows
    const results = await page.evaluate(async () => {
      const supabase = (window as any).__supabase;
      const restaurantId = await (window as any).__getRestaurantId();

      const { data, error } = await supabase
        .from('unified_sales')
        .select('item_name, item_type, adjustment_type, total_price')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: true });

      if (error) throw new Error(error.message);
      return data;
    });

    expect(results.length).toBe(3); // 1 sale + 1 tip + 1 tax

    // Verify the sale row has item_type='sale'
    const saleRow = results.find((r: any) => r.item_name === 'DB Check Burger');
    expect(saleRow).toBeTruthy();
    expect(saleRow.item_type).toBe('sale'); // Bug: currently null
    expect(saleRow.adjustment_type).toBeNull();
    expect(Number(saleRow.total_price)).toBe(100);

    // Verify the tip row has item_type='tip', NOT default 'sale'
    const tipRow = results.find((r: any) => r.adjustment_type === 'tip');
    expect(tipRow).toBeTruthy();
    expect(tipRow.item_type).toBe('tip'); // Bug: currently null (or 'sale' default)
    expect(Number(tipRow.total_price)).toBe(20);

    // Verify the tax row has item_type='tax', NOT default 'sale'
    const taxRow = results.find((r: any) => r.adjustment_type === 'tax');
    expect(taxRow).toBeTruthy();
    expect(taxRow.item_type).toBe('tax'); // Bug: currently null (or 'sale' default)
    expect(Number(taxRow.total_price)).toBe(8);
  });
});
