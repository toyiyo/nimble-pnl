import { test, expect, Page } from '@playwright/test';
import { exposeSupabaseHelpers } from '../helpers/e2e-supabase';

// Generate unique test user to avoid conflicts
const generateTestUser = () => {
  const ts = Date.now();
  const random = Math.random().toString(36).slice(2, 6);
  return {
    email: `bulk-edit-${ts}-${random}@test.com`,
    password: 'TestPassword123!',
    fullName: `Bulk Edit Test User ${ts}`,
    restaurantName: `Bulk Edit Test Restaurant ${ts}`,
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

test.describe('Bank Transactions Bulk Edit', () => {
  test('should enable selection mode and select transactions', async ({ page }) => {
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);

    // Navigate to Banking page
    await page.goto('/banking');
    await expect(page.getByRole('heading', { name: /banking/i })).toBeVisible();

    // Create test transactions using Supabase helpers
    await exposeSupabaseHelpers(page);
    
    const transactions = await page.evaluate(async () => {
      const user = await (window as any).__getAuthUser();
      if (!user?.id) throw new Error('No user session');

      const restaurantId = await (window as any).__getRestaurantId(user.id);
      if (!restaurantId) throw new Error('No restaurant');

      // Create a connected bank first
      const stripeAccountId = `test-bank-${crypto.randomUUID()}`;
      const { data: bank, error: bankError } = await (window as any).__supabase
        .from('connected_banks')
        .insert({
          restaurant_id: restaurantId,
          stripe_financial_account_id: stripeAccountId,
          institution_name: 'Test Bank',
          status: 'connected',
        })
        .select()
        .single();

      if (bankError) throw bankError;

      // Create test transactions
      const txns = [
        {
          restaurant_id: restaurantId,
          connected_bank_id: bank.id,
          stripe_transaction_id: `test-txn-${crypto.randomUUID()}`,
          description: 'Test Transaction 1',
          amount: -100.00,
          transaction_date: new Date().toISOString().split('T')[0],
          is_categorized: false,
        },
        {
          restaurant_id: restaurantId,
          connected_bank_id: bank.id,
          stripe_transaction_id: `test-txn-${crypto.randomUUID()}`,
          description: 'Test Transaction 2',
          amount: -50.00,
          transaction_date: new Date().toISOString().split('T')[0],
          is_categorized: false,
        },
        {
          restaurant_id: restaurantId,
          connected_bank_id: bank.id,
          stripe_transaction_id: `test-txn-${crypto.randomUUID()}`,
          description: 'Test Transaction 3',
          amount: -75.00,
          transaction_date: new Date().toISOString().split('T')[0],
          is_categorized: false,
        },
      ];

      const { data, error } = await (window as any).__supabase
        .from('bank_transactions')
        .insert(txns)
        .select();

      if (error) throw error;
      return data;
    });

    expect(transactions).toHaveLength(3);

    // Reload page to see transactions
    await page.reload();
    await expect(page.getByRole('heading', { name: /banking/i })).toBeVisible();

    // Wait for transactions to load
    await page.waitForTimeout(2000);

    // Click "Select" button to enter selection mode
    const selectButton = page.getByRole('button', { name: /^select$/i });
    await expect(selectButton).toBeVisible({ timeout: 10000 });
    await selectButton.click();

    // Verify selection mode is active (button changes to "Done")
    await expect(page.getByRole('button', { name: /^done$/i })).toBeVisible();

    // Verify checkboxes appear
    const checkboxes = page.getByRole('checkbox').filter({ hasText: '' });
    const checkboxCount = await checkboxes.count();
    expect(checkboxCount).toBeGreaterThan(0);

    // Select first transaction by clicking checkbox
    await checkboxes.first().click();

    // Verify bulk action bar appears
    await expect(page.getByText(/1 selected/i)).toBeVisible({ timeout: 5000 });

    // Select second transaction
    await checkboxes.nth(1).click();

    // Verify count updates
    await expect(page.getByText(/2 selected/i)).toBeVisible();

    // Test bulk categorize action
    const categorizeButton = page.getByRole('button', { name: /categorize/i }).last();
    await categorizeButton.click();

    // Verify side panel opens
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/categorize.*transaction/i)).toBeVisible();

    // Close panel
    const closeButton = page.getByRole('button', { name: /cancel|close/i }).last();
    await closeButton.click();

    // Exit selection mode
    await page.getByRole('button', { name: /^done$/i }).click();

    // Verify selection mode is exited
    await expect(page.getByRole('button', { name: /^select$/i })).toBeVisible();
    await expect(page.getByText(/selected/i)).not.toBeVisible();
  });

  test('should support range selection with shift+click', async ({ page }) => {
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);

    // Navigate to Banking page
    await page.goto('/banking');
    
    // Create test transactions
    await exposeSupabaseHelpers(page);
    
    await page.evaluate(async () => {
      const user = await (window as any).__getAuthUser();
      const restaurantId = await (window as any).__getRestaurantId(user.id);

      const stripeAccountId = `test-bank-${crypto.randomUUID()}`;
      const { data: bank, error: bankError } = await (window as any).__supabase
        .from('connected_banks')
        .insert({
          restaurant_id: restaurantId,
          stripe_financial_account_id: stripeAccountId,
          institution_name: 'Test Bank',
          status: 'connected',
        })
        .select()
        .single();
      if (bankError) throw bankError;

      const txns = Array.from({ length: 5 }, (_, i) => ({
        restaurant_id: restaurantId,
        connected_bank_id: bank.id,
        stripe_transaction_id: `test-txn-${crypto.randomUUID()}`,
        description: `Transaction ${i + 1}`,
        amount: -100.00,
        transaction_date: new Date().toISOString().split('T')[0],
        is_categorized: false,
      }));

      const { error } = await (window as any).__supabase
        .from('bank_transactions')
        .insert(txns);
      if (error) throw error;
    });

    await page.reload();
    await page.waitForTimeout(2000);

    // Enter selection mode
    await page.getByRole('button', { name: /^select$/i }).click();

    // Click first transaction
    const rows = page.locator('[data-testid="bank-transaction-row"]');
    await rows.first().click();
    await expect(page.getByText(/1 selected/i)).toBeVisible();

    // Shift+click third transaction to select range
    await rows.nth(2).click({ modifiers: ['Shift'] });
    
    // Should have selected 3 transactions (first, second, third)
    await expect(page.getByText(/3 selected/i)).toBeVisible({ timeout: 5000 });
  });
});
