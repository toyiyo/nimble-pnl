import { test, expect } from '@playwright/test';
import {
  exposeSupabaseHelpers,
  generateTestUser,
  signUpAndCreateRestaurant,
  type E2EHelperWindow,
} from '../helpers/e2e-supabase';
import { seedToastPayment } from '../helpers/e2e-service-role';

// Mirrors `formatBusinessDate` in `src/lib/depositMatchUi.ts` — the UI shows
// "Aug 31", never the raw "2026-08-31" ISO string. Kept as a local copy
// (not an import) because Playwright specs do not resolve the `@/` alias.
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatBusinessDateLabel(businessDateIso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(businessDateIso);
  if (!match) return businessDateIso;
  const month = SHORT_MONTHS[Number(match[2]) - 1];
  const day = Number(match[3]);
  return `${month} ${day}`;
}

test.describe('Deposit Match', () => {
  test('create a rule, see the ledger, and accept a late day', async ({ page }) => {
    test.slow();
    const user = generateTestUser('deposit-match');
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    const authUser = await page.evaluate(async () => {
      const win = window as unknown as E2EHelperWindow;
      return win.__getAuthUser();
    });
    if (!authUser?.id) throw new Error('No user session');
    const restaurantId = await page.evaluate(async (userId) => {
      const win = window as unknown as E2EHelperWindow;
      return win.__getRestaurantId(userId);
    }, authUser.id);
    if (!restaurantId) throw new Error('No restaurant');

    // Three business days back, one Toast card payment ($200). The bank
    // deposit ($150) implies a 25% fee, well outside the `toast` rule's
    // default 1.6%-3.1% fee band, so the refresh engine never confirms a
    // link for it (`supabase/migrations/20260901160000_deposit_match_refresh_engine.sql`,
    // step 4: `v_implied_fee BETWEEN fee_pct_min/100 AND fee_pct_max/100`).
    // With no confirmed link and the business date already past the rule's
    // lag window, the item lands on `late` — the only auto-refresh status
    // this fee-band-aware engine can still reach for an unmatched net rule
    // (a `short`/`over` classification now needs a confirmed link outside
    // the fee band, which only a manual override, not auto-refresh, can
    // produce).
    const businessDate = new Date();
    businessDate.setDate(businessDate.getDate() - 3);
    const businessDateIso = businessDate.toISOString().slice(0, 10);

    const transactionDate = new Date(businessDate);
    transactionDate.setDate(transactionDate.getDate() + 1);
    const transactionDateIso = transactionDate.toISOString().slice(0, 10);

    // `toast_payments` carries only a member SELECT policy — the sync edge
    // functions write it with the service-role key, so the browser session
    // cannot seed it directly and this runs through the Node-side helper.
    await seedToastPayment(restaurantId, { paymentDate: businessDateIso, amount: 200 });

    const seed = await page.evaluate(
      async ({ restaurantId, transactionDateIso }) => {
        const win = window as unknown as E2EHelperWindow;

        const bankName = `Deposit Match Test Bank ${crypto.randomUUID().slice(0, 8)}`;

        const { data: bank, error: bankError } = await win.__supabase
          .from('connected_banks')
          .insert({
            restaurant_id: restaurantId,
            stripe_financial_account_id: `test-bank-${crypto.randomUUID()}`,
            institution_name: bankName,
            account_mask: '9510',
            status: 'connected',
            data_current_through: new Date().toISOString(),
          })
          .select()
          .single();
        if (bankError) throw new Error('bankError: ' + JSON.stringify(bankError));

        // The ledger row (`TST*` so the refresh engine's own descriptor
        // scan sees it too) plus two more positive `TST*` rows inside the
        // 90-day suggestion window — the bank-picker suggestion needs 3
        // hits (`get_deposit_match_report`'s `suggested_sources` filters
        // on `hits >= 3`).
        const { error: txnError } = await win.__supabase.from('bank_transactions').insert(
          [150, 120, 130].map((amount) => ({
            restaurant_id: restaurantId,
            connected_bank_id: bank.id,
            stripe_transaction_id: `test-txn-${crypto.randomUUID()}`,
            description: 'TST* Card batch deposit',
            amount,
            transaction_date: transactionDateIso,
            is_categorized: false,
          }))
        );
        if (txnError) throw new Error('txnError: ' + JSON.stringify(txnError));

        return { bankName };
      },
      { restaurantId, transactionDateIso }
    );

    await page.goto('/banking/deposit-match');
    await expect(page.getByRole('heading', { name: 'Deposit Match', exact: true })).toBeVisible();
    await expect(page.getByText('No deposit-match rule is set up yet.')).toBeVisible();

    // Open the setup dialog and add a `toast` rule for the seeded bank.
    await page.getByRole('button', { name: 'Add rule' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Add deposit-match rule' })).toBeVisible();

    await dialog.getByRole('combobox').filter({ hasText: 'focus' }).click();
    await page.getByRole('option', { name: 'toast', exact: true }).click();

    // The amber suggestion panel appears once toast is picked: three
    // `TST*` deposits landed in the seeded bank inside the 90-day scan
    // window (`get_deposit_match_report`'s `suggested_sources`, threshold
    // `hits >= 3`).
    await expect(dialog.getByRole('status')).toContainText(
      `We see TST* deposits in ${seed.bankName} ••9510.`
    );

    // The bank picker's own option carries the same masked label. The
    // existing selector (`seed.bankName`, no `exact`) is a substring match
    // and still finds it once the mask suffix is appended.
    await dialog.getByRole('combobox').filter({ hasText: 'Pick a bank' }).click();
    await expect(page.getByRole('option', { name: seed.bankName })).toContainText('••9510');
    await page.keyboard.press('Escape');

    // "Use this bank" picks the suggested bank and hides the panel.
    await dialog.getByRole('button', { name: 'Use this bank' }).click();
    await expect(dialog.getByRole('status')).toHaveCount(0);
    await expect(dialog.getByRole('combobox').filter({ hasText: seed.bankName })).toBeVisible();

    await dialog.getByRole('button', { name: 'Add rule' }).click();
    await expect(page.getByText('You added the rule.')).toBeVisible({ timeout: 10000 });
    await expect(dialog).toBeHidden({ timeout: 10000 });

    // Creating a rule invalidates the read query, but the refresh RPC fires
    // only once per (restaurant, date range) key — reload for a fresh
    // mount so refresh runs again now that the rule exists, and the
    // seeded late day gets computed.
    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/needs attention/i)).toBeVisible({ timeout: 15000 });
    const attentionRow = page
      .getByRole('button')
      .filter({ hasText: formatBusinessDateLabel(businessDateIso) })
      .filter({ hasText: 'toast' });
    await expect(attentionRow).toBeVisible();
    await expect(attentionRow.getByText('Late')).toBeVisible();

    await attentionRow.click();
    const reviewDialog = page.getByRole('dialog');
    await expect(reviewDialog.getByRole('heading', { name: 'Review day' })).toBeVisible();
    // No confirmed link, so received and fee are both 0 — the full $200
    // expected amount is the gap (`ReviewDayDialog`'s `gapLabel` always
    // prefixes a positive gap "Short", independent of the row's own
    // status chip, which reads "Late").
    await expect(reviewDialog.getByText('Short $200.00')).toBeVisible();

    await reviewDialog.getByRole('button', { name: 'Accept' }).click();
    await expect(page.getByText('You accepted this day.')).toBeVisible({ timeout: 10000 });
    await expect(reviewDialog).toBeHidden({ timeout: 10000 });

    // Verify the resolution persisted through the page's own session.
    const resolution = await page.evaluate(async ({ businessDateIso, restaurantId }) => {
      const win = window as unknown as E2EHelperWindow;
      const { data, error } = await win.__supabase
        .from('deposit_match_items')
        .select('resolution')
        .eq('business_date', businessDateIso)
        .eq('restaurant_id', restaurantId)
        .single();
      if (error) throw error;
      return data?.resolution ?? null;
    }, { businessDateIso, restaurantId });

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
