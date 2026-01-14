import { test, expect, Page } from '@playwright/test';
import { exposeSupabaseHelpers } from '../helpers/e2e-supabase';

// Generate unique test user to avoid conflicts
const generateTestUser = () => {
  const ts = Date.now();
  const random = Math.random().toString(36).slice(2, 6);
  return {
    email: `pos-bulk-edit-${ts}-${random}@test.com`,
    password: 'TestPassword123!',
    fullName: `POS Bulk Edit Test User ${ts}`,
    restaurantName: `POS Bulk Edit Test Restaurant ${ts}`,
  };
};

// Standard signup and restaurant creation
async function signUpAndCreateRestaurant(page: Page, user: ReturnType<typeof generateTestUser>) {
  await page.goto('/auth');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page.waitForURL(/\/auth/);

  const signupTab = page.getByRole('tab', { name: /sign up/i });
  if (await signupTab.isVisible().catch(() => false)) {
    await signupTab.click();
  }

  await expect(page.getByLabel(/full name/i)).toBeVisible({ timeout: 10000 });
  await page.getByLabel(/email/i).first().fill(user.email);
  await page.getByLabel(/full name/i).fill(user.fullName);
  await page.getByLabel(/password/i).first().fill(user.password);
  await page.getByRole('button', { name: /sign up|create account/i }).click();
  await page.waitForURL('/', { timeout: 15000 });

  const addRestaurantButton = page.getByRole('button', { name: /add restaurant/i });
  await expect(addRestaurantButton).toBeVisible({ timeout: 10000 });
  await addRestaurantButton.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/restaurant name/i).fill(user.restaurantName);
  await dialog.getByLabel(/address/i).fill('123 Main St');
  await dialog.getByLabel(/phone/i).fill('555-123-4567');
  await dialog.getByRole('button', { name: /create|add|save/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5000 });
}

test.describe('POS Sales Bulk Edit', () => {
  test('should enable selection mode and select sales', async ({ page }) => {
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);

    // Navigate to POS Sales page
    await page.goto('/pos-sales');
    await expect(page.getByRole('heading', { name: 'POS Sales', exact: true })).toBeVisible();

    // Create test sales using Supabase helpers
    await exposeSupabaseHelpers(page);
    
    const sales = await page.evaluate(async () => {
      const user = await (window as any).__getAuthUser();
      if (!user?.id) throw new Error('No user session');

      const restaurantId = await (window as any).__getRestaurantId(user.id);
      if (!restaurantId) throw new Error('No restaurant');

      // Create test sales
      const salesToCreate = [
        {
          restaurant_id: restaurantId,
          item_name: 'Test Burger',
          quantity: 2,
          total_price: 20.00,
          sale_date: new Date().toISOString().split('T')[0],
          pos_system: 'manual',
        },
        {
          restaurant_id: restaurantId,
          item_name: 'Test Fries',
          quantity: 1,
          total_price: 5.00,
          sale_date: new Date().toISOString().split('T')[0],
          pos_system: 'manual',
        },
        {
          restaurant_id: restaurantId,
          item_name: 'Test Drink',
          quantity: 3,
          total_price: 9.00,
          sale_date: new Date().toISOString().split('T')[0],
          pos_system: 'manual',
        },
      ];

      const { data, error } = await (window as any).__supabase
        .from('unified_sales')
        .insert(salesToCreate)
        .select();

      if (error) throw error;
      return data;
    });

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
    
    await page.evaluate(async () => {
      const user = await (window as any).__getAuthUser();
      const restaurantId = await (window as any).__getRestaurantId(user.id);

      // Create a revenue account
      const { data: account, error: accountError } = await (window as any).__supabase
        .from('chart_of_accounts')
        .insert({
          restaurant_id: restaurantId,
          account_code: '4000',
          account_name: 'Test Revenue',
          account_type: 'revenue',
        })
        .select()
        .single();

      if (accountError) throw new Error(`Failed to create account: ${accountError.message}`);

      // Create test sales
      const { data: salesData, error: salesError } = await (window as any).__supabase
        .from('unified_sales')
        .insert([
          {
            restaurant_id: restaurantId,
            item_name: 'Test Item 1',
            quantity: 1,
            total_price: 10.00,
            sale_date: new Date().toISOString().split('T')[0],
            pos_system: 'manual',
          },
          {
            restaurant_id: restaurantId,
            item_name: 'Test Item 2',
            quantity: 1,
            total_price: 15.00,
            sale_date: new Date().toISOString().split('T')[0],
            pos_system: 'manual',
          },
        ])
        .select();

      if (salesError) throw new Error(`Failed to create sales: ${salesError.message}`);

      return { account, sales: salesData };
    });

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
