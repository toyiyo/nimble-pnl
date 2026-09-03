import { test, expect } from '@playwright/test';
import {
  exposeSupabaseHelpers,
  generateTestUser,
  signUpAndCreateRestaurant,
  type E2EHelperWindow,
} from '../helpers/e2e-supabase';

test.describe('Deposit Match', () => {
  test('create a rule, see the ledger, and accept a short day', async ({ page }) => {
    test.slow();
    const user = generateTestUser('deposit-match');
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    // Seed one connected bank and, three business days back, a POS payment
    // ($200) short-deposited by a bank transaction ($150) inside the
    // `focus` rule's default 1-2 day lag window.
    const seed = await page.evaluate(async () => {
      const win = window as unknown as E2EHelperWindow;
      const authUser = await win.__getAuthUser();
      if (!authUser?.id) throw new Error('No user session');
      const restaurantId = await win.__getRestaurantId(authUser.id);
      if (!restaurantId) throw new Error('No restaurant');

      const businessDate = new Date();
      businessDate.setDate(businessDate.getDate() - 3);
      const businessDateIso = businessDate.toISOString().slice(0, 10);

      const transactionDate = new Date(businessDate);
      transactionDate.setDate(transactionDate.getDate() + 1);
      const transactionDateIso = transactionDate.toISOString().slice(0, 10);

      const bankName = `Deposit Match Test Bank ${crypto.randomUUID().slice(0, 8)}`;

      const { data: bank, error: bankError } = await win.__supabase
        .from('connected_banks')
        .insert({
          restaurant_id: restaurantId,
          stripe_financial_account_id: `test-bank-${crypto.randomUUID()}`,
          institution_name: bankName,
          status: 'connected',
          data_current_through: new Date().toISOString(),
        })
        .select()
        .single();
      if (bankError) throw bankError;

      const { error: paymentError } = await win.__supabase.from('focus_payments').insert({
        restaurant_id: restaurantId,
        business_date: businessDateIso,
        focus_check_id: `check-${crypto.randomUUID()}`,
        payment_key: `pay-${crypto.randomUUID()}`,
        name: 'Visa',
        amount: 200,
      });
      if (paymentError) throw paymentError;

      const { error: txnError } = await win.__supabase.from('bank_transactions').insert({
        restaurant_id: restaurantId,
        connected_bank_id: bank.id,
        stripe_transaction_id: `test-txn-${crypto.randomUUID()}`,
        description: 'Card batch deposit',
        amount: 150,
        transaction_date: transactionDateIso,
        is_categorized: false,
      });
      if (txnError) throw txnError;

      return { restaurantId, bankName, businessDateIso };
    });

    await page.goto('/banking/deposit-match');
    await expect(page.getByRole('heading', { name: 'Deposit Match', exact: true })).toBeVisible();
    await expect(page.getByText('No deposit-match rule is set up yet.')).toBeVisible();

    // Open the setup dialog and add a rule for the seeded bank. The POS
    // source select already defaults to `focus`.
    await page.getByRole('button', { name: 'Add rule' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Add deposit-match rule' })).toBeVisible();

    await dialog.getByRole('combobox').filter({ hasText: 'Pick a bank' }).click();
    await page.getByRole('option', { name: seed.bankName }).click();

    await dialog.getByRole('button', { name: 'Add rule' }).click();
    await expect(page.getByText('You added the rule.')).toBeVisible({ timeout: 10000 });
    await expect(dialog).toBeHidden({ timeout: 10000 });

    // Creating a rule invalidates the read query, but the refresh RPC fires
    // only once per (restaurant, date range) key — reload for a fresh
    // mount so refresh runs again now that the rule exists, and the
    // seeded short day gets computed.
    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/needs attention/i)).toBeVisible({ timeout: 15000 });
    const attentionRow = page
      .getByRole('button')
      .filter({ hasText: seed.businessDateIso })
      .filter({ hasText: 'focus' });
    await expect(attentionRow).toBeVisible();
    await expect(attentionRow.getByText('Short')).toBeVisible();

    await attentionRow.click();
    const reviewDialog = page.getByRole('dialog');
    await expect(reviewDialog.getByRole('heading', { name: 'Review day' })).toBeVisible();
    await expect(reviewDialog.getByText('Short $50.00')).toBeVisible();

    await reviewDialog.getByRole('button', { name: 'Accept' }).click();
    await expect(page.getByText('You accepted this day.')).toBeVisible({ timeout: 10000 });
    await expect(reviewDialog).toBeHidden({ timeout: 10000 });

    // Verify the resolution persisted through the page's own session.
    const resolution = await page.evaluate(async ({ businessDateIso }) => {
      const win = window as unknown as E2EHelperWindow;
      const { data, error } = await win.__supabase
        .from('deposit_match_items')
        .select('resolution')
        .eq('business_date', businessDateIso)
        .single();
      if (error) throw error;
      return data?.resolution ?? null;
    }, { businessDateIso: seed.businessDateIso });

    expect(resolution).toBe('accepted');
  });

  test('a banking-only collaborator cannot open Deposit Match', async ({ page }) => {
    test.slow();
    const user = generateTestUser('deposit-match-collab');
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    // collaborator_accountant holds view:banking but not view:pos_sales, so
    // the /banking prefix lets the router through and the page's own
    // capability guard must be the one that denies it.
    await page.evaluate(async () => {
      const win = window as unknown as E2EHelperWindow;
      const authUser = await win.__getAuthUser();
      if (!authUser?.id) throw new Error('No user session');
      const restaurantId = await win.__getRestaurantId(authUser.id);
      if (!restaurantId) throw new Error('No restaurant');

      const { error } = await win.__supabase
        .from('user_restaurants')
        .update({ role: 'collaborator_accountant' })
        .eq('user_id', authUser.id)
        .eq('restaurant_id', restaurantId);
      if (error) throw error;
    });

    await page.goto('/banking/deposit-match');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('You cannot open Deposit Match.')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Deposit Match', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add rule' })).toHaveCount(0);
  });
});
