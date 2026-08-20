import { test, expect } from '@playwright/test';
import { exposeSupabaseHelpers, generateTestUser, signUpAndCreateRestaurant } from '../helpers/e2e-supabase';

test.describe('Pending Outflow Match Journal Entry', () => {
  test('manual match writes a balanced journal entry and clears the outflow', async ({ page }) => {
    const user = generateTestUser('pending-outflow-match');
    await signUpAndCreateRestaurant(page, user);

    await exposeSupabaseHelpers(page);

    // Seed one connected bank, one uncategorized transaction (-100), one
    // expense chart account, and one pending outflow with that category and
    // a near-equal amount.
    const seed = await page.evaluate(async () => {
      const authUser = await (window as any).__getAuthUser();
      if (!authUser?.id) throw new Error('No user session');

      const restaurantId = await (window as any).__getRestaurantId(authUser.id);
      if (!restaurantId) throw new Error('No restaurant');

      const { data: bank, error: bankError } = await (window as any).__supabase
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

      const { data: transaction, error: txnError } = await (window as any).__supabase
        .from('bank_transactions')
        .insert({
          restaurant_id: restaurantId,
          connected_bank_id: bank.id,
          stripe_transaction_id: `test-txn-${crypto.randomUUID()}`,
          description: 'Match Test Vendor Payment',
          amount: -100.0,
          transaction_date: new Date().toISOString().split('T')[0],
          is_categorized: false,
        })
        .select()
        .single();
      if (txnError) throw txnError;

      const { data: account, error: acctError } = await (window as any).__supabase
        .from('chart_of_accounts')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('account_type', 'expense')
        .limit(1)
        .single();
      if (acctError) throw acctError;

      const { data: outflow, error: outflowError } = await (window as any).__supabase
        .from('pending_outflows')
        .insert({
          restaurant_id: restaurantId,
          vendor_name: 'Match Test Vendor',
          category_id: account.id,
          payment_method: 'check',
          amount: 99.95,
          issue_date: new Date().toISOString().split('T')[0],
          status: 'pending',
        })
        .select()
        .single();
      if (outflowError) throw outflowError;

      return { restaurantId, transactionId: transaction.id, outflowId: outflow.id };
    });

    await page.goto('/expenses');
    await expect(page.getByRole('heading', { name: 'Expenses', exact: true })).toBeVisible();

    // Open the manual match dialog for the seeded outflow.
    const manualMatchButton = page.getByRole('button', { name: 'Manual match transaction' });
    await expect(manualMatchButton).toBeVisible({ timeout: 10000 });
    await manualMatchButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: /manual match transaction/i })).toBeVisible();

    // Select the seeded transaction and confirm the match.
    const transactionRow = dialog.getByRole('button', { name: /Match Test Vendor Payment/i });
    await expect(transactionRow).toBeVisible({ timeout: 10000 });
    await transactionRow.click();

    const confirmButton = dialog.getByRole('button', { name: /^confirm match$/i });
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    // A category is set on the outflow, so confirmMatch runs the categorize
    // RPC and reports the transaction as categorized in its success toast.
    await expect(page.getByText(/expense matched and cleared/i)).toBeVisible({ timeout: 10000 });
    await expect(dialog).toBeHidden({ timeout: 10000 });

    // Verify the ledger write, the transaction metadata, and the outflow
    // status through the page's own Supabase session.
    const result = await page.evaluate(async ({ transactionId, outflowId }) => {
      const { data: entries, error: entriesError } = await (window as any).__supabase
        .from('journal_entries')
        .select('id, reference_type, reference_id, is_balanced')
        .eq('reference_type', 'bank_transaction')
        .eq('reference_id', transactionId);
      if (entriesError) throw entriesError;

      const entry = entries?.[0];
      let lineCount = 0;
      if (entry) {
        const { data: lines, error: linesError } = await (window as any).__supabase
          .from('journal_entry_lines')
          .select('id')
          .eq('journal_entry_id', entry.id);
        if (linesError) throw linesError;
        lineCount = lines?.length ?? 0;
      }

      const { data: transaction, error: txnError } = await (window as any).__supabase
        .from('bank_transactions')
        .select('is_categorized, matched_at')
        .eq('id', transactionId)
        .single();
      if (txnError) throw txnError;

      const { data: outflow, error: outflowError } = await (window as any).__supabase
        .from('pending_outflows')
        .select('status')
        .eq('id', outflowId)
        .single();
      if (outflowError) throw outflowError;

      return {
        entryCount: entries?.length ?? 0,
        isBalanced: entry?.is_balanced ?? null,
        lineCount,
        isCategorized: transaction?.is_categorized ?? null,
        matchedAt: transaction?.matched_at ?? null,
        outflowStatus: outflow?.status ?? null,
      };
    }, { transactionId: seed.transactionId, outflowId: seed.outflowId });

    expect(result.entryCount).toBe(1);
    expect(result.isBalanced).toBe(true);
    expect(result.lineCount).toBe(2);
    expect(result.isCategorized).toBe(true);
    expect(result.matchedAt).not.toBeNull();
    expect(result.outflowStatus).toBe('cleared');
  });
});
