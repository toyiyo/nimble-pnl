import { test, expect, Page } from '@playwright/test';
import { exposeSupabaseHelpers } from '../helpers/e2e-supabase';

type TestUser = {
  email: string;
  password: string;
  fullName: string;
  restaurantName: string;
};

type RestaurantIdGetter = () => Promise<string | null> | string | null;

type WindowWithRestaurantHelper = Window & {
  __getRestaurantId?: RestaurantIdGetter;
};

type RawTransactionData = {
  account: string;
  description: string;
  amount: number;
};

const getRestaurantId = (page: Page) =>
  page.evaluate<string | null>(async () => {
    const helperWindow = window as WindowWithRestaurantHelper;
    const fn = helperWindow.__getRestaurantId;
    return fn ? await fn() : null;
  });

const generateUser = (): TestUser => {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  return {
    email: `bank-tx-${ts}-${rand}@test.com`,
    password: 'TestPassword123!',
    fullName: `Bank Test ${rand}`,
    restaurantName: `Bank Test Resto ${rand}`,
  };
};

async function signUpAndCreateRestaurant(page: Page, user: TestUser) {
  await page.goto('/');
  await page.waitForURL(/\/(auth)?$/);

  // If on marketing page, navigate to auth
  if (page.url().endsWith('/')) {
    const signInLink = page.getByRole('link', { name: /sign in|log in|get started/i });
    if (await signInLink.isVisible().catch(() => false)) {
      await signInLink.click();
      await page.waitForURL('/auth');
    }
  }

  await page.getByRole('tab', { name: /sign up/i }).click();
  await page.getByLabel(/email/i).first().fill(user.email);
  await page.getByLabel(/full name/i).fill(user.fullName);
  await page.getByLabel(/password/i).first().fill(user.password);
  await page.getByRole('button', { name: /sign up|create account/i }).click();

  const addRestaurantButton = page.getByRole('button', { name: /add restaurant/i });
  await expect(addRestaurantButton).toBeVisible({ timeout: 40000 });
  await addRestaurantButton.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/restaurant name/i).fill(user.restaurantName);
  await dialog.getByLabel(/address/i).fill('123 Bank Test St');
  await dialog.getByLabel(/phone/i).fill('555-222-3333');
  await dialog.getByRole('button', { name: /create restaurant|add restaurant/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5000 });
}

test.describe('Bank Transaction Filtering', () => {
  test('filters transactions by bank account and displays correct account info', async ({ page }) => {
    const user = generateUser();

    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    // Get restaurant ID
    const restaurantId = await getRestaurantId(page);

    expect(restaurantId).toBeTruthy();

    // Seed test data: create connected bank, bank accounts, and transactions
    const { bankAccountIds } = await page.evaluate(async ({ rid }) => {
      const { supabase } = await import('/src/integrations/supabase/client');
      
      // Generate unique IDs to avoid constraint violations
      const timestamp = Date.now();
      const random = Math.random().toString(36).slice(2, 8);
      
      // Create connected bank
      const { data: connectedBank, error: bankError } = await supabase
        .from('connected_banks')
        .insert({
          restaurant_id: rid,
          institution_name: 'Test Bank',
          stripe_financial_account_id: `fca_test_${timestamp}_${random}`,
          status: 'connected',
        })
        .select()
        .single();

      if (bankError) throw new Error(`Failed to create bank: ${bankError.message}`);

      // Create two bank accounts with different Stripe account IDs
      const { data: accounts, error: accountsError } = await supabase
        .from('bank_account_balances')
        .insert([
          {
            connected_bank_id: connectedBank.id,
            stripe_financial_account_id: `fa_checking_${timestamp}_${random}`,
            account_name: 'Checking Account',
            account_type: 'checking',
            account_mask: '1234',
            current_balance: 10000,
            as_of_date: new Date().toISOString(),
          },
          {
            connected_bank_id: connectedBank.id,
            stripe_financial_account_id: `fa_savings_${timestamp}_${random}`,
            account_name: 'Savings Account',
            account_type: 'savings',
            account_mask: '5678',
            current_balance: 20000,
            as_of_date: new Date().toISOString(),
          }
        ])
        .select();

      if (accountsError) throw new Error(`Failed to create accounts: ${accountsError.message}`);

      const checkingAccountId = accounts![0].id;
      const savingsAccountId = accounts![1].id;

      // Create transactions for each account
      const now = new Date();
      const transactions = [
        // Checking account transactions
        {
          restaurant_id: rid,
          connected_bank_id: connectedBank.id,
          stripe_transaction_id: `txn_checking_1_${Date.now()}`,
          transaction_date: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
          description: 'Checking - Grocery Store',
          amount: -150.50,
          status: 'posted',
          raw_data: {
            account: `fa_checking_${timestamp}_${random}`,
            description: 'Checking - Grocery Store',
            amount: -15050,
          } as RawTransactionData,
        },
        {
          restaurant_id: rid,
          connected_bank_id: connectedBank.id,
          stripe_transaction_id: `txn_checking_2_${Date.now()}`,
          transaction_date: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
          description: 'Checking - Restaurant Supply',
          amount: -500.00,
          status: 'posted',
          raw_data: {
            account: `fa_checking_${timestamp}_${random}`,
            description: 'Checking - Restaurant Supply',
            amount: -50000,
          } as RawTransactionData,
        },
        // Savings account transactions
        {
          restaurant_id: rid,
          connected_bank_id: connectedBank.id,
          stripe_transaction_id: `txn_savings_1_${Date.now()}`,
          transaction_date: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
          description: 'Savings - Interest Payment',
          amount: 25.00,
          status: 'posted',
          raw_data: {
            account: `fa_savings_${timestamp}_${random}`,
            description: 'Savings - Interest Payment',
            amount: 2500,
          } as RawTransactionData,
        },
        {
          restaurant_id: rid,
          connected_bank_id: connectedBank.id,
          stripe_transaction_id: `txn_savings_2_${Date.now()}`,
          transaction_date: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString(), // 4 days ago
          description: 'Savings - Transfer In',
          amount: 1000.00,
          status: 'posted',
          raw_data: {
            account: `fa_savings_${timestamp}_${random}`,
            description: 'Savings - Transfer In',
            amount: 100000,
          } as RawTransactionData,
        },
      ];

      const { error: txError } = await supabase
        .from('bank_transactions')
        .insert(transactions);

      if (txError) throw new Error(`Failed to create transactions: ${txError.message}`);

      return {
        bankAccountIds: {
          checking: checkingAccountId,
          savings: savingsAccountId,
        },
      };
    }, { rid: restaurantId });

    // Navigate to bank transactions page
    await page.goto('/banking');
    
    // Wait for transactions to load
    await page.waitForSelector('[data-testid="bank-transaction-row"], .empty-state', { timeout: 10000 });

    // Verify all 4 transactions are initially visible (no filter)
    const allRows = page.locator('[data-testid="bank-transaction-row"]');
    await expect(allRows).toHaveCount(4, { timeout: 5000 });

    // Open filters sheet
    const filterButton = page.getByRole('button', { name: /filter/i });
    await expect(filterButton).toBeVisible();
    await filterButton.click();

    // Wait for sheet to open
    const filterSheet = page.locator('[role="dialog"]');
    await expect(filterSheet).toBeVisible();

    // Click the Bank Account select trigger (it's a button in shadcn Select)
    const bankAccountSelect = filterSheet.locator('button:has-text("All accounts")').or(filterSheet.getByRole('button', { name: /all accounts/i }));
    await bankAccountSelect.click();

    // Select Checking Account from dropdown
    const checkingOption = page.getByRole('option').filter({ hasText: /1234/ });
    await expect(checkingOption).toBeVisible({ timeout: 5000 });
    await checkingOption.click();

    // Apply filters
    await filterSheet.getByRole('button', { name: /apply filters/i }).click();

    // Wait for filter to apply and transactions to reload
    await page.waitForTimeout(1000);

    // Verify only 2 checking transactions are visible
    const filteredRows = page.locator('[data-testid="bank-transaction-row"]');
    await expect(filteredRows).toHaveCount(2, { timeout: 5000 });

    // Verify checking transactions are displayed
    await expect(page.getByText('Checking - Grocery Store')).toBeVisible();
    await expect(page.getByText('Checking - Restaurant Supply')).toBeVisible();

    // Verify savings transactions are NOT displayed
    await expect(page.getByText('Savings - Interest Payment')).not.toBeVisible();
    await expect(page.getByText('Savings - Transfer In')).not.toBeVisible();

    // Verify correct account info is displayed in transaction rows
    const firstRow = filteredRows.first();
    await expect(firstRow.getByText(/1234/)).toBeVisible(); // Account mask
    await expect(firstRow.getByText(/Checking|checking/i)).toBeVisible();

    // Change to Savings Account filter
    await filterButton.click();
    await expect(filterSheet).toBeVisible();
    const bankAccountSelect2 = filterSheet.locator('button').filter({ hasText: /1234/ }); // Now showing selected account
    await bankAccountSelect2.click();
    const savingsOption = page.getByRole('option').filter({ hasText: /5678/ });
    await expect(savingsOption).toBeVisible();
    await savingsOption.click();
    await filterSheet.getByRole('button', { name: /apply filters/i }).click();

    // Wait for filter to apply
    await page.waitForTimeout(1000);

    // Verify only 2 savings transactions are visible
    await expect(filteredRows).toHaveCount(2, { timeout: 5000 });

    // Verify savings transactions are displayed
    await expect(page.getByText('Savings - Interest Payment')).toBeVisible();
    await expect(page.getByText('Savings - Transfer In')).toBeVisible();

    // Verify checking transactions are NOT displayed
    await expect(page.getByText('Checking - Grocery Store')).not.toBeVisible();
    await expect(page.getByText('Checking - Restaurant Supply')).not.toBeVisible();

    // Verify correct account info in savings transactions
    const savingsRow = filteredRows.first();
    await expect(savingsRow.getByText(/5678/)).toBeVisible(); // Account mask
    await expect(savingsRow.getByText(/Savings|savings/i)).toBeVisible();

    // Clear filter by clicking Clear All Filters
    await filterButton.click();
    await expect(filterSheet).toBeVisible();
    await filterSheet.getByRole('button', { name: /clear all filters/i }).click();

    // Wait for filter to clear
    await page.waitForTimeout(1000);

    // Verify all 4 transactions are visible again
    await expect(allRows).toHaveCount(4, { timeout: 5000 });
  });

  test('handles query builder chain correctly without runtime errors', async ({ page }) => {
    const user = generateUser();

    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    const restaurantId = await getRestaurantId(page);

    expect(restaurantId).toBeTruthy();

    // Create minimal test data
    await page.evaluate(async ({ rid }) => {
      const { supabase } = await import('/src/integrations/supabase/client');
      
      // Generate unique IDs to avoid constraint violations
      const timestamp = Date.now();
      const random = Math.random().toString(36).slice(2, 8);
      
      const { data: connectedBank, error: bankError } = await supabase
        .from('connected_banks')
        .insert({
          restaurant_id: rid,
          institution_name: 'Query Test Bank',
          stripe_financial_account_id: `fca_query_test_${timestamp}_${random}`,
          status: 'connected',
        })
        .select()
        .single();

      if (bankError || !connectedBank) throw new Error(`Failed to create bank: ${bankError?.message || 'No data returned'}`);

      const { data: account, error: accountError } = await supabase
        .from('bank_account_balances')
        .insert({
          connected_bank_id: connectedBank.id,
          stripe_financial_account_id: `fa_query_test_${timestamp}_${random}`,
          account_name: 'Test Account',
          account_type: 'checking',
          account_mask: '9999',
          current_balance: 5000,
          as_of_date: new Date().toISOString(),
        })
        .select()
        .single();

      if (accountError || !account) throw new Error(`Failed to create account: ${accountError?.message || 'No data returned'}`);

      const { error: txError } = await supabase
        .from('bank_transactions')
        .insert({
          restaurant_id: rid,
          connected_bank_id: connectedBank.id,
          stripe_transaction_id: `txn_query_test_${timestamp}_${random}`,
          transaction_date: new Date().toISOString(),
          description: 'Query Test Transaction',
          amount: -100.00,
          status: 'posted',
          raw_data: {
            account: `fa_query_test_${timestamp}_${random}`,
            description: 'Query Test Transaction',
            amount: -10000,
          } as RawTransactionData,
        });

      if (txError) throw new Error(`Failed to create transaction: ${txError.message}`);

      return { accountId: account.id };
    }, { rid: restaurantId });

    // Navigate to transactions page
    await page.goto('/banking');
    
    // Wait for transactions to load
    await page.waitForSelector('[data-testid="bank-transaction-row"], .empty-state', { timeout: 10000 });

    // Listen for console errors (especially "query.order is not a function")
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Listen for page errors (ignore Stripe network errors)
    const pageErrors: Error[] = [];
    page.on('pageerror', error => {
      if (!error.message.includes('stripe.com') && !error.message.includes('stripe.network')) {
        pageErrors.push(error);
      }
    });

    // Apply bank account filter (this triggers the query builder chain)
    const filterButton = page.getByRole('button', { name: /filter/i });
    await filterButton.click();
    
    const filterSheet = page.locator('[role="dialog"]');
    await expect(filterSheet).toBeVisible();
    
    const bankAccountSelect = filterSheet.locator('button:has-text("All accounts")').or(filterSheet.getByRole('button', { name: /all accounts/i }));
    await bankAccountSelect.click();
    const accountOption = page.getByRole('option').filter({ hasText: /9999/ });
    await accountOption.click();
    await filterSheet.getByRole('button', { name: /apply filters/i }).click();

    // Wait for query to execute
    await page.waitForTimeout(2000);

    // Verify no "query.order is not a function" errors occurred
    const orderErrors = consoleErrors.filter(err => err.includes('.order is not a function'));
    expect(orderErrors, 'No query builder type errors should occur').toHaveLength(0);

    // Verify no page errors occurred
    expect(pageErrors, 'No page errors should occur').toHaveLength(0);

    // Verify transaction is still displayed (query worked correctly)
    await expect(page.getByText('Query Test Transaction')).toBeVisible();
  });

  test('displays empty state when filter excludes all transactions', async ({ page }) => {
    const user = generateUser();

    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    const restaurantId = await getRestaurantId(page);

    expect(restaurantId).toBeTruthy();

    // Create account with no transactions
    await page.evaluate(async ({ rid }) => {
      const { supabase } = await import('/src/integrations/supabase/client');
      
      // Generate unique IDs to avoid constraint violations
      const timestamp = Date.now();
      const random = Math.random().toString(36).slice(2, 8);
      
      const { data: connectedBank, error: bankError } = await supabase
        .from('connected_banks')
        .insert({
          restaurant_id: rid,
          institution_name: 'Empty Test Bank',
          stripe_financial_account_id: `fca_empty_test_${timestamp}_${random}`,
          status: 'connected',
        })
        .select()
        .single();

      if (bankError || !connectedBank) throw new Error(`Failed to create bank: ${bankError?.message || 'No data returned'}`);

      const { error: accountError } = await supabase
        .from('bank_account_balances')
        .insert({
          connected_bank_id: connectedBank.id,
          stripe_financial_account_id: `fa_empty_test_${timestamp}_${random}`,
          account_name: 'Empty Account',
          account_type: 'checking',
          account_mask: '0000',
          current_balance: 0,
          as_of_date: new Date().toISOString(),
        });

      if (accountError) throw new Error(`Failed to create account: ${accountError.message}`);
    }, { rid: restaurantId });

    await page.goto('/banking');
    
    // Apply filter to empty account
    const filterButton = page.getByRole('button', { name: /filter/i });
    await filterButton.click();
    
    const filterSheet = page.locator('[role="dialog"]');
    await expect(filterSheet).toBeVisible();
    
    const bankAccountSelect = filterSheet.locator('button:has-text("All accounts")').or(filterSheet.getByRole('button', { name: /all accounts/i }));
    await bankAccountSelect.click();
    const emptyOption = page.getByRole('option').filter({ hasText: /0000/ });
    await emptyOption.click();
    await filterSheet.getByRole('button', { name: /apply filters/i }).click();

    await page.waitForTimeout(1000);

    // Verify empty state is displayed
    await expect(page.getByText(/no transactions match your filters/i)).toBeVisible({ timeout: 5000 });
  });
});
