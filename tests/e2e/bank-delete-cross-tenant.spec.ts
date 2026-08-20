import { test, expect, type Page } from '@playwright/test';
import {
  exposeSupabaseHelpers,
  generateTestUser,
  signUpAndCreateRestaurant,
  type E2EHelperWindow,
} from '../helpers/e2e-supabase';

/**
 * E2E: `bulk_delete_bank_transactions` must reject a caller who does not
 * belong to the target restaurant, and must still work for a caller who
 * does. Guards supabase/migrations/20260820120000_bank_delete_rpcs_membership_guard.sql.
 */

// True when a `bank_transactions` row with `txnId` still exists. Shared by
// both the pre-attack and post-delete checks below, so the two assertions
// stay in sync with each other.
async function transactionExists(page: Page, txnId: string): Promise<boolean> {
  return page.evaluate(async (id: string) => {
    const supabase = (window as E2EHelperWindow).__supabase;
    const { data, error } = await supabase
      .from('bank_transactions')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return Boolean(data);
  }, txnId);
}

test('bulk_delete_bank_transactions rejects a caller from another restaurant', async ({
  page,
  browser,
}) => {
  // User A: owns the restaurant and the transaction under attack.
  const userA = generateTestUser('cross-tenant-a');
  await signUpAndCreateRestaurant(page, userA);
  await exposeSupabaseHelpers(page);

  const restaurantIdA = await page.evaluate(() => (window as E2EHelperWindow).__getRestaurantId());
  expect(restaurantIdA).toBeTruthy();

  const transactionId = await page.evaluate(async (restaurantId: string) => {
    const supabase = (window as E2EHelperWindow).__supabase;

    const stripeAccountId = `test-bank-${crypto.randomUUID()}`;
    const { data: bank, error: bankError } = await supabase
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

    const { data: txn, error: txnError } = await supabase
      .from('bank_transactions')
      .insert({
        restaurant_id: restaurantId,
        connected_bank_id: bank.id,
        stripe_transaction_id: `test-txn-${crypto.randomUUID()}`,
        description: 'Cross-Tenant Guard Test Transaction',
        amount: -42.0,
        transaction_date: new Date().toISOString().split('T')[0],
        is_categorized: false,
      })
      .select()
      .single();
    if (txnError) throw txnError;
    return txn.id as string;
  }, restaurantIdA);

  expect(transactionId).toBeTruthy();

  // User B: a second person, in a second browser context, with their own
  // restaurant. No membership on restaurant A at all.
  const userBContext = await browser.newContext();
  const userBPage = await userBContext.newPage();
  const userB = generateTestUser('cross-tenant-b');
  await signUpAndCreateRestaurant(userBPage, userB);

  const attackResult = await userBPage.evaluate(
    async ({ txnId, restaurantId }: { txnId: string; restaurantId: string }) => {
      const supabase = (window as E2EHelperWindow).__supabase;
      const { data, error } = await supabase.rpc('bulk_delete_bank_transactions', {
        p_transaction_ids: [txnId],
        p_restaurant_id: restaurantId,
      });
      return { data, error: error ? { message: error.message } : null };
    },
    { txnId: transactionId, restaurantId: restaurantIdA }
  );

  expect(attackResult.error).toBeTruthy();
  expect(attackResult.error?.message).toMatch(/unauthorized/i);

  await userBContext.close();

  // User A's transaction survived the attack.
  const stillExists = await transactionExists(page, transactionId);
  expect(stillExists).toBe(true);

  // User A deletes their own transaction through the same RPC: this must
  // still succeed, so the guard does not block the legitimate owner.
  const ownResult = await page.evaluate(
    async ({ txnId, restaurantId }: { txnId: string; restaurantId: string }) => {
      const supabase = (window as E2EHelperWindow).__supabase;
      const { data, error } = await supabase.rpc('bulk_delete_bank_transactions', {
        p_transaction_ids: [txnId],
        p_restaurant_id: restaurantId,
      });
      return { data, error: error ? { message: error.message } : null };
    },
    { txnId: transactionId, restaurantId: restaurantIdA }
  );

  expect(ownResult.error).toBeNull();
  expect(ownResult.data?.success).toBe(true);
  expect(ownResult.data?.deleted_count).toBe(1);

  const goneAfterOwnerDelete = await transactionExists(page, transactionId);
  expect(goneAfterOwnerDelete).toBe(false);
});
