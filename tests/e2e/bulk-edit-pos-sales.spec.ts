import { test, expect } from '@playwright/test';
import { exposeSupabaseHelpers, generateTestUser, signUpAndCreateRestaurant } from '../helpers/e2e-supabase';
import { daysAgo } from '../helpers/dateUtils';

test.describe('POS Sales Bulk Edit', () => {
  test('should enable selection mode and select sales', async ({ page }) => {
    const user = generateTestUser('pos-bulk-edit');
    await signUpAndCreateRestaurant(page, user);

    // Navigate to POS Sales page
    await page.goto('/pos-sales');
    await expect(page.getByRole('heading', { name: 'POS Sales', exact: true })).toBeVisible();

    // Create test sales using Supabase helpers
    await exposeSupabaseHelpers(page);

    // Calculate dates in Node.js context before passing to browser
    const saleDates = [daysAgo(5), daysAgo(3), daysAgo(2)];

    const sales = await page.evaluate(async (dates) => {
      const user = await (window as any).__getAuthUser();
      if (!user?.id) throw new Error('No user session');

      const restaurantId = await (window as any).__getRestaurantId(user.id);
      if (!restaurantId) throw new Error('No restaurant');

      const salesToCreate = [
        {
          restaurant_id: restaurantId,
          external_order_id: `bulk-pos-${crypto.randomUUID()}`,
          item_name: 'Test Burger',
          quantity: 2,
          total_price: 20,
          sale_date: dates[0],
          pos_system: 'manual',
        },
        {
          restaurant_id: restaurantId,
          external_order_id: `bulk-pos-${crypto.randomUUID()}`,
          item_name: 'Test Fries',
          quantity: 1,
          total_price: 5,
          sale_date: dates[1],
          pos_system: 'manual',
        },
        {
          restaurant_id: restaurantId,
          external_order_id: `bulk-pos-${crypto.randomUUID()}`,
          item_name: 'Test Drink',
          quantity: 3,
          total_price: 9,
          sale_date: dates[2],
          pos_system: 'manual',
        },
      ];

      const { data, error } = await (window as any).__supabase
        .from('unified_sales')
        .insert(salesToCreate)
        .select();

      if (error) throw new Error(error.message);
      return data;
    }, saleDates);

    expect(sales).toHaveLength(3);

    // Reload page to see sales
    await page.reload();
    await expect(page.getByRole('heading', { name: 'POS Sales', exact: true })).toBeVisible();

    // Wait for sales to load - look for the first sale item
    await expect(page.getByText('Test Burger')).toBeVisible({ timeout: 10000 });

    // Click "Select" button to enter selection mode
    const selectButton = page.getByRole('button', { name: /^select$/i });
    await expect(selectButton).toBeVisible({ timeout: 10000 });
    await selectButton.click();

    // Verify selection mode is active (button changes to "Done")
    await expect(page.getByRole('button', { name: /^done$/i })).toBeVisible();

    // Verify checkboxes appear in sale cards
    const checkboxes = page.getByRole('checkbox', { name: /select/i });
    const checkboxCount = await checkboxes.count();
    expect(checkboxCount).toBeGreaterThan(0);

    // Select first sale by clicking checkbox
    await checkboxes.first().click();

    // Verify bulk action bar appears
    await expect(page.getByText(/1 selected/i)).toBeVisible({ timeout: 5000 });

    // Select second sale
    await checkboxes.nth(1).click();

    // Verify count updates
    await expect(page.getByText(/2 selected/i)).toBeVisible();

    // Test bulk categorize action
    const categorizeButton = page.getByRole('button', { name: /categorize/i }).last();
    await categorizeButton.click();

    // Verify side panel opens
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('heading', { name: /categorize.*sale/i })).toBeVisible();

    // Close panel
    const closeButton = page.getByRole('button', { name: /cancel|close/i }).last();
    await closeButton.click();

    // Exit selection mode
    await page.getByRole('button', { name: /^done$/i }).click();

    // Verify selection mode is exited
    await expect(page.getByRole('button', { name: /^select$/i })).toBeVisible();
    await expect(page.getByText(/selected/i)).not.toBeVisible();
  });

  test('should handle bulk categorization', async ({ page }) => {
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);

    // Navigate to POS Sales page
    await page.goto('/pos-sales');
    
    // Create test sales and a revenue account
    await exposeSupabaseHelpers(page);

    // Calculate dates in Node.js context before passing to browser
    const saleDates = [daysAgo(2), daysAgo(1)];

    await page.evaluate(async (dates) => {
      const user = await (window as any).__getAuthUser();
      const restaurantId = await (window as any).__getRestaurantId(user.id);

      // Create a revenue account
      const { data: account, error: accountError } = await (window as any).__supabase
        .from('chart_of_accounts')
        .upsert({
          restaurant_id: restaurantId,
          account_code: '4000',
          account_name: 'Test Revenue',
          account_type: 'revenue',
          account_subtype: 'food_sales',
          normal_balance: 'credit',
        }, { onConflict: 'restaurant_id,account_code' })
        .select()
        .single();

      if (accountError) throw new Error(`Failed to create account: ${accountError.message}`);

      // Create test sales
      const { data: salesData, error: salesError } = await (window as any).__supabase
        .from('unified_sales')
        .insert([
          {
            restaurant_id: restaurantId,
            external_order_id: `bulk-pos-${crypto.randomUUID()}`,
            item_name: 'Test Item 1',
            quantity: 1,
            total_price: 10.00,
            sale_date: dates[0],
            pos_system: 'manual',
          },
          {
            restaurant_id: restaurantId,
            external_order_id: `bulk-pos-${crypto.randomUUID()}`,
            item_name: 'Test Item 2',
            quantity: 1,
            total_price: 15.00,
            sale_date: dates[1],
            pos_system: 'manual',
          },
        ])
        .select();

      if (salesError) throw new Error(`Failed to create sales: ${salesError.message}`);

      return { account, sales: salesData };
    }, saleDates);

    await page.reload();
    
    // Wait for sales to load by checking for a sale item
    await expect(page.getByText('Test Item 1')).toBeVisible({ timeout: 10000 });

    // Enter selection mode and select both sales
    await page.getByRole('button', { name: /^select$/i }).click();
    await expect(page.getByRole('button', { name: /^done$/i })).toBeVisible();

    const checkboxes = page.getByRole('checkbox', { name: /select/i });
    await checkboxes.first().click();
    await checkboxes.nth(1).click();

    await expect(page.getByText(/2 selected/i)).toBeVisible();

    // Open bulk categorize panel
    await page.getByRole('button', { name: /categorize/i }).last().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // The actual category selection would require more complex interactions
    // with the SearchableAccountSelector component, which is tested separately
    // For now, just verify the panel opens and closes correctly

    await page.getByRole('button', { name: /cancel/i }).last().click();
    await expect(page.getByRole('dialog')).not.toBeVisible();

    // Exit selection mode
    await page.getByRole('button', { name: /^done$/i }).click();
  });
});
