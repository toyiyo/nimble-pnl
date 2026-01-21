/**
 * E2E test helpers for Supabase operations
 * These functions run in Node.js context and can be exposed to browser via page.exposeFunction()
 */

import type { Page } from '@playwright/test';

/**
 * Expose Supabase helper functions to browser context
 * This avoids dynamic imports from /src/ which Vite doesn't serve
 */
export async function exposeSupabaseHelpers(page: Page) {
  // Inject helpers into the browser so they share the same Supabase client/session as the app
  const injectHelpers = async () => {
    if ((window as any).__supabaseHelpersReady) return;

    const { supabase } = await import('/src/integrations/supabase/client');
    (window as any).__supabase = supabase;

    const waitForUser = async (): Promise<{ id: string } | null> => {
      for (let i = 0; i < 50; i++) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) return user;
        await new Promise(res => setTimeout(res, 300));
      }
      return null;
    };

    (window as any).__getAuthUser = waitForUser;

    (window as any).__getRestaurantId = async (userId?: string): Promise<string | null> => {
      const user = userId ? { id: userId } : await waitForUser();
      if (!user?.id) return null;

      for (let i = 0; i < 50; i++) {
        const { data, error } = await supabase
          .from('user_restaurants')
          .select('restaurant_id')
          .eq('user_id', user.id)
          .limit(1)
          .single();

        if (data?.restaurant_id) {
          return data.restaurant_id;
        }

        if (error && !error.message?.includes('No rows')) {
          console.error('Failed to load restaurant for user', error);
          return null;
        }

        await new Promise(res => setTimeout(res, 300));
      }

      return null;
    };

    (window as any).__insertEmployees = async (employees: any[], restaurantId: string) => {
      const { data, error } = await supabase
        .from('employees')
        .insert(employees.map(emp => ({
          ...emp,
          restaurant_id: restaurantId,
        })))
        .select();

      if (error) {
        throw new Error(error.message);
      }
      return data;
    };

    (window as any).__insertTimePunches = async (punches: any[], restaurantId: string) => {
      const payload = punches.map(punch => ({
        id: crypto.randomUUID(),
        created_at: punch.created_at || punch.punch_time || new Date().toISOString(),
        updated_at: punch.updated_at || punch.punch_time || new Date().toISOString(),
        ...punch,
        restaurant_id: restaurantId,
      }));

      const { data, error } = await supabase
        .from('time_punches')
        .insert(payload)
        .select();

      if (error) {
        throw new Error(error.message);
      }

      return data;
    };

    (window as any).__checkApprovedSplits = async (restaurantId: string): Promise<boolean> => {
      const { count, error } = await supabase
        .from('tip_splits')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId)
        .eq('status', 'approved');

      if (error) {
        console.error('Error checking approved splits', error);
        return false;
      }

      return (count || 0) > 0;
    };

    (window as any).__insertDispute = async (dispute: any) => {
      const { error } = await supabase.from('tip_disputes').insert(dispute);
      if (error) {
        throw new Error(error.message);
      }
    };

    (window as any).__checkResolvedDisputes = async (restaurantId: string): Promise<boolean> => {
      const { count, error } = await supabase
        .from('tip_disputes')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId)
        .eq('status', 'resolved');

      if (error) {
        console.error('Error checking disputes', error);
        return false;
      }

      return (count || 0) > 0;
    };

    (window as any).__getApprovedTipAmounts = async (restaurantId?: string): Promise<number[]> => {
      const user = await waitForUser();
      if (!user?.id) return [];

      let restaurantIdToUse = restaurantId;
      if (!restaurantIdToUse) {
        const { data: ur } = await supabase
          .from('user_restaurants')
          .select('restaurant_id')
          .eq('user_id', user.id)
          .limit(1)
          .single();
        restaurantIdToUse = ur?.restaurant_id || undefined;
      }

      if (!restaurantIdToUse) return [];

      const { data: items, error } = await supabase
        .from('tip_split_items')
        .select('amount, tip_splits!inner(restaurant_id, status)')
        .eq('tip_splits.restaurant_id', restaurantIdToUse)
        .eq('tip_splits.status', 'approved')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching tip_split_items', error);
      }

      if (items?.length) {
        return items.map(i => i.amount);
      }

      // Fallback to legacy employee_tips table
      const { data: legacy } = await supabase
        .from('employee_tips')
        .select('amount')
        .eq('restaurant_id', restaurantIdToUse)
        .order('created_at', { ascending: false })
        .limit(10);

      return (legacy || []).map(l => l.amount);
    };

    (window as any).__seedIncomeStatement = async (opts: {
      restaurantId: string;
      saleDate?: string;
    }) => {
      const saleDate =
        opts.saleDate ||
        new Date().toISOString().slice(0, 10);

      const { restaurantId } = opts;

      // Upsert needed accounts
      const accounts = [
        {
          account_code: '1000',
          account_name: 'Cash',
          account_type: 'asset',
          account_subtype: 'cash',
          normal_balance: 'debit',
        },
        {
          account_code: '4000',
          account_name: 'Food Sales',
          account_type: 'revenue',
          account_subtype: 'food_sales',
          normal_balance: 'credit',
        },
        {
          account_code: '5000',
          account_name: 'Food COGS',
          account_type: 'cogs',
          account_subtype: 'cost_of_goods_sold',
          normal_balance: 'debit',
        },
        {
          account_code: '6000',
          account_name: 'Operating Expenses',
          account_type: 'expense',
          account_subtype: 'operating_expenses',
          normal_balance: 'debit',
        },
      ].map(acc => ({
        id: crypto.randomUUID(),
        restaurant_id: restaurantId,
        is_system_account: false,
        is_active: true,
        ...acc,
      }));

      // Use upsert to avoid duplicates on re-run
      const { data: insertedAccounts, error: accountError } = await supabase
        .from('chart_of_accounts')
        .upsert(accounts, { onConflict: 'restaurant_id,account_code' })
        .select();

      if (accountError) {
        throw new Error(`Account upsert failed: ${accountError.message}`);
      }

      const getId = (code: string) =>
        (insertedAccounts || []).find((a: any) => a.account_code === code)?.id;

      const cashId = getId('1000');
      const revenueId = getId('4000');
      const cogsId = getId('5000');
      const expenseId = getId('6000');

      // Validate that all required account IDs were found
      if (!cashId) {
        throw new Error('Cash account (1000) not found after upsert. Check chart_of_accounts setup.');
      }
      if (!revenueId) {
        throw new Error('Revenue account (4000) not found after upsert. Check chart_of_accounts setup.');
      }
      if (!cogsId) {
        throw new Error('COGS account (5000) not found after upsert. Check chart_of_accounts setup.');
      }
      if (!expenseId) {
        throw new Error('Expense account (6000) not found after upsert. Check chart_of_accounts setup.');
      }

      // Seed POS revenue + pass-through
      const { error: salesError } = await supabase.from('unified_sales').insert([
        {
          restaurant_id: restaurantId,
          pos_system: 'test',
          external_order_id: 'order-1',
          item_name: 'POS Food Sale',
          quantity: 1,
          total_price: 1200,
          sale_date: saleDate,
          item_type: 'sale',
          is_categorized: true,
          category_id: revenueId,
        },
        {
          restaurant_id: restaurantId,
          pos_system: 'test',
          external_order_id: 'order-2',
          item_name: 'Uncategorized Sale',
          quantity: 1,
          total_price: 300,
          sale_date: saleDate,
          item_type: 'sale',
          is_categorized: false,
        },
        {
          restaurant_id: restaurantId,
          pos_system: 'test',
          external_order_id: 'order-3',
          item_name: 'Sales Tax',
          quantity: 1,
          total_price: 50,
          sale_date: saleDate,
          adjustment_type: 'tax',
          is_categorized: true,
          category_id: null,
        },
        {
          restaurant_id: restaurantId,
          pos_system: 'test',
          external_order_id: 'order-4',
          item_name: 'Tips',
          quantity: 1,
          total_price: 20,
          sale_date: saleDate,
          adjustment_type: 'tip',
          is_categorized: true,
          category_id: null,
        },
        {
          restaurant_id: restaurantId,
          pos_system: 'test',
          external_order_id: 'order-5',
          item_name: 'Discounts',
          quantity: 1,
          total_price: -100,
          sale_date: saleDate,
          adjustment_type: 'discount',
          is_categorized: true,
          category_id: null,
        },
      ]);

      if (salesError) {
        throw new Error(`Sales seed failed: ${salesError.message}`);
      }

      // Helper to insert a balanced journal entry with lines
      const insertJE = async ({
        entryNumber,
        description,
        debitAccountId,
        debitAmount,
        creditAccountId,
        creditAmount,
      }: {
        entryNumber: string;
        description: string;
        debitAccountId: string;
        debitAmount: number;
        creditAccountId: string;
        creditAmount: number;
      }) => {
        const { data: je, error: jeError } = await supabase
          .from('journal_entries')
          .insert({
            restaurant_id: restaurantId,
            entry_number: entryNumber,
            entry_date: saleDate,
            description,
            total_debit: debitAmount,
            total_credit: creditAmount,
            created_by: null,
          })
          .select()
          .single();

        if (jeError) throw new Error(`JE insert failed: ${jeError.message}`);

        const { error: lineError } = await supabase.from('journal_entry_lines').insert([
          {
            journal_entry_id: je.id,
            account_id: debitAccountId,
            debit_amount: debitAmount,
            credit_amount: 0,
          },
          {
            journal_entry_id: je.id,
            account_id: creditAccountId,
            debit_amount: 0,
            credit_amount: creditAmount,
          },
        ]);

        if (lineError) throw new Error(`JE lines failed: ${lineError.message}`);
      };

      await insertJE({
        entryNumber: 'JE-REV',
        description: 'Seed revenue',
        debitAccountId: cashId,
        debitAmount: 1500,
        creditAccountId: revenueId,
        creditAmount: 1500,
      });

      await insertJE({
        entryNumber: 'JE-COGS',
        description: 'Seed COGS',
        debitAccountId: cogsId,
        debitAmount: 500,
        creditAccountId: cashId,
        creditAmount: 500,
      });

      await insertJE({
        entryNumber: 'JE-EXP',
        description: 'Seed expenses',
        debitAccountId: expenseId,
        debitAmount: 400,
        creditAccountId: cashId,
        creditAmount: 400,
      });
    };

    (window as any).__seedBalanceSheet = async (opts: { restaurantId: string; asOfDate?: string }) => {
      const asOfDate =
        opts.asOfDate ||
        new Date().toISOString().slice(0, 10);
      const { restaurantId } = opts;

      const accounts = [
        { account_code: '1000', account_name: 'Cash', account_type: 'asset', account_subtype: 'cash', normal_balance: 'debit' },
        { account_code: '1200', account_name: 'Inventory', account_type: 'asset', account_subtype: 'inventory', normal_balance: 'debit' },
        // Use existing enum values for liability subtypes
        { account_code: '2000', account_name: 'Sales Tax Payable', account_type: 'liability', account_subtype: 'other_current_liabilities', normal_balance: 'credit' },
        { account_code: '2100', account_name: 'Tips Payable', account_type: 'liability', account_subtype: 'other_current_liabilities', normal_balance: 'credit' },
        { account_code: '2200', account_name: 'Payroll Liabilities', account_type: 'liability', account_subtype: 'other_current_liabilities', normal_balance: 'credit' },
        { account_code: '3000', account_name: 'Opening Equity', account_type: 'equity', account_subtype: 'owners_equity', normal_balance: 'credit' },
        { account_code: '4000', account_name: 'Food Sales', account_type: 'revenue', account_subtype: 'food_sales', normal_balance: 'credit' },
        { account_code: '5000', account_name: 'COGS', account_type: 'cogs', account_subtype: 'cost_of_goods_sold', normal_balance: 'debit' },
        { account_code: '6000', account_name: 'Operating Expenses', account_type: 'expense', account_subtype: 'operating_expenses', normal_balance: 'debit' },
        { account_code: '6100', account_name: 'Payroll Expense', account_type: 'expense', account_subtype: 'operating_expenses', normal_balance: 'debit' },
      ].map(acc => ({
        id: crypto.randomUUID(),
        restaurant_id: restaurantId,
        is_system_account: false,
        is_active: true,
        ...acc,
      }));

      const { data: insertedAccounts, error: accountError } = await supabase
        .from('chart_of_accounts')
        .upsert(accounts, { onConflict: 'restaurant_id,account_code' })
        .select();

      if (accountError) {
        throw new Error(`Account upsert failed: ${accountError.message}`);
      }

      const getId = (code: string) =>
        (insertedAccounts || []).find((a: any) => a.account_code === code)?.id;

      const cashId = getId('1000');
      const inventoryId = getId('1200');
      const taxId = getId('2000');
      const tipsId = getId('2100');
      const payrollLiabId = getId('2200');
      const equityId = getId('3000');
      const revenueId = getId('4000');
      const cogsId = getId('5000');
      const opExpId = getId('6000');
      const payrollExpId = getId('6100');

      const insertJE = async (entryNumber: string, description: string, lines: any[]) => {
        const { data: je, error: jeError } = await supabase
          .from('journal_entries')
          .insert({
            restaurant_id: restaurantId,
            entry_number: entryNumber,
            entry_date: asOfDate,
            description,
            total_debit: lines.reduce((s, l) => s + (l.debit_amount || 0), 0),
            total_credit: lines.reduce((s, l) => s + (l.credit_amount || 0), 0),
            created_by: null,
          })
          .select()
          .single();

        if (jeError) throw new Error(`JE insert failed: ${jeError.message}`);

        const { error: lineError } = await supabase.from('journal_entry_lines').insert(
          lines.map(l => ({
            journal_entry_id: je.id,
            ...l,
          }))
        );

        if (lineError) throw new Error(`JE lines failed: ${lineError.message}`);
      };

      // Opening equity and assets
      await insertJE('JE-OPEN', 'Opening balances', [
        { account_id: cashId, debit_amount: 5000, credit_amount: 0 },
        { account_id: inventoryId, debit_amount: 2000, credit_amount: 0 },
        { account_id: equityId, debit_amount: 0, credit_amount: 7000 },
      ]);

      // Sales
      await insertJE('JE-SALES', 'Record sales', [
        { account_id: cashId, debit_amount: 3000, credit_amount: 0 },
        { account_id: revenueId, debit_amount: 0, credit_amount: 3000 },
      ]);

      // COGS / inventory usage
      await insertJE('JE-COGS', 'COGS and inventory reduction', [
        { account_id: cogsId, debit_amount: 1200, credit_amount: 0 },
        { account_id: inventoryId, debit_amount: 0, credit_amount: 1200 },
      ]);

      // Operating expense
      await insertJE('JE-OPEX', 'Operating expenses', [
        { account_id: opExpId, debit_amount: 700, credit_amount: 0 },
        { account_id: cashId, debit_amount: 0, credit_amount: 700 },
      ]);

      // Tips collected (liability)
      await insertJE('JE-TIPS', 'Tips collected', [
        { account_id: cashId, debit_amount: 300, credit_amount: 0 },
        { account_id: tipsId, debit_amount: 0, credit_amount: 300 },
      ]);

      // Sales tax collected (liability)
      await insertJE('JE-TAX', 'Sales tax collected', [
        { account_id: cashId, debit_amount: 200, credit_amount: 0 },
        { account_id: taxId, debit_amount: 0, credit_amount: 200 },
      ]);

      // Payroll accrual
      await insertJE('JE-PAYROLL', 'Accrue payroll', [
        { account_id: payrollExpId, debit_amount: 400, credit_amount: 0 },
        { account_id: payrollLiabId, debit_amount: 0, credit_amount: 400 },
      ]);
    };

    // Helper to invite a collaborator (for testing)
    (window as any).__inviteCollaborator = async (email: string, role: string, restaurantId: string) => {
      // Create a test user for the collaborator
      const { data: authUser, error: authError } = await supabase.auth.signUp({
        email,
        password: 'TestPassword123!',
      });

      if (authError && !authError.message.includes('already registered')) {
        throw new Error(`Failed to create collaborator user: ${authError.message}`);
      }

      // Get the user ID (either from signup or existing user)
      let userId = authUser?.user?.id;
      if (!userId) {
        // Try to get existing user by email
        const { data: existingUsers } = await supabase.auth.admin.listUsers();
        const existingUser = existingUsers.users.find(u => u.email === email);
        if (existingUser) {
          userId = existingUser.id;
        } else {
          throw new Error('Could not find or create collaborator user');
        }
      }

      // Add user to restaurant with collaborator role
      const { error: roleError } = await supabase
        .from('user_restaurants')
        .upsert({
          user_id: userId,
          restaurant_id: restaurantId,
          role: role,
        }, {
          onConflict: 'user_id,restaurant_id'
        });

      if (roleError) {
        throw new Error(`Failed to assign collaborator role: ${roleError.message}`);
      }

      return { userId, role };
    };

    // Helper to simulate a different role for the current user (for testing routing)
    (window as any).__simulateCollaboratorRole = async (role: string) => {
      const user = await waitForUser();
      if (!user?.id) throw new Error('No user session');

      // Get current restaurant
      const restaurantId = await (window as any).__getRestaurantId(user.id);
      if (!restaurantId) throw new Error('No restaurant');

      // Update the user's role in user_restaurants
      const { error } = await supabase
        .from('user_restaurants')
        .update({ role })
        .eq('user_id', user.id)
        .eq('restaurant_id', restaurantId);

      if (error) {
        throw new Error(`Failed to simulate role: ${error.message}`);
      }

      // Update localStorage to reflect the new role
      const key = `selectedRestaurant_${user.id}`;
      const currentData = localStorage.getItem(key);
      if (currentData) {
        const restaurantData = JSON.parse(currentData);
        restaurantData.role = role;
        localStorage.setItem(key, JSON.stringify(restaurantData));
      }

      return { role, restaurantId };
    };

    (window as any).__supabaseHelpersReady = true;
  };

  // Ensure helpers exist now and on future navigations
  await page.addInitScript(injectHelpers);
  await page.evaluate(injectHelpers);
}

/**
 * Generate unique test user credentials to avoid conflicts
 */
export const generateTestUser = (prefix: string = 'test') => {
  const ts = Date.now();
  const random = Math.random().toString(36).slice(2, 6);
  return {
    email: `${prefix}-${ts}-${random}@test.com`,
    password: 'TestPassword123!',
    fullName: `${prefix} Test User ${ts}`,
    restaurantName: `${prefix} Test Restaurant ${ts}`,
  };
};

/**
 * Standard signup and restaurant creation flow for E2E tests
 * Handles OnboardingDrawer that appears after restaurant creation
 */
export async function signUpAndCreateRestaurant(
  page: Page,
  user: { email: string; password: string; fullName: string; restaurantName: string }
) {
  const { expect } = await import('@playwright/test');
  
  await page.goto('/auth');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page.waitForURL(/\/auth/);

  const signupTab = page.getByRole('tab', { name: /sign up/i });
  await expect(signupTab).toBeVisible({ timeout: 10000 });
  await signupTab.click();

  await expect(page.getByLabel(/full name/i)).toBeVisible({ timeout: 10000 });
  await page.getByLabel(/email/i).first().fill(user.email);
  await page.getByLabel(/full name/i).fill(user.fullName);
  await page.getByLabel(/password/i).first().fill(user.password);
  await page.getByRole('button', { name: /sign up|create account/i }).click();
  await page.waitForURL('/', { timeout: 15000 });

  const addRestaurantButton = page.getByRole('button', { name: /add restaurant/i });
  await expect(addRestaurantButton).toBeVisible({ timeout: 10000 });
  await addRestaurantButton.click();

  // Filter specifically for RestaurantSelector dialog to avoid confusion with OnboardingDrawer
  const dialog = page.getByRole('dialog').filter({ hasText: /add new restaurant/i });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/restaurant name/i).fill(user.restaurantName);
  await dialog.getByLabel(/address/i).fill('123 Main St');
  await dialog.getByLabel(/phone/i).fill('555-123-4567');
  await dialog.getByRole('button', { name: /create|add|save/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5000 });

  // Close onboarding drawer if it appears (it defaults to open for new restaurants)
  try {
    const onboardingDrawer = page.locator('[role="dialog"]').filter({ hasText: /getting started/i });
    if (await onboardingDrawer.isVisible({ timeout: 4000 })) {
      const closeButton = onboardingDrawer.getByRole('button', { name: /close/i });
      if (await closeButton.isVisible()) {
        await closeButton.click();
        await expect(onboardingDrawer).not.toBeVisible();
      } else {
        await page.keyboard.press('Escape');
      }
    }
  } catch (e) {
    console.log('Onboarding drawer handling skipped or failed', e);
  }
}
