import { test, expect } from '@playwright/test';
import {
  exposeSupabaseHelpers,
  generateTestUser,
  signUpAndCreateRestaurant,
  type E2EHelperWindow,
} from '../helpers/e2e-supabase';
import { runAutoLinkPendingOutflows } from '../helpers/e2e-service-role';

test.describe('Pending Outflow Auto-Link', () => {
  test('auto-link clears the outflow, and Undo match reverts both rows', async ({ page }) => {
    const user = generateTestUser('pending-outflow-auto-link');
    await signUpAndCreateRestaurant(page, user);

    await exposeSupabaseHelpers(page);

    // Seed one connected bank, one uncategorized transaction (-100), one
    // expense chart account, and one pending outflow with that category and
    // the exact matching amount, so the deterministic auto-link criteria
    // (amount within $0.01, 14-day forward window, vendor containment) hit.
    const seed = await page.evaluate(async () => {
      const win = window as unknown as E2EHelperWindow;
      const authUser = await win.__getAuthUser();
      if (!authUser?.id) throw new Error('No user session');

      const restaurantId = await win.__getRestaurantId(authUser.id);
      if (!restaurantId) throw new Error('No restaurant');

      const { data: bank, error: bankError } = await win.__supabase
        .from('connected_banks')
        .insert({
          restaurant_id: restaurantId,
          stripe_financial_account_id: `test-bank-${crypto.randomUUID()}`,
          institution_name: 'Test Bank',
          status: 'connected',
        })
        .select()
        .single();
      if (bankError) throw bankError;

      const { data: transaction, error: txnError } = await win.__supabase
        .from('bank_transactions')
        .insert({
          restaurant_id: restaurantId,
          connected_bank_id: bank.id,
          stripe_transaction_id: `test-txn-${crypto.randomUUID()}`,
          description: 'Auto Link Vendor Payment',
          amount: -100.0,
          transaction_date: new Date().toISOString().split('T')[0],
          is_categorized: false,
        })
        .select()
        .single();
      if (txnError) throw txnError;

      const { data: account, error: acctError } = await win.__supabase
        .from('chart_of_accounts')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('account_type', 'expense')
        .limit(1)
        .single();
      if (acctError) throw acctError;

      const { data: outflow, error: outflowError } = await win.__supabase
        .from('pending_outflows')
        .insert({
          restaurant_id: restaurantId,
          vendor_name: 'Auto Link Vendor',
          category_id: account.id,
          payment_method: 'check',
          amount: 100.0,
          issue_date: new Date().toISOString().split('T')[0],
          status: 'pending',
        })
        .select()
        .single();
      if (outflowError) throw outflowError;

      return { restaurantId, transactionId: transaction.id, outflowId: outflow.id };
    });

    // Deterministic auto-link: call the RPC directly through the
    // service-role client instead of waiting for the cron tick.
    const sweep = await runAutoLinkPendingOutflows(seed.restaurantId);
    expect(sweep.linkedCount).toBe(1);

    await page.goto('/expenses');
    await expect(page.getByRole('heading', { name: 'Expenses', exact: true })).toBeVisible();

    // The outflow card shows Cleared with the Auto-matched badge.
    const outflowCard = page.getByRole('button', { name: 'Edit expense for Auto Link Vendor' });
    await expect(outflowCard).toBeVisible({ timeout: 10000 });
    await expect(outflowCard.getByText('Cleared', { exact: true })).toBeVisible();
    await expect(outflowCard.getByText('Auto-matched')).toBeVisible();

    // The linked bank transaction is categorized in the database.
    const afterLink = await page.evaluate(async (transactionId) => {
      const win = window as unknown as E2EHelperWindow;
      const { data, error } = await win.__supabase
        .from('bank_transactions')
        .select('is_categorized, matched_at')
        .eq('id', transactionId)
        .single();
      if (error) throw error;
      return data;
    }, seed.transactionId);
    expect(afterLink.is_categorized).toBe(true);
    expect(afterLink.matched_at).not.toBeNull();

    // Undo the match from the card.
    const undoButton = page.getByRole('button', { name: 'Undo match for Auto Link Vendor' });
    await expect(undoButton).toBeVisible();
    await undoButton.click();

    await expect(page.getByText(/match undone/i)).toBeVisible({ timeout: 10000 });

    // The outflow card returns to open (Pending), no longer Cleared.
    await expect(outflowCard.getByText('Pending', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(outflowCard.getByText('Auto-matched')).toHaveCount(0);

    // The transaction returns to For Review (uncategorized) in the database.
    const afterUndo = await page.evaluate(async (transactionId) => {
      const win = window as unknown as E2EHelperWindow;
      const { data, error } = await win.__supabase
        .from('bank_transactions')
        .select('is_categorized, matched_at')
        .eq('id', transactionId)
        .single();
      if (error) throw error;
      return data;
    }, seed.transactionId);
    expect(afterUndo.is_categorized).toBe(false);
    expect(afterUndo.matched_at).toBeNull();

    // The outflow itself is back to open/unlinked.
    const outflowAfterUndo = await page.evaluate(async (outflowId) => {
      const win = window as unknown as E2EHelperWindow;
      const { data, error } = await win.__supabase
        .from('pending_outflows')
        .select('status, linked_bank_transaction_id, auto_linked_at')
        .eq('id', outflowId)
        .single();
      if (error) throw error;
      return data;
    }, seed.outflowId);
    expect(outflowAfterUndo.status).toBe('pending');
    expect(outflowAfterUndo.linked_bank_transaction_id).toBeNull();
    expect(outflowAfterUndo.auto_linked_at).toBeNull();
  });
});
